"""
Configuration API router.
"""
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from models.settings import AppSettings, ModelAPIConfig, MCPServerConfig, SearchConfig
from core.mcp_inspector import inspect_mcp_tools


router = APIRouter()

# Storage path
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage"
CONFIG_FILE = STORAGE_DIR / "config.json"


def save_settings(settings: AppSettings) -> None:
    """Save settings to config file."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)


# ============== Full Settings ==============

@router.get("/", response_model=AppSettings)
async def get_settings(request: Request):
    """Get all settings."""
    return request.app.state.settings


@router.put("/")
async def update_settings(request: Request, settings: AppSettings):
    """Update all settings."""
    request.app.state.settings = settings
    save_settings(settings)
    return {"status": "success"}


# ============== Model API Config ==============

@router.get("/model", response_model=ModelAPIConfig)
async def get_model_config(request: Request):
    """Get model API configuration."""
    return request.app.state.settings.model


@router.put("/model")
async def update_model_config(request: Request, config: ModelAPIConfig):
    """Update model API configuration."""
    request.app.state.settings.model = config
    save_settings(request.app.state.settings)
    return {"status": "success"}


@router.post("/model/list")
async def list_models(request: Request, config: ModelAPIConfig):
    """Fetch available models based on provided config."""
    from core.model_fetcher import fetch_available_models
    try:
        models = await fetch_available_models(config.provider, config.api_key, config.endpoint)
        return {"status": "success", "models": models}
    except Exception as e:
        # Fallback or error
        return {"status": "error", "detail": str(e), "models": []}



# ============== MCP Servers ==============

@router.get("/mcp", response_model=list[MCPServerConfig])
async def get_mcp_servers(request: Request):
    """Get all MCP server configurations."""
    return request.app.state.settings.mcp_servers


@router.post("/mcp")
async def add_mcp_server(request: Request, config: MCPServerConfig):
    """Add a new MCP server configuration."""
    settings = request.app.state.settings
    
    # Check for duplicate name
    for server in settings.mcp_servers:
        if server.name == config.name:
            raise HTTPException(status_code=400, detail=f"Server '{config.name}' already exists")
    
    settings.mcp_servers.append(config)
    save_settings(settings)
    return {"status": "success", "name": config.name}


@router.put("/mcp/{name}")
async def update_mcp_server(request: Request, name: str, config: MCPServerConfig):
    """Update an MCP server configuration."""
    settings = request.app.state.settings
    
    for i, server in enumerate(settings.mcp_servers):
        if server.name == name:
            settings.mcp_servers[i] = config
            save_settings(settings)
            return {"status": "success"}
    
    raise HTTPException(status_code=404, detail=f"Server '{name}' not found")


@router.delete("/mcp/{name}")
async def delete_mcp_server(request: Request, name: str):
    """Delete an MCP server configuration."""
    settings = request.app.state.settings
    
    for i, server in enumerate(settings.mcp_servers):
        if server.name == name:
            settings.mcp_servers.pop(i)
            save_settings(settings)
            return {"status": "success"}
    
    raise HTTPException(status_code=404, detail=f"Server '{name}' not found")


@router.patch("/mcp/{name}/toggle")
async def toggle_mcp_server(request: Request, name: str):
    """Toggle an MCP server's enabled status."""
    settings = request.app.state.settings
    
    for server in settings.mcp_servers:
        if server.name == name:
            server.enabled = not server.enabled
            save_settings(settings)
            return {"status": "success", "enabled": server.enabled, "name": name}
    
    raise HTTPException(status_code=404, detail=f"Server '{name}' not found")


@router.get("/mcp/{name}/tools")
async def get_mcp_server_tools(request: Request, name: str):
    """Get list of tools for a specific MCP server."""
    settings = request.app.state.settings
    
    target_server = None
    for server in settings.mcp_servers:
        if server.name == name:
            target_server = server
            break
    
    if not target_server:
        raise HTTPException(status_code=404, detail=f"Server '{name}' not found")
    
    try:
        tools = await inspect_mcp_tools(target_server)
        return {"status": "success", "tools": tools}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to inspect tools: {str(e)}")


# ============== Search Config ==============

@router.get("/search", response_model=SearchConfig)
async def get_search_config(request: Request):
    """Get search configuration."""
    return request.app.state.settings.search


@router.put("/search")
async def update_search_config(request: Request, config: SearchConfig):
    """Update search configuration."""
    request.app.state.settings.search = config
    save_settings(request.app.state.settings)
    return {"status": "success"}


@router.patch("/search/toggle")
async def toggle_search(request: Request):
    """Toggle search enabled status."""
    settings = request.app.state.settings
    settings.search.enabled = not settings.search.enabled
    save_settings(settings)
    return {"status": "success", "enabled": settings.search.enabled}


# ============== Agent Behavior ==============

class AgentBehaviorConfig(BaseModel):
    """Agent behavior configuration."""
    allowed_tools: list[str]
    max_turns: int
    default_workdir: Optional[str] = None


@router.get("/agent", response_model=AgentBehaviorConfig)
async def get_agent_config(request: Request):
    """Get agent behavior configuration."""
    settings = request.app.state.settings
    return AgentBehaviorConfig(
        allowed_tools=settings.allowed_tools,
        max_turns=settings.max_turns,
        default_workdir=settings.default_workdir,
    )


@router.put("/agent")
async def update_agent_config(request: Request, config: AgentBehaviorConfig):
    """Update agent behavior configuration."""
    settings = request.app.state.settings
    settings.allowed_tools = config.allowed_tools
    settings.max_turns = config.max_turns
    settings.default_workdir = config.default_workdir
    save_settings(settings)
    return {"status": "success"}
