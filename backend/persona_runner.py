from backend.services import ollama_client

MODEL_NAME = "mistral"  # or whatever is running: llama3, codellama, etc.

def get_persona_response(persona_key, message):
    try:
        client = ollama_client.get_client()
        response = client.generate(model=MODEL_NAME, prompt=message, options={"temperature": 0.7})
        return response["response"].strip()
    except Exception as e:
        return f"[Error getting response from LLM server]: {e}"

