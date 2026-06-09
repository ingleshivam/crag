from typing import List, TypedDict


class GraphState(TypedDict):
    question: str
    documents: List[str]
    sources: List[str]
    generation: str
    search_count: int
    chat_history: List[dict]
    document_filter: List[str]
    faithfulness_attempts: int  # tracks how many times faithfulness was checked
    faithful: bool              # set by check_faithfulness node
