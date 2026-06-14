import os
import voyageai
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, SparseVectorParams, SparseVector,
    Prefetch, FusionQuery, Fusion, Filter, FieldCondition, MatchAny,
    PayloadSchemaType,
)
from state import GraphState

try:
    from fastembed import SparseTextEmbedding as _SparseModel
    _sparse_model = _SparseModel(model_name="Qdrant/bm25")
    HYBRID = True
except Exception:
    _sparse_model = None
    HYBRID = False

llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0)

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "voyage-3-lite"
RERANK_MODEL = "rerank-2"
VECTOR_SIZE = 512
SCORE_THRESHOLD = 0.45


def _ensure_collection() -> None:
    """Create or migrate Qdrant collection to named dense + optional sparse vectors."""
    try:
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
    except Exception as e:
        raise RuntimeError(
            f"Cannot connect to Qdrant at {os.environ.get('QDRANT_URL')}.\n"
            "Check that your cluster is active on cloud.qdrant.io and "
            "QDRANT_URL / QDRANT_API_KEY in .env are correct.\n"
            f"Original error: {e}"
        ) from e


_collection_ready = False


def get_dense_embedding(text: str, is_query: bool = False) -> list[float]:
    input_type = "query" if is_query else "document"
    return vo.embed([text], model=EMBEDDING_MODEL, input_type=input_type).embeddings[0]


def get_sparse_embedding(text: str) -> SparseVector:
    result = list(_sparse_model.embed([text]))[0]
    return SparseVector(indices=result.indices.tolist(), values=result.values.tolist())


class GradeDocuments(BaseModel):
    """Binary score for relevance check on retrieved documents."""
    binary_score: str = Field(description="Documents are relevant to the question, 'yes' or 'no'")


structured_llm_grader = llm.with_structured_output(GradeDocuments)

grader_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a grader assessing relevance of a retrieved document to a user question.\n"
     "If the document contains keyword(s) or semantic meaning related to the user question, grade it as 'yes'.\n"
     "Otherwise, grade it as 'no'."),
    ("human", "Retrieved document:\n\n{document}\n\nUser question: {question}"),
])
retrieval_grader = grader_prompt | structured_llm_grader

rewrite_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a query rewriter. Optimize the user query for vector database search. "
     "Output an improved, semantically rich version. Return ONLY the rewritten query text."),
    ("human", "Original query: {question}"),
])
query_rewriter = rewrite_prompt | llm

gen_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are an assistant for question-answering tasks. "
     "Use ONLY the retrieved context below to answer the question.\n\n"
     "IMPORTANT: If the context contains mathematical formulas, copy them VERBATIM — "
     "do NOT simplify, merge, or rewrite them. Preserve every summation sign, variable, "
     "and subscript exactly as they appear in the source.\n\n"
     "If you don't know the answer, say so. Use markdown formatting where helpful.\n\n"
     "{history}"
     "Context:\n{context}"),
    ("human", "{question}"),
])
generator = gen_prompt | llm

strict_gen_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a precise assistant. Answer ONLY from the provided context.\n\n"
     "CRITICAL RULES — follow these exactly:\n"
     "1. Mathematical formulas: copy them CHARACTER-FOR-CHARACTER from the context. "
     "If the source has two nested sigma (∑) signs, your answer must have two nested sigma signs.\n"
     "2. Do not reconstruct or rephrase any formula — locate it in the context and quote it directly.\n"
     "3. Numbers, variable names, subscripts: copy exactly as they appear.\n"
     "4. If the context does not contain the information, say so explicitly.\n\n"
     "{history}"
     "Context:\n{context}"),
    ("human", "{question}"),
])
strict_generator = strict_gen_prompt | llm

class GradeFaithfulness(BaseModel):
    """Check whether the generated answer is faithful to the source context."""
    faithful: bool = Field(
        description="True if the answer accurately represents the source context, "
                    "False if it contradicts, fabricates, or misrepresents information."
    )
    issue: str = Field(
        description="Specific description of the faithfulness problem. Empty string if faithful."
    )

faithfulness_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a faithfulness checker. Determine whether the generated answer is "
     "grounded in and consistent with the provided source context.\n\n"
     "Pay special attention to:\n"
     "- Mathematical formulas: verify that summation structure, variable names, "
     "and subscripts match the source exactly. A single nested ∑ vs double nested ∑∑ is a failure.\n"
     "- Numerical values: weights, thresholds, and constants must match.\n"
     "- No information should be added that is not present in the context.\n\n"
     "Return faithful=true only if the answer is fully consistent with the source."),
    ("human",
     "Source context:\n{context}\n\n"
     "Generated answer:\n{generation}\n\n"
     "Is the answer faithful to the source?"),
])
faithfulness_grader = faithfulness_prompt | llm.with_structured_output(GradeFaithfulness)


def retrieve(state: GraphState):
    print("---NODE: RETRIEVING DOCUMENTS---")
    global _collection_ready
    if not _collection_ready:
        _ensure_collection()
        _collection_ready = True

    question = state["question"]
    document_filter = state.get("document_filter") or []

    dense_vec = get_dense_embedding(question, is_query=True)

    query_filter = None
    if document_filter:
        query_filter = Filter(
            must=[FieldCondition(key="source", match=MatchAny(any=document_filter))]
        )

    if HYBRID and _sparse_model:
        sparse_vec = get_sparse_embedding(question)
        results = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            prefetch=[
                Prefetch(query=dense_vec, using="dense", limit=20),
                Prefetch(query=sparse_vec, using="sparse", limit=20),
            ],
            query=FusionQuery(fusion=Fusion.RRF),
            limit=10,
            query_filter=query_filter,
            with_payload=True,
        )
    else:
        results = qdrant_client.query_points(
            collection_name=COLLECTION_NAME,
            query=dense_vec,
            using="dense",
            limit=10,
            score_threshold=SCORE_THRESHOLD,
            query_filter=query_filter,
            with_payload=True,
        )

    texts = [hit.payload.get("text", "") for hit in results.points]
    sources = [hit.payload.get("source", "") for hit in results.points]

    if texts:
        try:
            reranked = vo.rerank(question, texts, model=RERANK_MODEL, top_k=min(5, len(texts)))
            texts = [texts[r.index] for r in reranked.results]
            sources = [sources[r.index] for r in reranked.results]
            print(f"   - Reranked to top {len(texts)} chunks")
        except Exception as e:
            print(f"   - Reranking skipped ({e}), using original order")
            texts = texts[:5]
            sources = sources[:5]

    seen, unique_sources = set(), []
    for s in sources:
        if s not in seen:
            seen.add(s)
            unique_sources.append(s)

    return {
        "documents": texts,
        "sources": unique_sources,
        "search_count": state.get("search_count", 0),
    }


def grade_documents(state: GraphState):
    print("---NODE: GRADING DOCUMENTS---")
    question = state["question"]
    documents = state["documents"]

    filtered_docs = []
    for doc in documents:
        score = retrieval_grader.invoke({"question": question, "document": doc})
        if score.binary_score == "yes":
            print("   - Document graded: RELEVANT")
            filtered_docs.append(doc)
        else:
            print("   - Document graded: NOT RELEVANT")

    return {"documents": filtered_docs}


def transform_query(state: GraphState):
    print("---NODE: REWRITING QUERY---")
    question = state["question"]
    current_count = state.get("search_count", 0)

    response = query_rewriter.invoke({"question": question})
    print(f"   - New Query: {response.content}")

    return {"question": response.content, "search_count": current_count + 1}


def generate(state: GraphState):
    print("---NODE: GENERATING ANSWER---")
    question = state["question"]
    documents = state["documents"]
    chat_history = state.get("chat_history") or []
    faithfulness_attempts = state.get("faithfulness_attempts", 0)

    history_text = ""
    for turn in chat_history[-3:]:
        q = turn.get("question", "")
        a = turn.get("answer", "")
        if q and a:
            history_text += f"Previous Q: {q}\nPrevious A: {a}\n\n"
    if history_text:
        history_text = f"Previous conversation:\n{history_text}\n"

    context = "\n\n".join(documents) if documents else "No relevant context found."

    chain = strict_generator if faithfulness_attempts > 0 else generator
    if faithfulness_attempts > 0:
        print("   - Using strict prompt (faithfulness re-attempt)")

    response = chain.invoke({
        "context": context,
        "question": question,
        "history": history_text,
    })

    return {"generation": response.content}


def check_faithfulness(state: GraphState):
    print("---NODE: CHECKING FAITHFULNESS---")
    generation = state.get("generation", "")
    documents = state.get("documents", [])
    attempts = state.get("faithfulness_attempts", 0)

    if not documents or not generation:
        return {"faithfulness_attempts": attempts + 1, "faithful": True}

    context = "\n\n".join(documents)
    try:
        result = faithfulness_grader.invoke({"context": context, "generation": generation})
        if result.faithful:
            print("   - PASS: answer is faithful to source")
        else:
            print(f"   - FAIL: {result.issue}")
        return {"faithfulness_attempts": attempts + 1, "faithful": result.faithful}
    except Exception as e:
        print(f"   - Faithfulness check skipped ({e}), assuming faithful")
        return {"faithfulness_attempts": attempts + 1, "faithful": True}
