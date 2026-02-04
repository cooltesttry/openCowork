"""
MCP registry helpers:
- Ensure global MCP servers have stable IDs
- Migrate workspace MCP configs to ID-based enable lists
- Resolve workspace-enabled MCP servers from the global library
"""
import json
import logging
import uuid
from typing import Iterable, Tuple

from models.settings import AppSettings, MCPServerConfig
from core.workspace_storage import WorkspaceManager, WorkspaceStorage

logger = logging.getLogger(__name__)


def ensure_global_mcp_ids(settings: AppSettings) -> bool:
    """Ensure all global MCP servers have unique IDs. Returns True if mutated."""
    changed = False
    seen = set()
    for server in settings.mcp_servers:
        server_id = getattr(server, "id", None)
        if not server_id or server_id in seen:
            server.id = str(uuid.uuid4())
            changed = True
        seen.add(server.id)
    return changed


def resolve_enabled_mcp_servers(settings: AppSettings, enabled_ids: Iterable[str]) -> list[MCPServerConfig]:
    """Resolve enabled MCP servers from global library by ID."""
    enabled_set = {str(v) for v in enabled_ids if v}
    if not enabled_set:
        return []
    resolved: list[MCPServerConfig] = []
    for server in settings.mcp_servers:
        if server.id in enabled_set:
            cloned = server.model_copy(deep=True)
            cloned.enabled = True
            resolved.append(cloned)
    return resolved


def _dedupe_preserve_order(values: Iterable[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def migrate_workspace_mcp_config(storage: WorkspaceStorage, settings: AppSettings) -> Tuple[bool, bool]:
    """
    Migrate a workspace config file to enabled_mcp_ids format.
    Returns (workspace_changed, global_changed).
    """
    config_path = storage.config_file
    if not config_path.exists():
        return False, False

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[MCP Migration] Failed to read workspace config: {config_path} ({e})")
        return False, False

    if isinstance(raw, dict) and "enabled_mcp_ids" in raw:
        return False, False

    mcp_servers = []
    if isinstance(raw, dict):
        mcp_servers = raw.get("mcp_servers") or []

    enabled_ids: list[str] = []
    global_changed = False

    name_index = {s.name: s for s in settings.mcp_servers}

    for entry in mcp_servers:
        if not isinstance(entry, dict):
            continue
        if entry.get("enabled", True) is False:
            continue
        name = entry.get("name")
        if not name:
            continue
        server = name_index.get(name)
        if not server:
            server = MCPServerConfig(
                id=str(uuid.uuid4()),
                name=name,
                type=entry.get("type", "stdio"),
                command=entry.get("command"),
                args=entry.get("args") or [],
                url=entry.get("url"),
                env=entry.get("env") or {},
                enabled=False,
            )
            settings.mcp_servers.append(server)
            name_index[name] = server
            global_changed = True
        enabled_ids.append(server.id)

    migrated = {
        "enabled_mcp_ids": _dedupe_preserve_order([v for v in enabled_ids if v])
    }

    try:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(
            json.dumps(migrated, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        storage._config = None
        logger.info(f"[MCP Migration] Migrated workspace config: {config_path}")
        return True, global_changed
    except Exception as e:
        logger.warning(f"[MCP Migration] Failed to write workspace config: {config_path} ({e})")
        return False, global_changed


def migrate_all_workspace_mcp_configs(
    manager: WorkspaceManager,
    settings: AppSettings,
) -> Tuple[bool, bool]:
    """Migrate all recent workspaces. Returns (workspace_changed, global_changed)."""
    workspace_changed = False
    global_changed = False
    for ws in manager.get_recent_workspaces():
        path = ws.get("path")
        if not path:
            continue
        storage = manager.get_storage(path)
        ws_changed, global_added = migrate_workspace_mcp_config(storage, settings)
        if ws_changed:
            workspace_changed = True
        if global_added:
            global_changed = True
    return workspace_changed, global_changed


def seed_workspace_mcp_defaults(storage: WorkspaceStorage, settings: AppSettings) -> bool:
    """Seed a new workspace with globally-enabled MCP servers. Returns True if updated."""
    config = storage.get_config()
    if config.enabled_mcp_ids:
        return False
    default_ids = [s.id for s in settings.mcp_servers if s.enabled and s.id]
    if not default_ids:
        return False
    config.enabled_mcp_ids = _dedupe_preserve_order(default_ids)
    return storage.update_config(config)
