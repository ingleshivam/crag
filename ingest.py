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

load_dotenv()

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "voyage-3-lite"
VECTOR_SIZE = 512
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
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


def chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        chunk = text[start : start + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


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

    files = list(docs_dir.glob("**/*.md")) + list(docs_dir.glob("**/*.txt"))
    if not files:
        print(f"No .md or .txt files found in '{docs_dir}'. Add documents and re-run.")
        return

    all_chunks: list[str] = []
    all_sources: list[str] = []
    for file in files:
        print(f"Chunking: {file.name}")
        chunks = chunk_text(file.read_text(encoding="utf-8"))
        all_chunks.extend(chunks)
        all_sources.extend([file.name] * len(chunks))

    print(f"Embedding {len(all_chunks)} chunks (dense + sparse)...")
    dense_vecs = embed_dense(all_chunks)
    sparse_vecs = embed_sparse(all_chunks)
    points = _build_points(all_chunks, all_sources, dense_vecs, sparse_vecs)

    print(f"Uploading to '{COLLECTION_NAME}'...")
    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])
        print(f"  {min(i + UPSERT_BATCH, len(points))}/{len(points)} uploaded")

    print("Ingestion complete.")


def ingest_file(file_path: Path) -> int:
    """Ingest a single markdown/text file. Returns number of chunks uploaded."""
    _ensure_collection()

    chunks = chunk_text(file_path.read_text(encoding="utf-8"))
    dense_vecs = embed_dense(chunks)
    sparse_vecs = embed_sparse(chunks)
    points = _build_points(chunks, [file_path.name] * len(chunks), dense_vecs, sparse_vecs)

    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])

    return len(points)


if __name__ == "__main__":
    ingest()
