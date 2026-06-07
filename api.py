import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from graph import app as crag_app

fastapi_app = FastAPI(title="CRAG API")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    question: str


def _serialize(value):
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    return str(value)


def stream_crag(question: str):
    inputs = {"question": question, "search_count": 0}
    config = {"recursion_limit": 20}
    for output in crag_app.stream(inputs, config=config):
        for node_name, node_output in output.items():
            payload = {"node": node_name, "output": _serialize(node_output)}
            yield f"data: {json.dumps(payload)}\n\n"
    yield f"data: {json.dumps({'node': '__done__', 'output': {}})}\n\n"


NEEDS_PARSING = {".pdf", ".docx", ".pptx", ".html"}
RAW_DOCS_DIR = Path("raw_docs")
DOCS_DIR = Path("docs")


async def _stream_upload(file: UploadFile):
    def event(status: str, message: str) -> str:
        return f"data: {json.dumps({'status': status, 'message': message})}\n\n"

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
            yield event("parsing", f"Markdown already exists — skipping LlamaCloud parse.")
        else:
            yield event("parsing", f"Parsing with LlamaCloud...")
            from generate_markdown import parse_file
            md_path = await asyncio.to_thread(parse_file, raw_path, DOCS_DIR)
    else:
        md_path = DOCS_DIR / file.filename
        md_path.write_bytes(content)

    yield event("ingesting", f"Embedding and uploading chunks...")
    from ingest import ingest_file
    count = await asyncio.to_thread(ingest_file, md_path)

    yield event("done", f"Done — {count} chunk(s) ingested from {file.filename}")


@fastapi_app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    return StreamingResponse(
        _stream_upload(file),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@fastapi_app.post("/api/query")
async def query(request: QueryRequest):
    return StreamingResponse(
        stream_crag(request.question),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:fastapi_app", host="0.0.0.0", port=8000, reload=True)
