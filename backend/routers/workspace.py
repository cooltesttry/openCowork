"""
Workspace management REST API endpoints.
"""
import logging
import os
import shutil
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.workspace_storage import WorkspaceManager
from core.skills_catalog import SKILLS_DIR, load_catalog, rebuild_catalog
from core.mcp_registry import resolve_enabled_mcp_servers, migrate_workspace_mcp_config, seed_workspace_mcp_defaults
from routers.config import save_workdir, save_settings


logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== Request/Response Models ====================

class OpenWorkspaceRequest(BaseModel):
    """Request to open a directory as workspace."""
    path: str
    name: Optional[str] = None


class UpdateWorkspaceRequest(BaseModel):
    """Request to update workspace metadata."""
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class WorkspaceMcpAddRequest(BaseModel):
    """Request to enable an MCP server from the global library."""
    id: Optional[str] = None
    name: Optional[str] = None


class UpdateWorkspaceConfigRequest(BaseModel):
    """Request to update workspace configuration."""
    enabled_mcp_ids: Optional[List[str]] = None


class WorkspaceSkillInfo(BaseModel):
    """Workspace-installed skill info."""
    id: str
    name: str
    description: str = ""
    path: str


class WorkspaceSkillAddRequest(BaseModel):
    skill_id: str


class WorkspaceSkillRemoveRequest(BaseModel):
    skill_id: str


class WorkspaceMcpDisableRequest(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None

# ==================== Helper ====================

def get_workspace_manager(request: Request) -> WorkspaceManager:
    """Get workspace manager from app state or create one."""
    if not hasattr(request.app.state, 'workspace_manager'):
        # Initialize with global config path
        from pathlib import Path
        config_path = Path(__file__).parent.parent.parent / "storage" / "config.json"
        request.app.state.workspace_manager = WorkspaceManager(config_path)
    return request.app.state.workspace_manager


SKILL_FILENAME = "SKILL.md"


def _parse_frontmatter_text(text: str) -> Dict[str, str]:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    frontmatter = parts[1].strip("\n")
    data: Dict[str, str] = {}
    lines = frontmatter.splitlines()
    idx = 0
    while idx < len(lines):
        line = lines[idx].rstrip()
        idx += 1
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value in {"|", ">", "|-", ">-"}:
            block_lines: List[str] = []
            while idx < len(lines):
                block_line = lines[idx]
                if block_line.startswith(" ") or block_line.startswith("\t"):
                    block_lines.append(block_line.lstrip())
                    idx += 1
                else:
                    break
            data[key] = "\n".join(block_lines).strip()
        else:
            if value.startswith("\"") and value.endswith("\""):
                value = value[1:-1]
            if value.startswith("'") and value.endswith("'"):
                value = value[1:-1]
            data[key] = value
    return data


def _list_workspace_skills(skills_dir: Path) -> List[WorkspaceSkillInfo]:
    if not skills_dir.exists():
        return []
    results: List[WorkspaceSkillInfo] = []
    for path in sorted(skills_dir.iterdir()):
        if not path.is_dir():
            continue
        skill_md = path / SKILL_FILENAME
        if not skill_md.exists():
            continue
        try:
            text = skill_md.read_text(encoding="utf-8")
        except Exception:
            text = ""
        frontmatter = _parse_frontmatter_text(text)
        name = frontmatter.get("name") or path.name
        description = frontmatter.get("description") or ""
        results.append(
            WorkspaceSkillInfo(
                id=path.name,
                name=name,
                description=description,
                path=str(skill_md),
            )
        )
    return results


def _sync_workspace_mcp_config(storage, settings, config_existed: bool) -> None:
    """Migrate workspace MCP config and seed defaults for new workspaces."""
    ws_changed, global_changed = migrate_workspace_mcp_config(storage, settings)
    if not config_existed:
        seed_workspace_mcp_defaults(storage, settings)
    if global_changed:
        save_settings(settings)


def _serialize_workspace_mcp_servers(servers) -> List[dict]:
    return [{**server.model_dump(), "enabled": True} for server in servers]


# ==================== Endpoints ====================

@router.get("/recent")
async def list_recent_workspaces(request: Request):
    """
    List recently used workspaces.
    Returns workspaces sorted by last_accessed_at (most recent first).
    """
    manager = get_workspace_manager(request)
    workspaces = manager.get_recent_workspaces()
    return {"workspaces": workspaces}


@router.get("/current")
async def get_current_workspace(request: Request):
    """
    Get the current active workspace.
    Returns null if no workspace is currently active.
    """
    manager = get_workspace_manager(request)
    workspace = manager.get_current_workspace()

    if not workspace:
        return {"workspace": None}

    return {"workspace": workspace.to_dict()}


@router.post("/open")
async def open_workspace(request: Request, body: OpenWorkspaceRequest):
    """
    Open a directory as a workspace.

    - If .opencowork/ exists, reads existing workspace data
    - If not, initializes new workspace
    - Adds to recent workspaces
    - Sets as current workspace
    """
    path = Path(body.path).expanduser().resolve()

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Directory not found: {body.path}")

    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {body.path}")

    manager = get_workspace_manager(request)
    storage = manager.get_storage(str(path))
    config_existed = storage.config_file.exists()
    workspace = manager.open_workspace(str(path), body.name)

    # Migrate/seed MCP config for this workspace
    _sync_workspace_mcp_config(storage, request.app.state.settings, config_existed)

    # Update app settings with new workdir and sync to config.json
    settings = request.app.state.settings
    settings.default_workdir = str(path)
    save_workdir(str(path))

    return {"workspace": workspace.to_dict()}


@router.post("/switch/{workspace_id}")
async def switch_workspace(request: Request, workspace_id: str):
    """
    Switch to a workspace by ID.
    Updates current workspace and returns workspace data.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)
    config_existed = storage.config_file.exists() if storage else False
    workspace = manager.switch_workspace(workspace_id)

    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    storage = storage or manager.get_storage_by_id(workspace_id)
    if storage:
        _sync_workspace_mcp_config(storage, request.app.state.settings, config_existed)

    # Update app settings with new workdir and sync to config.json
    settings = request.app.state.settings
    settings.default_workdir = workspace.path
    save_workdir(workspace.path)

    return {"workspace": workspace.to_dict()}


@router.patch("/{workspace_id}")
async def update_workspace(request: Request, workspace_id: str, body: UpdateWorkspaceRequest):
    """
    Update workspace metadata (name, icon, color).
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    workspace = storage.get_workspace()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if body.name is not None:
        workspace.name = body.name
    if body.icon is not None:
        workspace.icon = body.icon
    if body.color is not None:
        workspace.color = body.color

    storage.update_workspace(workspace)

    # Update recent list with new name
    manager._add_to_recent(workspace)

    return {"workspace": workspace.to_dict()}


@router.delete("/{workspace_id}")
async def remove_workspace(request: Request, workspace_id: str):
    """
    Remove workspace from recent list.
    Does NOT delete the actual .opencowork/ data.
    """
    manager = get_workspace_manager(request)
    success = manager.remove_from_recent(workspace_id)

    if not success:
        raise HTTPException(status_code=404, detail="Workspace not found")

    return {"success": True, "removed_id": workspace_id}


# ==================== Workspace Sessions ====================

@router.get("/{workspace_id}/sessions")
async def list_workspace_sessions(request: Request, workspace_id: str):
    """
    List sessions in a workspace.
    Returns sessions sorted by updated_at (newest first).
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    sessions = storage.list_sessions()
    return {"sessions": sessions}


@router.get("/{workspace_id}/sessions/{session_id}")
async def get_workspace_session(request: Request, workspace_id: str, session_id: str):
    """
    Get a session with full message history.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return session.to_dict()


@router.post("/{workspace_id}/sessions")
async def create_workspace_session(request: Request, workspace_id: str, title: str = "New Chat"):
    """
    Create a new session in a workspace.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    session = storage.create_session(title)
    return session.to_summary()


@router.delete("/{workspace_id}/sessions/{session_id}")
async def delete_workspace_session(request: Request, workspace_id: str, session_id: str):
    """
    Delete a session from a workspace.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    success = storage.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    return {"success": True, "deleted_id": session_id}


# ==================== Workspace Config ====================

@router.get("/{workspace_id}/config")
async def get_workspace_config(request: Request, workspace_id: str):
    """
    Get workspace configuration (MCP servers, etc.).
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    config = storage.get_config()
    return {"config": config.to_dict()}


@router.patch("/{workspace_id}/config")
async def update_workspace_config(request: Request, workspace_id: str, body: UpdateWorkspaceConfigRequest):
    """
    Update workspace configuration.
    Only updates fields that are provided (partial update).
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    config = storage.get_config()

    if body.enabled_mcp_ids is not None:
        config.enabled_mcp_ids = [str(v) for v in body.enabled_mcp_ids if v]

    storage.update_config(config)

    return {"config": config.to_dict()}


# ==================== Workspace Skills ====================

@router.get("/{workspace_id}/skills")
async def list_workspace_skills(request: Request, workspace_id: str):
    """
    List skills installed in the workspace (.claude/skills).
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    storage.skills_dir.mkdir(parents=True, exist_ok=True)
    skills = _list_workspace_skills(storage.skills_dir)
    return {
        "skills": [skill.model_dump() for skill in skills],
        "workdir": str(storage.workspace_path),
    }


@router.post("/{workspace_id}/skills/add")
async def add_workspace_skill(request: Request, workspace_id: str, body: WorkspaceSkillAddRequest):
    """
    Add a skill to the workspace by linking/copying from storage/skills.
    Attempts symlink first, falls back to copy.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    catalog = load_catalog()
    if not catalog:
        catalog = rebuild_catalog()
    entry = (catalog.get("skills") or {}).get(body.skill_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Skill not found in library")
    if entry.get("status", {}).get("state") == "removed":
        raise HTTPException(status_code=400, detail="Skill is removed from library")

    source = entry.get("source", {})
    source_path = source.get("path")
    if not source_path:
        raise HTTPException(status_code=400, detail="Skill source path missing")

    source_dir = (SKILLS_DIR / source_path).resolve()
    if not str(source_dir).startswith(str(SKILLS_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid skill source path")
    if not source_dir.is_dir():
        raise HTTPException(status_code=404, detail="Skill source directory missing")

    dest_name = Path(source_path).name
    if not dest_name:
        raise HTTPException(status_code=400, detail="Invalid skill destination name")

    storage.skills_dir.mkdir(parents=True, exist_ok=True)
    dest_dir = storage.skills_dir / dest_name

    if dest_dir.exists() or dest_dir.is_symlink():
        raise HTTPException(status_code=400, detail="Skill already installed in workspace")

    mode = "symlink"
    try:
        os.symlink(source_dir, dest_dir, target_is_directory=True)
    except Exception:
        mode = "copy"
        shutil.copytree(source_dir, dest_dir)

    skills = _list_workspace_skills(storage.skills_dir)
    return {
        "status": "success",
        "mode": mode,
        "skills": [skill.model_dump() for skill in skills],
    }


@router.post("/{workspace_id}/skills/remove")
async def remove_workspace_skill(request: Request, workspace_id: str, body: WorkspaceSkillRemoveRequest):
    """
    Remove a skill from the workspace (.claude/skills). Does not touch library.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    skill_id = body.skill_id.strip()
    if not skill_id or "/" in skill_id or "\\" in skill_id or skill_id in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid skill id")

    target = storage.skills_dir / skill_id
    if not target.exists() and not target.is_symlink():
        raise HTTPException(status_code=404, detail="Skill not found in workspace")

    if target.is_symlink() or target.is_file():
        target.unlink()
    else:
        shutil.rmtree(target)

    skills = _list_workspace_skills(storage.skills_dir)
    return {
        "status": "success",
        "skills": [skill.model_dump() for skill in skills],
    }


# ==================== Workspace MCP Servers ====================

@router.get("/{workspace_id}/mcp-servers")
async def list_workspace_mcp_servers(request: Request, workspace_id: str):
    """List MCP servers configured for a workspace."""
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    config = storage.get_config()
    settings = request.app.state.settings
    servers = resolve_enabled_mcp_servers(settings, config.enabled_mcp_ids)
    return {"servers": _serialize_workspace_mcp_servers(servers)}


@router.post("/{workspace_id}/mcp-servers")
async def add_workspace_mcp_server(request: Request, workspace_id: str, body: WorkspaceMcpAddRequest):
    """Enable an MCP server for a workspace by ID (from global library)."""
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    mcp_id = (body.id or "").strip()
    mcp_name = (body.name or "").strip()
    if not mcp_id and not mcp_name:
        raise HTTPException(status_code=400, detail="MCP server id or name is required")

    settings = request.app.state.settings
    target = None
    if mcp_id:
        target = next((s for s in settings.mcp_servers if s.id == mcp_id), None)
    if not target and mcp_name:
        target = next((s for s in settings.mcp_servers if s.name == mcp_name), None)
        if target:
            mcp_id = target.id

    if not target or not mcp_id:
        raise HTTPException(status_code=404, detail="MCP server not found in global library")

    config = storage.get_config()
    enabled = list(config.enabled_mcp_ids or [])
    if mcp_id not in enabled:
        enabled.append(mcp_id)
        config.enabled_mcp_ids = enabled
        storage.update_config(config)

    servers = resolve_enabled_mcp_servers(settings, config.enabled_mcp_ids)
    return {"servers": _serialize_workspace_mcp_servers(servers)}


@router.post("/{workspace_id}/mcp-servers/disable")
async def disable_workspace_mcp_server(request: Request, workspace_id: str, body: WorkspaceMcpDisableRequest):
    """Disable an MCP server for a workspace (remove from enabled list)."""
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    mcp_id = (body.id or "").strip()
    mcp_name = (body.name or "").strip()
    if not mcp_id and not mcp_name:
        raise HTTPException(status_code=400, detail="MCP server id or name is required")

    settings = request.app.state.settings
    if not mcp_id and mcp_name:
        target = next((s for s in settings.mcp_servers if s.name == mcp_name), None)
        if target:
            mcp_id = target.id

    if not mcp_id:
        raise HTTPException(status_code=404, detail="MCP server not found")

    config = storage.get_config()
    enabled = [v for v in (config.enabled_mcp_ids or []) if v != mcp_id]
    if len(enabled) == len(config.enabled_mcp_ids or []):
        raise HTTPException(status_code=404, detail="MCP server not enabled in workspace")

    config.enabled_mcp_ids = enabled
    storage.update_config(config)
    servers = resolve_enabled_mcp_servers(settings, config.enabled_mcp_ids)
    return {"servers": _serialize_workspace_mcp_servers(servers)}


# ==================== Effective MCP Servers ====================

@router.get("/{workspace_id}/mcp-servers/effective")
async def get_effective_mcp_servers(request: Request, workspace_id: str):
    """
    Get effective MCP servers for a workspace.

    Uses workspace-enabled MCP IDs to select servers from the global library.
    """
    manager = get_workspace_manager(request)
    storage = manager.get_storage_by_id(workspace_id)

    if not storage:
        raise HTTPException(status_code=404, detail="Workspace not found")

    settings = request.app.state.settings
    ws_config = storage.get_config()
    servers = resolve_enabled_mcp_servers(settings, ws_config.enabled_mcp_ids)
    return {"servers": _serialize_workspace_mcp_servers(servers)}
