import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# LangSmith tracing — must be configured before LangChain modules are imported
if os.environ.get("LANGSMITH_API_KEY"):
    os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
    os.environ.setdefault("LANGCHAIN_API_KEY", os.environ["LANGSMITH_API_KEY"])
    os.environ.setdefault("LANGCHAIN_PROJECT", "crag")

from fastapi import FastAPI, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from qdrant_client import QdrantClient

from graph import app as crag_app
from auth import get_current_user

COLLECTION_NAME = "crag"
NEEDS_PARSING = {".pdf", ".docx", ".pptx", ".html"}
RAW_DOCS_DIR = Path("raw_docs")
DOCS_DIR = Path("docs")

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

fastapi_app = FastAPI(title="CRAG API")
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    question: str
    chat_history: list[dict] = []
    document_filter: list[str] = []


def _serialize(value):
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    return str(value)


def stream_crag(question: str, chat_history: list, document_filter: list):
    inputs = {
        "question": question,
        "search_count": 0,
        "chat_history": chat_history,
        "document_filter": document_filter,
        "documents": [],
        "sources": [],
        "generation": "",
    }
    config = {"recursion_limit": 20}

    for stream_event in crag_app.stream(inputs, config=config, stream_mode=["updates", "messages"]):
        try:
            event_type, event_data = stream_event
        except (TypeError, ValueError):
            continue

        if event_type == "updates":
            for node_name, node_output in event_data.items():
                payload = {
                    "type": "node",
                    "node": node_name,
                    "output": _serialize(node_output),
                }
                yield f"data: {json.dumps(payload)}\n\n"

        elif event_type == "messages":
            try:
                chunk, metadata = event_data
                if (
                    metadata.get("langgraph_node") == "generate"
                    and hasattr(chunk, "content")
                    and chunk.content
                ):
                    yield f"data: {json.dumps({'type': 'token', 'token': chunk.content})}\n\n"
            except (TypeError, ValueError):
                pass

    yield f"data: {json.dumps({'type': 'done'})}\n\n"


@fastapi_app.post("/api/query")
async def query(
    request: QueryRequest,
    _user_id: str = Depends(get_current_user),
):
    return StreamingResponse(
        stream_crag(request.question, request.chat_history, request.document_filter),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@fastapi_app.get("/api/documents")
async def list_documents(_user_id: str = Depends(get_current_user)):
    """Return distinct source filenames present in the Qdrant collection."""
    try:
        if not qdrant_client.collection_exists(COLLECTION_NAME):
            return {"documents": []}
        points, _ = qdrant_client.scroll(
            collection_name=COLLECTION_NAME,
            limit=10_000,
            with_payload=["source"],
            with_vectors=False,
        )
        sources = sorted({p.payload.get("source", "") for p in points if p.payload})
        return {"documents": sources}
    except Exception:
        return {"documents": []}


async def _stream_upload(file: UploadFile):
    def event(status: str, message: str) -> str:
        return f"data: {json.dumps({'status': status, 'message': message})}\n\n"

    try:
        suffix = Path(file.filename).suffix.lower()
        RAW_DOCS_DIR.mkdir(exist_ok=True)
        DOCS_DIR.mkdir(exist_ok=True)

        yield event("saving", f"Saving {file.filename}...")
        content = await file.read()
        raw_path = RAW_DOCS_DIR / file.filename
        raw_path.write_bytes(content)

        if suffix in NEEDS_PARSING:
            md_path = DOCS_DIR / (Path(file.filename).stem + ".md")
            if md_path.exists():
                yield event("parsing", "Markdown already exists — skipping LlamaCloud parse.")
            else:
                yield event("parsing", "Parsing with LlamaCloud...")
                from generate_markdown import parse_file
                md_path = await asyncio.to_thread(parse_file, raw_path, DOCS_DIR)
        else:
            md_path = DOCS_DIR / file.filename
            md_path.write_bytes(content)

        yield event("ingesting", "Embedding and uploading chunks...")
        from ingest import ingest_file
        count = await asyncio.to_thread(ingest_file, md_path)

        yield event("done", f"Done — {count} chunk(s) ingested from {file.filename}")

    except Exception as e:
        yield event("error", str(e))


@fastapi_app.post("/api/upload")
async def upload(
    file: UploadFile = File(...),
    _user_id: str = Depends(get_current_user),
):
    return StreamingResponse(
        _stream_upload(file),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:fastapi_app", host="0.0.0.0", port=8000, reload=True)
