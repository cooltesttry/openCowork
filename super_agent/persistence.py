from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .models import CycleRecord, SessionState


def default_base_dir() -> Path:
    return Path(__file__).resolve().parents[1]


class WorkspaceLayout:
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)
        self.workspace_dir = self.base_dir / "workspace"

    def session_dir(self, session_id: str) -> Path:
        return self.workspace_dir / session_id

    def outputs_dir(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "outputs"

    def logs_dir(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "logs"

    def state_dir(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "state"

    def session_state_path(self, session_id: str) -> Path:
        return self.state_dir(session_id) / "session.json"

    def cycle_result_path(self, session_id: str, cycle_index: int) -> Path:
        filename = f"cycle_{cycle_index:04d}.json"
        return self.outputs_dir(session_id) / filename

    def log_path(self, session_id: str) -> Path:
        return self.logs_dir(session_id) / "events.log"

    def ensure(self, session_id: str) -> None:
        self.outputs_dir(session_id).mkdir(parents=True, exist_ok=True)
        self.logs_dir(session_id).mkdir(parents=True, exist_ok=True)
        self.state_dir(session_id).mkdir(parents=True, exist_ok=True)


class SessionStore:
    def __init__(self, base_dir: Optional[Path] = None):
        self.layout = WorkspaceLayout(base_dir or default_base_dir())

    def save_session(self, session: SessionState) -> None:
        self.layout.ensure(session.session_id)
        path = self.layout.session_state_path(session.session_id)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(session.to_dict(), handle, indent=2)

    def load_session(self, session_id: str) -> Optional[SessionState]:
        path = self.layout.session_state_path(session_id)
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return SessionState.from_dict(payload)

    def save_cycle(self, session_id: str, record: CycleRecord) -> None:
        self.layout.ensure(session_id)
        path = self.layout.cycle_result_path(session_id, record.cycle_index)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(record.to_dict(), handle, indent=2)

    def append_log(self, session_id: str, line: str) -> None:
        self.layout.ensure(session_id)
        path = self.layout.log_path(session_id)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line.rstrip() + "\n")
