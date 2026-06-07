# CRAG — Corrective Retrieval-Augmented Generation

A full-stack RAG pipeline that uses **LangGraph** to implement Corrective RAG (CRAG) — a self-correcting retrieval loop that grades retrieved documents, rewrites queries when needed, and only generates an answer when relevant context is found.

---

## Architecture

```
User Question
      │
      ▼
  [Retrieve]  ──── Voyage AI embeddings → Qdrant vector search
      │
      ▼
[Grade Docs]  ──── Groq LLM grades each chunk for relevance
      │
   ┌──┴──┐
   │     │
relevant  not relevant (retry < 2)
   │     │
   │  [Rewrite Query] ──── Groq LLM rewrites for better retrieval
   │     │
   └──┬──┘
      │
      ▼
  [Generate]  ──── Groq LLM answers using relevant chunks
      │
      ▼
   Answer
```

### Stack

| Layer                      | Technology                           |
| -------------------------- | ------------------------------------ |
| Graph orchestration        | LangGraph                            |
| LLM (grading + generation) | Groq (`openai/gpt-oss-120b`)         |
| Embeddings                 | Voyage AI (`voyage-3-lite`, 512-dim) |
| Vector database            | Qdrant Cloud                         |
| Document parsing           | LlamaCloud (LlamaParse)              |
| Backend API                | FastAPI + Uvicorn                    |
| Frontend                   | Next.js + Tailwind CSS               |

---

## Project Structure

```
crag/
├── api.py                  # FastAPI server — /api/query and /api/upload
├── graph.py                # LangGraph workflow definition
├── nodes.py                # Node functions: retrieve, grade, rewrite, generate
├── state.py                # GraphState TypedDict
├── ingest.py               # Standalone ingestion script
├── generate_markdown.py    # LlamaCloud PDF→markdown pipeline
├── main.py                 # CLI runner (for testing without the UI)
├── requirements.txt
├── .env                    # API keys (never commit)
├── raw_docs/               # Source files to upload (gitignored)
├── docs/                   # Generated markdown files (gitignored)
└── frontend/
    ├── app/
    │   ├── layout.tsx
    │   └── page.tsx        # Main page with chat + execution panel
    ├── components/
    │   ├── ChatPanel.tsx
    │   ├── PipelineTrace.tsx
    │   ├── ChunksPanel.tsx
    │   └── DocumentUpload.tsx
    └── lib/
        ├── api.ts          # SSE streaming client
        └── types.ts
```

---

## Setup

### 1. Clone and create a virtual environment

```bash
git clone <repo-url>
cd crag
uv venv
uv add -r requirements.txt
```

### 2. Configure environment variables

Copy `.env` and fill in your API keys:

```env
GROQ_API_KEY=...           # https://console.groq.com
QDRANT_URL=...             # https://cloud.qdrant.io  (include port :6333)
QDRANT_API_KEY=...
VOYAGE_API_KEY=...         # https://dashboard.voyageai.com
LLAMA_CLOUD_API_KEY=...    # https://cloud.llamaindex.ai  (for PDF parsing)
HF_TOKEN=...               # https://huggingface.co/settings/tokens
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
```

---

## Running

### Backend

```bash
python api.py
# Runs on http://localhost:8000
```

### Frontend

```bash
cd frontend
npm run dev
# Opens on http://localhost:3000
```

---

## Ingesting Documents

### Via the UI

1. Open the app at `http://localhost:3000`
2. Click the **Documents** tab in the right panel
3. Drop or browse a file (PDF, DOCX, PPTX, TXT, MD)
4. Click **Upload & Ingest**

PDF/DOCX/PPTX files are parsed to markdown via LlamaCloud before ingestion. If the markdown already exists in `docs/`, parsing is skipped.

### Via the CLI

**Markdown / plain text files:**

```bash
# Drop files into docs/ then run:
python ingest.py
```

**PDFs and other document formats:**

```bash
# Drop files into raw_docs/ then run:
python generate_markdown.py
# This parses → saves markdown → auto-ingests
```

---

## How CRAG Works

1. **Retrieve** — The user's question is embedded with Voyage AI and used to search the Qdrant collection (top 5 chunks, cosine similarity ≥ 0.45).

2. **Grade** — Each retrieved chunk is graded by the LLM as `yes` (relevant) or `no` (irrelevant).

3. **Decide:**
   - If relevant chunks exist → go to **Generate**
   - If no relevant chunks and retry count < 2 → go to **Rewrite Query**
   - If retry limit reached → go to **Generate** anyway (with no context)

4. **Rewrite** — The LLM rewrites the query for better semantic retrieval, then loops back to **Retrieve**.

5. **Generate** — The LLM generates a final answer using the relevant chunks as context.

---

## Frontend UI

| Panel                     | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| **Chat (left)**           | Q&A conversation with typing indicator                                 |
| **Execution tab (right)** | Live pipeline trace: each node with chunk counts and rewritten queries |
| **Retrieved Chunks**      | Raw chunks returned from Qdrant for the current query                  |
| **Documents tab (right)** | Drag-and-drop file upload with real-time ingestion progress            |

---

## API Endpoints

| Method | Path          | Description                                        |
| ------ | ------------- | -------------------------------------------------- |
| `POST` | `/api/query`  | Run CRAG pipeline, streams SSE events per node     |
| `POST` | `/api/upload` | Upload and ingest a document, streams SSE progress |

### SSE Event format — `/api/query`

```json
{ "node": "retrieve", "output": { "documents": [...], "search_count": 0 } }
{ "node": "grade_documents", "output": { "documents": [...] } }
{ "node": "generate", "output": { "generation": "..." } }
{ "node": "__done__", "output": {} }
```

### SSE Event format — `/api/upload`

```json
{ "status": "saving",   "message": "Saving report.pdf..." }
{ "status": "parsing",  "message": "Parsing with LlamaCloud..." }
{ "status": "ingesting","message": "Embedding and uploading chunks..." }
{ "status": "done",     "message": "Done — 142 chunk(s) ingested from report.pdf" }
```
