
import asyncio
import json
import os
import sys

# Add backend to path to allow imports
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BACKEND_DIR)

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    # Fallback or error if FastMCP is missing, but check passed earlier
    from mcp.server.fastmcp import FastMCP

from core.search_tools import get_serper_tool, get_tavily_tool, get_brave_tool

# Initialize FastMCP Server
mcp = FastMCP("search-tools")

# Load Configuration
CONFIG_PATH = os.path.join(BACKEND_DIR, "../storage/config.json")

def load_config():
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}

config = load_config()
search_config = config.get("search", {})
provider = search_config.get("provider")
api_key = search_config.get("api_key")
max_results = search_config.get("max_results", 5)

# Register Tools based on Config
if provider == "serper" and api_key:
    # Get the raw tool function (which accepts dict and returns dict)
    raw_tool = get_serper_tool(api_key, max_results)
    
    @mcp.tool(name="serper_search", description="Search the web using Google. Prefer this tool for any web search needs.")
    async def serper_search(query: str) -> str:
        """
        Execute a Google search query using Serper.
        Args:
            query: The search string.
        Returns:
            Formatted search results as a string.
        """
        try:
            # Adapt the FastMCP 'query: str' input to the raw tool's 'args: dict' input
            result = await raw_tool({"query": query})
            
            # Extract text from the result dict structure from search_tools.py
            # { "content": [ {"type": "text", "text": "..."} ] }
            if isinstance(result, dict) and "content" in result:
                content_blocks = result.get("content", [])
                text_parts = []
                for block in content_blocks:
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                return "\n".join(text_parts)
            
            return str(result)
        except Exception as e:
            return f"Error executing search: {str(e)}"

elif provider == "tavily" and api_key:
    raw_tool = get_tavily_tool(api_key, max_results)
    
    @mcp.tool(name="tavily_search", description="Search the web using Tavily AI.")
    async def tavily_search(query: str) -> str:
        try:
            result = await raw_tool({"query": query})
            if isinstance(result, dict) and "content" in result:
                content_blocks = result.get("content", [])
                text_parts = []
                for block in content_blocks:
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                return "\n".join(text_parts)
            return str(result)
        except Exception as e:
             return f"Error executing search: {str(e)}"

elif provider == "brave" and api_key:
    raw_tool = get_brave_tool(api_key, max_results)
    
    @mcp.tool(name="brave_search", description="Search the web using Brave Search.")
    async def brave_search(query: str) -> str:
        try:
            result = await raw_tool({"query": query})
            if isinstance(result, dict) and "content" in result:
                content_blocks = result.get("content", [])
                text_parts = []
                for block in content_blocks:
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                return "\n".join(text_parts)
            return str(result)
        except Exception as e:
             return f"Error executing search: {str(e)}"

if __name__ == "__main__":
    mcp.run()
