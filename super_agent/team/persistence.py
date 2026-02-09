"""Persistence layer for Agent Team sessions."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .models import TeamSession

logger = logging.getLogger(__name__)


class TeamSessionStore:
    """Save/load/list TeamSession objects as JSON files."""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.sessions_dir = base_dir
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{session_id}.json"

    def save_session(self, session: TeamSession):
        """Save a session to disk."""
        from super_agent.models import utc_now
        session.updated_at = utc_now()
        path = self._session_path(session.session_id)
        try:
            path.write_text(
                json.dumps(session.to_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.error(f"[TeamStore] Failed to save session {session.session_id}: {e}")

    def load_session(self, session_id: str) -> TeamSession | None:
        """Load a session from disk."""
        path = self._session_path(session_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return TeamSession.from_dict(data)
        except Exception as e:
            logger.error(f"[TeamStore] Failed to load session {session_id}: {e}")
            return None

    def list_sessions(self) -> list[dict]:
        """Return summary list of all sessions."""
        sessions = []
        for path in sorted(self.sessions_dir.glob("*.json"), reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                sessions.append({
                    "session_id": data.get("session_id", path.stem),
                    "status": data.get("status", "unknown"),
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                    "objective": data.get("plan", {}).get("objective", "") if data.get("plan") else "",
                })
            except Exception as e:
                logger.warning(f"[TeamStore] Failed to read {path.name}: {e}")
        return sessions
