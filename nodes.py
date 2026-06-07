import os
import voyageai
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from state import GraphState


llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0)

qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "voyage-3-lite"
VECTOR_SIZE = 512
SCORE_THRESHOLD = 0.45


def _ensure_collection() -> None:
    """Create or migrate the Qdrant collection. Called lazily on first retrieve."""
    try:
        if qdrant_client.collection_exists(COLLECTION_NAME):
            info = qdrant_client.get_collection(COLLECTION_NAME)
            existing_size = info.config.params.vectors.size
            if existing_size != VECTOR_SIZE:
                print(f"Vector size changed ({existing_size}→{VECTOR_SIZE}). Recreating collection...")
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
    except Exception as e:
        raise RuntimeError(
            f"Cannot connect to Qdrant at {os.environ.get('QDRANT_URL')}.\n"
            "Check that your cluster is active on cloud.qdrant.io and "
            "QDRANT_URL / QDRANT_API_KEY in .env are correct.\n"
            f"Original error: {e}"
        ) from e


_collection_ready = False


def get_embedding(text: str, is_query: bool = False) -> list[float]:
    input_type = "query" if is_query else "document"
    return vo.embed([text], model=EMBEDDING_MODEL, input_type=input_type).embeddings[0]

class GradeDocuments(BaseModel):
    """Binary score for relevance check on retrieved documents."""
    binary_score: str = Field(description="Documents are relevant to the question, 'yes' or 'no'")

structured_llm_grader = llm.with_structured_output(GradeDocuments)

grader_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a grader assessing relevance of a retrieved document to a user question.\n"
               "If the document contains keyword(s) or semantic meaning related to the user question, grade it as 'yes'.\n"
               "Otherwise, grade it as 'no'."),
    ("human", "Retrieved document: \n\n {document} \n\n User question: {question}"),
])
retrieval_grader = grader_prompt | structured_llm_grader


rewrite_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a query rewriter. Your task is to optimize a user query to make it better suited for vector database search.\n"
               "Analyze the original query and output an improved, semantically rich version. Return ONLY the rewritten query text."),
    ("human", "Original query: {question}"),
])
query_rewriter = rewrite_prompt | llm


gen_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question.\n"
               "If you don't know the answer, say that you don't know.\n\nContext:\n{context}"),
    ("human", "Question: {question}"),
])
generator = gen_prompt | llm




def retrieve(state: GraphState):
    print("---NODE: RETRIEVING DOCUMENTS---")
    global _collection_ready
    if not _collection_ready:
        _ensure_collection()
        _collection_ready = True

    question = state["question"]
    query_vector = get_embedding(question, is_query=True)
    hits = qdrant_client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
        limit=5,
        score_threshold=SCORE_THRESHOLD,
    )
    retrieved_chunks = [hit.payload.get("text", "") for hit in hits]

    return {"documents": retrieved_chunks, "search_count": state.get("search_count", 0)}

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
    
    context = "\n\n".join(documents) if documents else "No relevant context found."
    response = generator.invoke({"context": context, "question": question})
    
    return {"generation": response.content}