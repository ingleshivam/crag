from dotenv import load_dotenv

load_dotenv()

from graph import app

if __name__ == "__main__":
    inputs = {
        "question": "What are the core metrics for the Q3 marketing strategies?",
        "search_count": 0
    }
    
    print("Starting LangGraph execution...\n")
    config = {"recursion_limit": 20}
    
    for output in app.stream(inputs, config=config):

        for key, value in output.items():
            print(f"\nFinished processing Node: '{key}'")
            
    print("\n--- FINAL ANSWER ---")
    final_state = app.get_state(config)

    print(output[key]["generation"])