#!/usr/bin/env python3
"""
Test script to call OpenRouter model with "你好" message.
Uses the Anthropic-compatible endpoint.
"""
import json
import httpx
import asyncio

# Load config
CONFIG_PATH = "/Users/huawang/pyproject/openCowork/storage/config.json"

def load_config():
    with open(CONFIG_PATH, 'r') as f:
        return json.load(f)

async def test_model_call():
    config = load_config()
    model_config = config.get("model", {})
    
    api_key = model_config.get("api_key")
    model_name = model_config.get("model_name")
    
    print("=" * 50)
    print("OpenRouter Model Call Test")
    print("=" * 50)
    print()
    print(f"📦 Provider: {model_config.get('provider')}")
    print(f"🤖 Model: {model_name}")
    print(f"🔑 API Key: {api_key[:15]}...{api_key[-10:]}")
    print()
    
    # OpenRouter Anthropic-compatible endpoint
    url = "https://openrouter.ai/api/v1/chat/completions"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/opencowork",
        "X-Title": "OpenCowork Test",
    }
    
    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": "你好"}
        ],
        "max_tokens": 200,
    }
    
    print("🔄 Calling model with: 你好")
    print(f"➡️  Endpoint: {url}")
    print()
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            
            print(f"📊 Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                usage = data.get("usage", {})
                model_used = data.get("model", "unknown")
                
                print()
                print("✅ Call Successful!")
                print(f"🤖 Model Used: {model_used}")
                print()
                print("📝 Response:")
                print("-" * 40)
                print(content)
                print("-" * 40)
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
                    print(f"📄 Error Details: {json.dumps(error_data, indent=2, ensure_ascii=False)}")
                except:
                    print(f"📄 Response Text: {response.text}")
                return False
                
    except httpx.TimeoutException:
        print("❌ Error: Request timed out (60s)")
        return False
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_model_call())
    
    print()
    print("=" * 50)
    if success:
        print("🎉 Test PASSED!")
    else:
        print("💔 Test FAILED!")
    print("=" * 50)
