"""
Search tool implementations for various providers.
"""
import httpx
from typing import Any, Callable

def get_serper_tool(api_key: str, max_results: int = 5) -> Callable:
    """Create a Google search tool using Serper API."""
    
    async def google_search(args: dict) -> dict:
        """
        Perform a Google search to find information about current events, market data, or general knowledge.
        Use this tool when you need information that you don't have in your internal knowledge base.
        """
        query = args.get("query")
        if not query:
             return {"content": [{"type": "text", "text": "Error: query argument is required"}], "is_error": True}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                    json={"q": query, "num": max_results},
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()
                
                # Format results as JSON array
                results = []
                for item in data.get("organic", [])[:max_results]:
                    results.append({
                        "url": item.get('link', ''),
                        "title": item.get('title', ''),
                        "snippet": item.get('snippet', ''),
                        "date": item.get('date', '')
                    })
                
                import json
                return {"content": [{"type": "text", "text": json.dumps(results, ensure_ascii=False)}]}
                
        except Exception as e:
             return {"content": [{"type": "text", "text": f"Search failed: {str(e)}"}], "is_error": True}
            
    return google_search

def get_tavily_tool(api_key: str, max_results: int = 5) -> Callable:
    """Create a search tool using Tavily API."""
    
    async def tavily_search(args: dict) -> dict:
        """
        Perform a search using Tavily AI search engine to find accurate and up-to-date information.
        Optimized for AI context gathering.
        """
        query = args.get("query")
        if not query:
             return {"content": [{"type": "text", "text": "Error: query argument is required"}], "is_error": True}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.tavily.com/search",
                    headers={"Content-Type": "application/json"},
                    json={
                        "api_key": api_key,
                        "query": query,
                        "max_results": max_results,
                        "search_depth": "basic"
                    },
                    timeout=15.0,
                )
                response.raise_for_status()
                data = response.json()
                
                results = []
                for item in data.get("results", []):
                    results.append(f"- {item.get('title', '')}: {item.get('content', '')}")
                
                text_result = "\n".join(results) if results else "No results found."
                return {"content": [{"type": "text", "text": text_result}]}

        except Exception as e:
            return {"content": [{"type": "text", "text": f"Search failed: {str(e)}"}], "is_error": True}
            
    return tavily_search

def get_brave_tool(api_key: str, max_results: int = 5) -> Callable:
    """Create a search tool using Brave Search API."""
    
    async def brave_search(args: dict) -> dict:
        """
        Perform a private search using Brave Search API.
        """
        query = args.get("query")
        if not query:
             return {"content": [{"type": "text", "text": "Error: query argument is required"}], "is_error": True}

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={"X-Subscription-Token": api_key},
                    params={"q": query, "count": max_results},
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()
                
                results = []
                # Brave response structure handling might need adjustment based on exact API version
                # Assuming standard web.results structure
                if "web" in data and "results" in data["web"]:
                    for item in data["web"]["results"]:
                         results.append(f"- {item.get('title', '')}: {item.get('description', '')}")
                
                text_result = "\n".join(results) if results else "No results found."
                return {"content": [{"type": "text", "text": text_result}]}

        except Exception as e:
            return {"content": [{"type": "text", "text": f"Search failed: {str(e)}"}], "is_error": True}
            
    return brave_search
