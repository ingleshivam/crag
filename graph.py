from langgraph.graph import StateGraph, START, END
from state import GraphState
from nodes import retrieve, grade_documents, transform_query, generate


workflow = StateGraph(GraphState)


workflow.add_node("retrieve", retrieve)
workflow.add_node("grade_documents", grade_documents)
workflow.add_node("transform_query", transform_query)
workflow.add_node("generate", generate)


workflow.add_edge(START, "retrieve")
workflow.add_edge("retrieve", "grade_documents")
workflow.add_edge("transform_query", "retrieve") 
workflow.add_edge("generate", END)


def decide_to_generate(state: GraphState):
    """
    Evaluates the filtered documents to decide whether to loop or generate.
    """
    filtered_documents = state["documents"]
    search_count = state.get("search_count", 0)

    if not filtered_documents:
        if search_count < 2:
            print("---DECISION: ALL DOCS IRRELEVANT -> ROUTING TO REWRITE---")
            return "transform_query"
        else:
            print("---DECISION: MAX SEARCH TRIES REACHED -> ROUTING TO GENERATE---")
            return "generate"
    else:
        print("---DECISION: RELEVANT DOCS FOUND -> ROUTING TO GENERATE---")
        return "generate"

workflow.add_conditional_edges(
    "grade_documents",
    decide_to_generate,
    {
        "transform_query": "transform_query",
        "generate": "generate"
    }
)

app = workflow.compile()