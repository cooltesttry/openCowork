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
class WorkspaceConfig:
    """Workspace-level configuration stored in .opencowork/config.json."""
    enabled_mcp_ids: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "enabled_mcp_ids": self.enabled_mcp_ids,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkspaceConfig":
        enabled = data.get("enabled_mcp_ids") or []
        if not isinstance(enabled, list):
            enabled = []
        enabled = [str(v) for v in enabled if v]
        return cls(enabled_mcp_ids=enabled)
