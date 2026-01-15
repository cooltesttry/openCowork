import httpx
from typing import List

STATIC_CLAUDE_MODELS = [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20240620",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
    "claude-3-5-haiku-20241022"
]

STATIC_OPENAI_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-4",
    "gpt-3.5-turbo"
]

STATIC_OPENROUTER_MODELS = [
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3-opus",
    "openai/gpt-4o",
    "openai/gpt-4-turbo",
    "google/gemini-pro-1.5",
    "meta-llama/llama-3.1-405b-instruct"
]

DEFAULT_ENDPOINTS = {
    "claude": "https://api.anthropic.com/v1",
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "local": "http://localhost:1234/v1",
}

STATIC_FALLBACKS = {
    "claude": STATIC_CLAUDE_MODELS,
    "openai": STATIC_OPENAI_MODELS,
    "openrouter": STATIC_OPENROUTER_MODELS,
}


async def fetch_available_models(provider: str, api_key: str | None, endpoint: str | None) -> List[str]:
    """
    Fetch available models for the given provider.
    Endpoint takes priority over provider defaults.
    """
    # Determine base URL: endpoint > provider default
    base_url = endpoint or DEFAULT_ENDPOINTS.get(provider, "")
    
    if not base_url:
        return STATIC_FALLBACKS.get(provider, [])
    
    # Ensure URL ends with /v1 for OpenAI-compatible APIs
    if not base_url.rstrip('/').endswith('/v1'):
        base_url = base_url.rstrip('/') + '/v1'
    
    url = f"{base_url.rstrip('/')}/models"
    
    headers = {}
    if api_key:
        # Claude uses x-api-key, OpenAI uses Authorization Bearer
        if provider == "claude" and not endpoint:
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            
            # OpenAI format: {"data": [{"id": "model-id", ...}], ...}
            if "data" in data and isinstance(data["data"], list):
                return [item["id"] for item in data["data"] if "id" in item]
            
            return []
    except Exception as e:
        print(f"Failed to fetch models from {url}: {e}")
        return STATIC_FALLBACKS.get(provider, [])

