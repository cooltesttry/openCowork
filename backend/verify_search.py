import json
import httpx
import asyncio
import os

CONFIG_PATH = "../storage/config.json"

async def verify_search():
    # 1. Load Config
    if not os.path.exists(CONFIG_PATH):
        print(f"Error: {CONFIG_PATH} not found.")
        return

    with open(CONFIG_PATH, "r") as f:
        config = json.load(f)

    search_config = config.get("search", {})
    provider = search_config.get("provider")
    api_key = search_config.get("api_key")

    print(f"Configuration Loaded:")
    print(f"  Provider: {provider}")
    print(f"  API Key:  {api_key[:6]}...{api_key[-4:] if api_key else 'None'}")

    if provider != "serper":
        print("Skipping verification: Provider is not 'serper'.")
        return

    if not api_key:
        print("Error: No API key found for serper.")
        return

    # 2. Test Connection
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json"
    }
    payload = json.dumps({"q": "NVDA stock price"})

    print(f"\nTesting connection to {url}...")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, content=payload)
            
            print(f"Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print("\nSuccess! Search Results received.")
                print("-" * 40)
                # Print first organic result as proof
                organic = data.get("organic", [])
                if organic:
                    first = organic[0]
                    print(f"Title: {first.get('title')}")
                    print(f"Link:  {first.get('link')}")
                    print(f"Snippet: {first.get('snippet')}")
                else:
                    print("No organic results found, but request succeeded.")
                print("-" * 40)
            else:
                print(f"\nFailed: {response.text}")

    except Exception as e:
        print(f"\nException validating search: {e}")

if __name__ == "__main__":
    asyncio.run(verify_search())
