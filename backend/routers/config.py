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


# ============== File Listing ==============

class FileItem(BaseModel):
    """File item for directory listing."""
    name: str
    path: str  # relative path
    is_directory: bool


# ============== Skills & Agents ==============

class SkillInfo(BaseModel):
    """Skill information."""
    name: str
    path: str
    source: str  # 'user' or 'project'

class SubagentInfo(BaseModel):
    """Subagent information."""
    name: str
    path: Optional[str] = None
    source: str  # 'user' or 'project'
    is_builtin: bool = False

@router.get("/skills-agents")
async def get_skills_agents(request: Request):
    """
    Scan filesystem for available skills and agents.
    Returns items from ~/.claude/ (user) and .claude/ (project).
    """
    import os
    import glob
    
    settings = request.app.state.settings
    workdir = settings.default_workdir or os.getcwd()
    
    skills = []
    agents = []
    
    # Paths to scan
    scan_paths = [
        (os.path.expanduser("~/.claude"), "user"),
        (os.path.join(workdir, ".claude"), "project"),
    ]
    
    for base_path, source in scan_paths:
        # Scan skills
        skills_dir = os.path.join(base_path, "skills")
        if os.path.isdir(skills_dir):
            for item in os.listdir(skills_dir):
                skill_path = os.path.join(skills_dir, item)
                skill_md = os.path.join(skill_path, "SKILL.md")
                if os.path.isdir(skill_path) and os.path.isfile(skill_md):
                    skills.append(SkillInfo(
                        name=item,
                        path=skill_md,
                        source=source
                    ))
        
        # Scan agents
        agents_dir = os.path.join(base_path, "agents")
        if os.path.isdir(agents_dir):
            for f in glob.glob(os.path.join(agents_dir, "*.md")):
                agent_name = os.path.basename(f).replace(".md", "")
                agents.append(SubagentInfo(
                    name=agent_name,
                    path=f,
                    source=source,
                    is_builtin=False
                ))
    
    
    return {
        "skills": [s.model_dump() for s in skills],
        "agents": [a.model_dump() for a in agents],
        "workdir": workdir
    }


# ============== File Listing ==============

@router.get("/files")
async def list_files(request: Request, subdir: str = "", recursive: bool = True):
    """List files in the working directory recursively."""
    settings = request.app.state.settings
    workdir = settings.default_workdir
    
    if not workdir:
        return {"status": "error", "detail": "No working directory configured", "files": []}
    
    base_path = Path(workdir)
    if not base_path.exists():
        return {"status": "error", "detail": f"Working directory does not exist: {workdir}", "files": []}
    
    # Calculate target directory
    target_path = base_path / subdir if subdir else base_path
    if not target_path.exists():
        return {"status": "error", "detail": f"Directory does not exist: {subdir}", "files": []}
    
    # Common patterns to ignore
    IGNORE_PATTERNS = {
        'node_modules', '__pycache__', '.git', '.venv', 'venv', 
        '.next', 'dist', 'build', '.cache', '.idea', '.vscode',
        'coverage', '.pytest_cache', '.mypy_cache', 'eggs', '*.egg-info'
    }
    
    try:
        files = []
        max_files = 2000  # Increased limit for comprehensive file listing
        
        def should_ignore(name: str) -> bool:
            if name.startswith('.'):
                return True
            return name in IGNORE_PATTERNS
        
        def scan_directory(dir_path: Path, depth: int = 0):
            """Recursively scan directory for files."""
            if len(files) >= max_files:
                return
            if depth > 10:  # Max recursion depth
                return
                
            try:
                items = sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            except PermissionError:
                return
            
            for item in items:
                if len(files) >= max_files:
                    return
                    
                if should_ignore(item.name):
                    continue
                
                # Calculate relative path from base workdir
                rel_path = str(item.relative_to(base_path))
                if item.is_dir():
                    rel_path += "/"
                
                files.append(FileItem(
                    name=item.name,
                    path=rel_path,
                    is_directory=item.is_dir()
                ))
                
                # Recurse into subdirectories
                if recursive and item.is_dir():
                    scan_directory(item, depth + 1)
        
        scan_directory(target_path)
        
        # Sort: directories first, then by path
        files.sort(key=lambda f: (not f.is_directory, f.path.lower()))
        
        return {"status": "success", "files": files, "workdir": workdir, "total": len(files)}
    except Exception as e:
        return {"status": "error", "detail": str(e), "files": []}
