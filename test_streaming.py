#!/usr/bin/env python3
"""
Streaming test script for OpenRouter API endpoints.
Tests both OpenAI and Anthropic formats with streaming enabled.
"""
import json
import httpx
import asyncio

# Load config
CONFIG_PATH = "/Users/huawang/pyproject/openCowork/storage/config.json"

def load_config():
    with open(CONFIG_PATH, 'r') as f:
        return json.load(f)

async def test_openai_streaming(api_key: str, model: str):
    """Test OpenAI-compatible streaming endpoint."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "你好，请用一句话回复"}],
        "max_tokens": 100,
        "stream": True,
    }
    
    print(f"\n{'='*50}")
    print("Testing OpenAI Format (stream=True)")
    print(f"Endpoint: {url}")
    print(f"Model: {model}")
    print("="*50)
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                print(f"Status: {resp.status_code}")
                
                if resp.status_code != 200:
                    content = await resp.aread()
                    print(f"❌ Error: {content.decode()}")
                    return False
                
                print("\n📝 Streaming response:")
                print("-" * 40)
                full_content = ""
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            if "content" in delta:
                                text = delta["content"]
                                print(text, end="", flush=True)
                                full_content += text
                        except json.JSONDecodeError:
                            pass
                print("\n" + "-" * 40)
                print("✅ OpenAI streaming SUCCESS!")
                return True
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        return False


async def test_anthropic_streaming(api_key: str, model: str):
    """Test Anthropic-compatible streaming endpoint."""
    url = "https://openrouter.ai/api/v1/messages"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "你好，请用一句话回复"}],
        "max_tokens": 100,
        "stream": True,
    }
    
    print(f"\n{'='*50}")
    print("Testing Anthropic Format (stream=True)")
    print(f"Endpoint: {url}")
    print(f"Model: {model}")
    print("="*50)
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                print(f"Status: {resp.status_code}")
                
                if resp.status_code != 200:
                    content = await resp.aread()
                    print(f"❌ Error: {content.decode()}")
                    return False
                
                print("\n📝 Streaming response:")
                print("-" * 40)
                full_content = ""
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            event = json.loads(data)
                            event_type = event.get("type", "")
                            
                            # Handle Anthropic event types
                            if event_type == "content_block_delta":
                                delta = event.get("delta", {})
                                if delta.get("type") == "text_delta":
                                    text = delta.get("text", "")
                                    print(text, end="", flush=True)
                                    full_content += text
                            elif event_type == "message_stop":
                                break
                        except json.JSONDecodeError:
                            pass
                print("\n" + "-" * 40)
                print("✅ Anthropic streaming SUCCESS!")
                return True
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        return False


async def main():
    config = load_config()
    model_config = config.get("model", {})
    
    api_key = model_config.get("api_key")
    model_name = model_config.get("model_name")
    
    print("=" * 50)
    print("OpenRouter Streaming API Test")
    print("=" * 50)
    print(f"📦 Config Model: {model_name}")
    print(f"🔑 API Key: {api_key[:15]}...{api_key[-10:]}")
    
    # Test with config model
    print(f"\n\n🔄 Testing with: {model_name}")
    openai_result = await test_openai_streaming(api_key, model_name)
    anthropic_result = await test_anthropic_streaming(api_key, model_name)
    
    # Test with Claude model for comparison
    claude_model = "anthropic/claude-3-haiku"
    print(f"\n\n🔄 Testing with: {claude_model}")
    claude_openai_result = await test_openai_streaming(api_key, claude_model)
    claude_anthropic_result = await test_anthropic_streaming(api_key, claude_model)
    
    # Summary
    print("\n\n" + "=" * 50)
    print("📊 SUMMARY")
    print("=" * 50)
    print(f"{'Model':<35} {'OpenAI':<12} {'Anthropic':<12}")
    print("-" * 59)
    print(f"{model_name:<35} {'✅' if openai_result else '❌':<12} {'✅' if anthropic_result else '❌':<12}")
    print(f"{claude_model:<35} {'✅' if claude_openai_result else '❌':<12} {'✅' if claude_anthropic_result else '❌':<12}")


if __name__ == "__main__":
    asyncio.run(main())
