import os
import uuid
import voyageai
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, SparseVectorParams, SparseVector, PointStruct,
    PayloadSchemaType,
)
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "voyage-3-lite"
VECTOR_SIZE = 512
CHUNK_SIZE = 1200   # larger chunks keep definitions/formulas intact
CHUNK_OVERLAP = 200
EMBED_BATCH = 128
UPSERT_BATCH = 100
DOCS_DIR = Path("docs")

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])

try:
    from fastembed import SparseTextEmbedding as _SparseModel
    _sparse_model = _SparseModel(model_name="Qdrant/bm25")
    HYBRID = True
except Exception:
    _sparse_model = None
    HYBRID = False

# pymupdf4llm preserves LaTeX math blocks, tables, and headings from PDFs
try:
    import pymupdf4llm
    PYMUPDF4LLM = True
except ImportError:
    PYMUPDF4LLM = False

# Math/structure-aware separators: keep Definition/Theorem/Equation blocks together
_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=[
        "\n\n\n",
        "\n\n",
        "\nDefinition ", "\nTheorem ", "\nLemma ", "\nProposition ",
        "\nEquation ", "\nProof ", "\nRemark ",
        "\n",
        " ",
        "",
    ],
)


def chunk_text(text: str) -> list[str]:
    return _splitter.split_text(text)


def load_pdf(path: Path) -> str:
    """Convert PDF to markdown, preserving math notation and tables."""
    if PYMUPDF4LLM:
        return pymupdf4llm.to_markdown(str(path))
    # Fallback: plain text extraction via PyMuPDF (fitz)
    try:
        import fitz
        doc = fitz.open(str(path))
        return "\n\n".join(page.get_text() for page in doc)
    except ImportError:
        raise RuntimeError(
            "Install pymupdf4llm for PDF support: pip install pymupdf4llm"
        )


def load_file(path: Path) -> str:
    """Load any supported file to a plain string."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return load_pdf(path)
    return path.read_text(encoding="utf-8")


def embed_dense(texts: list[str]) -> list[list[float]]:
    embeddings = []
    for i in range(0, len(texts), EMBED_BATCH):
        result = vo.embed(texts[i : i + EMBED_BATCH], model=EMBEDDING_MODEL, input_type="document")
        embeddings.extend(result.embeddings)
    return embeddings


def embed_sparse(texts: list[str]) -> list[SparseVector | None]:
    if not HYBRID or not _sparse_model:
        return [None] * len(texts)
    results = list(_sparse_model.embed(texts))
    return [SparseVector(indices=r.indices.tolist(), values=r.values.tolist()) for r in results]


def _ensure_collection() -> None:
    needs_create = True
    if qdrant_client.collection_exists(COLLECTION_NAME):
        info = qdrant_client.get_collection(COLLECTION_NAME)
        vectors = info.config.params.vectors
        sparse = info.config.params.sparse_vectors or {}
        try:
            if isinstance(vectors, dict) and "dense" in vectors:
                ok_size = vectors["dense"].size == VECTOR_SIZE
                ok_sparse = (not HYBRID) or ("sparse" in sparse)
                if ok_size and ok_sparse:
                    needs_create = False
        except (AttributeError, KeyError):
            pass
        if needs_create:
            print("Recreating collection with updated vector config...")
            qdrant_client.delete_collection(COLLECTION_NAME)

    if needs_create:
        qdrant_client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config={"dense": VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE)},
            sparse_vectors_config={"sparse": SparseVectorParams()} if HYBRID else None,
        )
        print(f"Created Qdrant collection: {COLLECTION_NAME}")

    qdrant_client.create_payload_index(
        collection_name=COLLECTION_NAME,
        field_name="source",
        field_schema=PayloadSchemaType.KEYWORD,
    )


def _build_points(
    chunks: list[str],
    sources: list[str],
    dense_vecs: list[list[float]],
    sparse_vecs: list[SparseVector | None],
) -> list[PointStruct]:
    points = []
    for txt, src, dvec, svec in zip(chunks, sources, dense_vecs, sparse_vecs):
        vec: dict = {"dense": dvec}
        if svec is not None:
            vec["sparse"] = svec
        points.append(PointStruct(
            id=str(uuid.uuid4()),
            vector=vec,
            payload={"text": txt, "source": src},
        ))
    return points


def ingest(docs_dir: Path = DOCS_DIR) -> None:
    _ensure_collection()

    supported = (".md", ".txt", ".pdf")
    files = [f for f in docs_dir.glob("**/*") if f.suffix.lower() in supported]
    if not files:
        print(f"No supported files ({', '.join(supported)}) found in '{docs_dir}'.")
        return

    all_chunks: list[str] = []
    all_sources: list[str] = []
    for file in files:
        print(f"Loading: {file.name}")
        try:
            text = load_file(file)
            chunks = chunk_text(text)
            all_chunks.extend(chunks)
            all_sources.extend([file.name] * len(chunks))
            print(f"  → {len(chunks)} chunks")
        except Exception as e:
            print(f"  ! Skipping {file.name}: {e}")

    if not all_chunks:
        print("No chunks to ingest.")
        return

    print(f"\nEmbedding {len(all_chunks)} chunks (dense + sparse)...")
    dense_vecs = embed_dense(all_chunks)
    sparse_vecs = embed_sparse(all_chunks)
    points = _build_points(all_chunks, all_sources, dense_vecs, sparse_vecs)

    print(f"Uploading to '{COLLECTION_NAME}'...")
    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])
        print(f"  {min(i + UPSERT_BATCH, len(points))}/{len(points)} uploaded")

    print("Ingestion complete.")


def ingest_file(file_path: Path) -> int:
    """Ingest a single file (PDF, markdown, or text). Returns number of chunks uploaded."""
    _ensure_collection()

    text = load_file(file_path)
    chunks = chunk_text(text)
    dense_vecs = embed_dense(chunks)
    sparse_vecs = embed_sparse(chunks)
    points = _build_points(chunks, [file_path.name] * len(chunks), dense_vecs, sparse_vecs)

    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])

    return len(points)


if __name__ == "__main__":
    ingest()
