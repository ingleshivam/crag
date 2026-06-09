# CRAG — Corrective Retrieval-Augmented Generation

A full-stack RAG pipeline built with **LangGraph** that implements Corrective RAG (CRAG) — a self-correcting retrieval loop that grades retrieved documents, rewrites queries when needed, checks the faithfulness of generated answers, and only returns a response when it is both relevant and grounded in the source.

---

## Architecture

```
User Question
      │
      ▼
  [Retrieve]  ──── Voyage AI hybrid search (dense + BM25) → Qdrant → Voyage AI rerank
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
[Check Faithfulness] ── LLM verifies answer matches source (esp. formulas)
      │
   ┌──┴──────────────┐
   │                 │
faithful         not faithful (retry < 2)
   │                 │
   ▼              [Generate] ← strict prompt: copy formulas verbatim
 Answer
```

### Stack

| Layer                      | Technology                                        |
| -------------------------- | ------------------------------------------------- |
| Graph orchestration        | LangGraph                                         |
| LLM (grading + generation) | Groq (`openai/gpt-oss-120b`)                      |
| Embeddings                 | Voyage AI (`voyage-3-lite`, 512-dim)              |
| Reranking                  | Voyage AI (`rerank-2`)                            |
| Sparse embeddings          | fastembed BM25 (`Qdrant/bm25`)                    |
| Vector database            | Qdrant Cloud (hybrid dense + sparse, RRF fusion)  |
| PDF parsing                | pymupdf4llm (math-preserving markdown conversion) |
| Observability              | LangSmith                                         |
| Backend API                | FastAPI + Uvicorn (SSE streaming)                 |
| Frontend                   | Next.js + Tailwind CSS                            |

---

## Project Structure

```
crag/
├── api.py                  # FastAPI server — streaming SSE endpoints
├── graph.py                # LangGraph workflow definition
├── nodes.py                # Node functions: retrieve, grade, rewrite, generate, check_faithfulness
├── state.py                # GraphState TypedDict
├── ingest.py               # Standalone ingestion script (PDF + MD + TXT)
├── main.py                 # CLI runner (for testing without the UI)
├── requirements.txt
├── .env                    # API keys (never commit)
├── docs/                   # Source documents to ingest (gitignored)
└── frontend/
    ├── app/
    │   ├── layout.tsx      # Dark/light theme init script
    │   └── page.tsx        # 3-column layout with session management
    ├── components/
    │   ├── Sidebar.tsx         # Session list, doc filter, quick upload
    │   ├── SessionList.tsx     # Conversation history with delete
    │   ├── ChatPanel.tsx       # Chat bubbles, copy, regen, markdown rendering
    │   ├── InfoPanel.tsx       # Pipeline graph + step trace + source chunks
    │   ├── PipelineGraph.tsx   # Animated SVG DAG with active-node glow
    │   └── ThemeToggle.tsx     # Dark / light mode toggle
    └── lib/
        ├── api.ts          # SSE streaming client
        ├── sessions.ts     # localStorage session CRUD helpers
        └── types.ts        # Message, Session, StreamEvent types
```

---

## Setup

### 1. Clone and create a virtual environment

```bash
git clone <repo-url>
cd crag
uv venv
uv pip install -r requirements.txt
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=...              # https://console.groq.com
QDRANT_URL=...                # https://cloud.qdrant.io  (include :6333)
QDRANT_API_KEY=...
VOYAGE_API_KEY=...            # https://dashboard.voyageai.com
LANGCHAIN_API_KEY=...         # https://smith.langchain.com  (LangSmith tracing)
LANGCHAIN_TRACING_V2=true
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
2. Use the **Quick Upload** area in the left sidebar
3. Drop or click to select a file (PDF, DOCX, TXT, MD)
4. Progress streams in real time

### Via the CLI

Drop files into `docs/` and run:

```bash
python ingest.py
```

Supported formats: `.pdf`, `.md`, `.txt`

PDFs are converted to markdown via `pymupdf4llm` before chunking, which preserves LaTeX math blocks, tables, and section headings. This prevents the LLM from having to reconstruct formulas from prose.

---

## How CRAG Works

### 1. Retrieve
The question is embedded with Voyage AI (`voyage-3-lite`) and used for hybrid search in Qdrant — combining dense cosine similarity with BM25 sparse retrieval, fused via Reciprocal Rank Fusion (RRF). Results are reranked with Voyage AI `rerank-2` and the top 5 chunks are returned.

### 2. Grade
Each retrieved chunk is graded by the LLM as `yes` (relevant) or `no` (irrelevant).

### 3. Decide
- Relevant chunks found → **Generate**
- No relevant chunks, retry count < 2 → **Rewrite Query**
- Retry limit reached → **Generate** anyway

### 4. Rewrite
The LLM rewrites the query for better semantic retrieval, then loops back to **Retrieve**.

### 5. Generate
The LLM generates an answer using the relevant chunks as context. If this is a faithfulness re-attempt, a stricter prompt is used that explicitly forbids formula reconstruction.

### 6. Check Faithfulness
A separate LLM call verifies that the generated answer is grounded in the source — with special attention to mathematical formulas (nested summations, variable names, numerical weights). If the check fails, the pipeline regenerates with the strict prompt. After one retry it always ends.

---

## Frontend UI

| Area | Description |
|---|---|
| **Left sidebar** | Conversation history (click to switch, hover to delete), document collection filter, quick file upload |
| **Center — Chat** | Streaming Q&A with markdown rendering, copy-answer button, regenerate button, source citation pills |
| **Right — Information Panel** | Animated pipeline DAG, step-by-step execution trace, retrieved source chunks (expandable) |
| **Theme toggle** | Dark / light mode (persisted in localStorage, no flash on reload) |

---

## API Endpoints

| Method | Path              | Description                                          |
| ------ | ----------------- | ---------------------------------------------------- |
| `POST` | `/api/query`      | Run CRAG pipeline, streams SSE tokens + node updates |
| `POST` | `/api/upload`     | Upload and ingest a document, streams SSE progress   |
| `GET`  | `/api/documents`  | List all distinct source names stored in Qdrant      |

### SSE Event format — `/api/query`

```json
{ "type": "node",  "node": "retrieve", "output": { "documents": [...], "sources": [...] } }
{ "type": "node",  "node": "grade_documents", "output": { "documents": [...] } }
{ "type": "token", "token": "The risk " }
{ "type": "token", "token": "score is..." }
{ "type": "done" }
```

### Request body — `/api/query`

```json
{
  "question": "What is the risk propagation formula?",
  "chat_history": [
    { "question": "...", "answer": "..." }
  ],
  "document_filter": ["paper.pdf"]
}
```

### SSE Event format — `/api/upload`

```json
{ "status": "saving",    "message": "Saving report.pdf..." }
{ "status": "ingesting", "message": "Embedding and uploading chunks..." }
{ "status": "done",      "message": "Done — 142 chunk(s) ingested from report.pdf" }
{ "status": "error",     "message": "..." }
```

---

## Key Design Decisions

**Hybrid search over dense-only** — BM25 catches exact keyword matches that semantic embeddings miss (e.g. specific formula variable names, acronyms). RRF fusion combines both rankings without needing to tune score weights.

**pymupdf4llm over plain PDF text extraction** — Standard PDF parsers produce prose like *"R of p equals the sum over paths..."*. pymupdf4llm preserves LaTeX blocks so formulas land in the vector store verbatim, eliminating a whole class of hallucination.

**Faithfulness check node** — Relevance grading (does the chunk answer the question?) is not the same as faithfulness checking (does the answer match the chunk?). The extra node catches cases where the LLM reconstructs or simplifies content rather than quoting it.

**Chunk size 1200 / overlap 200** — Definition and theorem blocks in academic papers typically span 400–800 characters. A 500-character chunk splits them mid-formula. 1200 keeps the entire definition in one chunk with room for surrounding context. Math-aware separators (`\nDefinition `, `\nTheorem `) prevent splits inside formal statements.
