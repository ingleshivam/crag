import os
import numpy as np
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from huggingface_hub import InferenceClient
from state import GraphState

# Initialize Groq LLM
llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0)

# Initialize Qdrant and HuggingFace clients
qdrant_client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ["QDRANT_API_KEY"],
)

hf_client = InferenceClient(
    provider="hf-inference",
    api_key=os.environ["HF_TOKEN"],
)

COLLECTION_NAME = "crag"
EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B"
VECTOR_SIZE = 1024

# Create the collection if it doesn't already exist
_existing = [c.name for c in qdrant_client.get_collections().collections]
if COLLECTION_NAME not in _existing:
    qdrant_client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )
    print(f"Created Qdrant collection: {COLLECTION_NAME}")


def get_embedding(text: str) -> list[float]:
    result = hf_client.feature_extraction(text, model=EMBEDDING_MODEL)
    return np.array(result).flatten().tolist()

# --- 1. GRADER SETUP ---
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

# --- 2. REWRITER SETUP ---
rewrite_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a query rewriter. Your task is to optimize a user query to make it better suited for vector database search.\n"
               "Analyze the original query and output an improved, semantically rich version. Return ONLY the rewritten query text."),
    ("human", "Original query: {question}"),
])
query_rewriter = rewrite_prompt | llm

# --- 3. GENERATOR SETUP ---
gen_prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question.\n"
               "If you don't know the answer, say that you don't know.\n\nContext:\n{context}"),
    ("human", "Question: {question}"),
])
generator = gen_prompt | llm


# --- NODE FUNCTIONS ---

def retrieve(state: GraphState):
    print("---NODE: RETRIEVING DOCUMENTS---")
    question = state["question"]

    query_vector = get_embedding(question)
    hits = qdrant_client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
        limit=5,
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