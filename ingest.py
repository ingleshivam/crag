import os
import uuid
import voyageai
from pathlib import Path
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

load_dotenv()

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "voyage-3-lite"
VECTOR_SIZE = 512
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
EMBED_BATCH = 128   # Voyage AI max texts per request
UPSERT_BATCH = 100  # Qdrant upsert batch size
DOCS_DIR = Path("docs")

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])


def chunk_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        chunk = text[start : start + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a list of document texts in batches."""
    embeddings = []
    for i in range(0, len(texts), EMBED_BATCH):
        result = vo.embed(texts[i : i + EMBED_BATCH], model=EMBEDDING_MODEL, input_type="document")
        embeddings.extend(result.embeddings)
    return embeddings


def _ensure_collection() -> None:
    if qdrant_client.collection_exists(COLLECTION_NAME):
        existing_size = qdrant_client.get_collection(COLLECTION_NAME).config.params.vectors.size
        if existing_size != VECTOR_SIZE:
            print(f"Vector dimension mismatch ({existing_size}→{VECTOR_SIZE}). Recreating collection...")
            qdrant_client.delete_collection(COLLECTION_NAME)
            qdrant_client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )
    else:
        qdrant_client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        print(f"Created Qdrant collection: {COLLECTION_NAME}")


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

    print(f"Embedding {len(all_chunks)} chunks via Voyage AI...")
    vectors = embed_texts(all_chunks)

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=vec, payload={"text": txt, "source": src})
        for txt, src, vec in zip(all_chunks, all_sources, vectors)
    ]

    print(f"Uploading to Qdrant collection '{COLLECTION_NAME}'...")
    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])
        print(f"  {min(i + UPSERT_BATCH, len(points))}/{len(points)} uploaded")

    print("Ingestion complete.")


def ingest_file(file_path: Path) -> int:
    """Ingest a single markdown/text file. Returns number of chunks uploaded."""
    _ensure_collection()

    chunks = chunk_text(file_path.read_text(encoding="utf-8"))
    vectors = embed_texts(chunks)

    points = [
        PointStruct(id=str(uuid.uuid4()), vector=vec, payload={"text": txt, "source": file_path.name})
        for txt, vec in zip(chunks, vectors)
    ]

    for i in range(0, len(points), UPSERT_BATCH):
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=points[i : i + UPSERT_BATCH])

    return len(points)


if __name__ == "__main__":
    ingest()
