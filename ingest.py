import os
import uuid
from pathlib import Path
from dotenv import load_dotenv
import numpy as np
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
from huggingface_hub import InferenceClient

load_dotenv()

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
BATCH_SIZE = 16
DOCS_DIR = Path("docs")

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

hf_client = InferenceClient(
    provider="hf-inference",
    api_key=os.environ["HF_TOKEN"],
)


def chunk_text(text: str) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunk = text[start : start + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


def get_embedding(text: str) -> list[float]:
    result = hf_client.feature_extraction(text, model=EMBEDDING_MODEL)
    return np.array(result).flatten().tolist()


def ingest(docs_dir: Path = DOCS_DIR) -> None:
    files = list(docs_dir.glob("**/*.md")) + list(docs_dir.glob("**/*.txt"))
    if not files:
        print(f"No .md or .txt files found in '{docs_dir}'. Add documents and re-run.")
        return

    points: list[PointStruct] = []
    for file in files:
        print(f"Chunking: {file.name}")
        text = file.read_text(encoding="utf-8")
        for chunk in chunk_text(text):
            vector = get_embedding(chunk)
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=vector,
                    payload={"text": chunk, "source": file.name},
                )
            )

    print(f"\nUploading {len(points)} chunks to collection '{COLLECTION_NAME}'...")
    for i in range(0, len(points), BATCH_SIZE):
        batch = points[i : i + BATCH_SIZE]
        qdrant_client.upsert(collection_name=COLLECTION_NAME, points=batch)
        print(f"  {min(i + BATCH_SIZE, len(points))}/{len(points)} uploaded")

    print("Ingestion complete.")


if __name__ == "__main__":
    ingest()
