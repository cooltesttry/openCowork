"""
Worker template management API router.
"""
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Storage path
STORAGE_DIR = Path(__file__).parent.parent.parent / "storage"
AGENTS_FILE = STORAGE_DIR / "agents.json"


class WorkerConfig(BaseModel):
    """Worker configuration schema."""
    id: str
    name: str
    model: str
    provider: Optional[str] = None
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    mcp_inherit_system: bool = True  # If True, inherit system MCP settings
    mcp_selected: list[str] = Field(default_factory=list)  # Selected MCP server names
    mcp_servers: object = Field(default_factory=list)  # Legacy field, computed at runtime
    prompt: dict = Field(default_factory=dict)
    tools_allow: list[str] = Field(default_factory=list)
    tools_block: list[str] = Field(default_factory=list)
    env: dict = Field(default_factory=dict)
    cwd: Optional[str] = None
    max_turns: int = 1
    max_tokens: int = 0
    max_thinking_tokens: int = 0
    setting_sources: list[str] = Field(default_factory=list)
    permission_mode: Optional[str] = None
    include_partial_messages: bool = False
    output_format: Optional[dict] = None
    preserve_context: bool = False


def create_default_worker() -> dict:
    """Create default worker configuration."""
    return {
        "id": "default",
        "name": "Default Worker",
        "model": "claude-3-5-sonnet-20241022",
        "provider": "openrouter",
        "api_key": "",
        "endpoint": "",
        "mcp_inherit_system": True,
        "mcp_selected": [],
        "mcp_servers": [],
        "prompt": {
            "system": "You are a helpful assistant.",
            "user": ""
        },
        "tools_allow": ["Read", "Write", "Edit", "Bash", "Glob"],
        "tools_block": [],
        "env": {},
        "cwd": None,
        "max_turns": 10,
        "max_tokens": 8000,
        "max_thinking_tokens": 0,
        "setting_sources": ["project"],
        "permission_mode": "bypassPermissions",
        "include_partial_messages": False,
        "output_format": None,
        "preserve_context": False
    }


def load_agents() -> dict:
    """Load all worker configurations from file."""
    if not AGENTS_FILE.exists():
        # Initialize with default worker
        default_data = {"workers": [create_default_worker()]}
        save_agents(default_data)
        return default_data
    
    try:
        with open(AGENTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load agents: {str(e)}")


def save_agents(data: dict) -> None:
    """Save all worker configurations to file."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with open(AGENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save agents: {str(e)}")


# ============== CRUD Operations ==============

@router.get("/")
async def list_workers():
    """Get all worker configurations."""
    data = load_agents()
    return {"status": "success", "workers": data["workers"]}


@router.get("/{agent_id}")
async def get_worker(agent_id: str):
    """Get a specific worker configuration by ID."""
    data = load_agents()
    
    for worker in data["workers"]:
        if worker["id"] == agent_id:
            return {"status": "success", "worker": worker}
    
    raise HTTPException(status_code=404, detail=f"Worker '{agent_id}' not found")


@router.post("/")
async def create_worker(config: WorkerConfig):
    """Create a new worker configuration."""
    data = load_agents()
    
    # Check for duplicate ID
    if any(w["id"] == config.id for w in data["workers"]):
        raise HTTPException(status_code=400, detail=f"Worker ID '{config.id}' already exists")
    
    # Add new worker
    data["workers"].append(config.model_dump())
    save_agents(data)
    
    return {"status": "success", "id": config.id}


@router.put("/{agent_id}")
async def update_worker(agent_id: str, config: WorkerConfig):
    """Update an existing worker configuration."""
    data = load_agents()
    
    # Find and update worker
    for i, worker in enumerate(data["workers"]):
        if worker["id"] == agent_id:
            # Ensure ID remains the same
            if config.id != agent_id:
                raise HTTPException(
                    status_code=400, 
                    detail="Cannot change worker ID. Create a new worker instead."
                )
            data["workers"][i] = config.model_dump()
            save_agents(data)
            return {"status": "success", "id": agent_id}
    
    raise HTTPException(status_code=404, detail=f"Worker '{agent_id}' not found")


@router.delete("/{agent_id}")
async def delete_worker(agent_id: str):
    """Delete a worker configuration."""
    data = load_agents()
    
    # Prevent deletion of default worker
    if agent_id == "default":
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete the default worker"
        )
    
    # Find and remove worker
    for i, worker in enumerate(data["workers"]):
        if worker["id"] == agent_id:
            data["workers"].pop(i)
            save_agents(data)
            return {"status": "success", "id": agent_id}
    
    raise HTTPException(status_code=404, detail=f"Worker '{agent_id}' not found")


@router.post("/validate")
async def validate_worker(config: WorkerConfig):
    """Validate a worker configuration."""
    try:
        # Pydantic validation happens automatically
        # Additional custom validation can be added here
        errors = []
        
        # Check required fields
        if not config.id:
            errors.append("ID is required")
        if not config.name:
            errors.append("Name is required")
        if not config.model:
            errors.append("Model is required")
        
        # Check permission mode
        if config.permission_mode and config.permission_mode not in [
            "default", "plan", "acceptEdits", "bypassPermissions"
        ]:
            errors.append(f"Invalid permission_mode: {config.permission_mode}")
        
        if errors:
            return {"valid": False, "errors": errors}
        
        return {"valid": True}
    
    except Exception as e:
        return {"valid": False, "errors": [str(e)]}
