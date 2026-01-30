"""
Workspace data models.

A Workspace represents a working directory with its own sessions, config, and memory.
"""
from dataclasses import dataclass, field
from typing import Optional, List
import time
import uuid


@dataclass
class Workspace:
    """A workspace representing a working directory."""
    id: str
    name: str                           # Display name (defaults to directory name)
    path: str                           # Absolute path to the working directory
    created_at: float
    last_accessed_at: float
    icon: Optional[str] = None          # Custom icon (optional)
    color: Optional[str] = None         # Theme color (optional)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "created_at": self.created_at,
            "last_accessed_at": self.last_accessed_at,
            "icon": self.icon,
            "color": self.color,
        }

    def to_summary(self) -> dict:
        """Return workspace metadata for list view."""
        return {
            "id": self.id,
            "name": self.name,
            "path": self.path,
            "last_accessed_at": self.last_accessed_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Workspace":
        return cls(
            id=data["id"],
            name=data["name"],
            path=data["path"],
            created_at=data["created_at"],
            last_accessed_at=data["last_accessed_at"],
            icon=data.get("icon"),
            color=data.get("color"),
        )

    @classmethod
    def create(cls, path: str, name: Optional[str] = None) -> "Workspace":
        """Create a new workspace for the given path."""
        from pathlib import Path
        now = time.time()
        dir_path = Path(path)
        return cls(
            id=str(uuid.uuid4()),
            name=name or dir_path.name,
            path=str(dir_path.resolve()),
            created_at=now,
            last_accessed_at=now,
        )

    def touch(self) -> None:
        """Update last_accessed_at to current time."""
        self.last_accessed_at = time.time()


@dataclass
class MCPServerConfig:
    """MCP server configuration."""
    name: str
    type: str = "stdio"                 # stdio or sse
    command: str = ""
    args: List[str] = field(default_factory=list)
    url: str = ""
    env: dict = field(default_factory=dict)
    enabled: bool = True

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "type": self.type,
            "command": self.command,
            "args": self.args,
            "url": self.url,
            "env": self.env,
            "enabled": self.enabled,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "MCPServerConfig":
        return cls(
            name=data["name"],
            type=data.get("type", "stdio"),
            command=data.get("command", ""),
            args=data.get("args", []),
            url=data.get("url", ""),
            env=data.get("env", {}),
            enabled=data.get("enabled", True),
        )


@dataclass
class WorkspaceConfig:
    """Workspace-level configuration stored in .opencowork/config.json."""
    mcp_servers: List[MCPServerConfig] = field(default_factory=list)
    disabled_global_mcp: List[str] = field(default_factory=list)  # Global MCP servers to disable
    preferred_endpoint: Optional[str] = None
    preferred_model: Optional[str] = None
    allowed_tools: Optional[List[str]] = None  # Override global tool permissions

    def to_dict(self) -> dict:
        return {
            "mcp_servers": [s.to_dict() for s in self.mcp_servers],
            "disabled_global_mcp": self.disabled_global_mcp,
            "model": {
                "preferred_endpoint": self.preferred_endpoint,
                "preferred_model": self.preferred_model,
            } if self.preferred_endpoint or self.preferred_model else None,
            "allowed_tools": self.allowed_tools,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceConfig":
        mcp_servers = [MCPServerConfig.from_dict(s) for s in data.get("mcp_servers", [])]
        model_config = data.get("model", {}) or {}
        return cls(
            mcp_servers=mcp_servers,
            disabled_global_mcp=data.get("disabled_global_mcp", []),
            preferred_endpoint=model_config.get("preferred_endpoint"),
            preferred_model=model_config.get("preferred_model"),
            allowed_tools=data.get("allowed_tools"),
        )
