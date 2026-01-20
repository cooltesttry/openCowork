#!/usr/bin/env python3
"""
Test script to verify OpenRouter API connection using config.json settings.
"""
import json
import httpx
import asyncio

# Load config
CONFIG_PATH = "/Users/huawang/pyproject/openCowork/storage/config.json"

def load_config():
    with open(CONFIG_PATH, 'r') as f:
        return json.load(f)

async def test_openrouter_connection():
    config = load_config()
    model_config = config.get("model", {})
    
    api_key = model_config.get("api_key")
    model_name = model_config.get("model_name")
    
    if not api_key:
        print("❌ Error: No API key found in config")
        return False
    
    print(f"📦 Provider: {model_config.get('provider')}")
    print(f"🤖 Model: {model_name}")
    print(f"🔑 API Key: {api_key[:15]}...{api_key[-10:]}")
    print()
    
    # OpenRouter API endpoint
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/opencowork",  # Optional
        "X-Title": "OpenCowork Test",  # Optional
    }
    
    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": "Hello! Please respond with just 'API connection successful!' to confirm the connection is working."}
        ],
        "max_tokens": 50,
    }
    
    print("🔄 Testing API connection...")
    print(f"➡️  Endpoint: {url}")
    print(f"➡️  Model: {model_name}")
    print()
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            
            print(f"📊 Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = data.get("usage", {})
                
                print()
                print("✅ API Connection Successful!")
                print(f"📝 Response: {content}")
                print()
                print("📈 Usage:")
                print(f"   - Prompt tokens: {usage.get('prompt_tokens', 'N/A')}")
                print(f"   - Completion tokens: {usage.get('completion_tokens', 'N/A')}")
                print(f"   - Total tokens: {usage.get('total_tokens', 'N/A')}")
                return True
            else:
                print()
                print(f"❌ API Error: {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"📄 Error Details: {json.dumps(error_data, indent=2)}")
                except:
                    print(f"📄 Response Text: {response.text}")
                return False
                
    except httpx.TimeoutException:
        print("❌ Error: Request timed out")
        return False
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        return False

if __name__ == "__main__":
    print("=" * 50)
    print("OpenRouter API Connection Test")
    print("=" * 50)
    print()
    
    success = asyncio.run(test_openrouter_connection())
    
    print()
    print("=" * 50)
    if success:
        print("🎉 Test PASSED - API is working correctly!")
    else:
        print("💔 Test FAILED - Please check your configuration")
    print("=" * 50)
