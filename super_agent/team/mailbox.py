"""File-based mailbox for Agent Team communication.

Replaces asyncio.Queue with file-based inboxes for cross-process communication.
Scheduler uses this to poll for new messages and deliver them to Agents.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class FileMailbox:
    """File-based inbox mailbox with delivery-then-ack semantics.

    Each agent has an inbox file at .team/inboxes/{agent_id}.json.
    MCP servers write to these files. Scheduler polls and delivers.
    """

    def __init__(self, team_data_dir: Path):
        self.team_data_dir = team_data_dir
        self.inbox_dir = team_data_dir / "inboxes"
        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.plan_file = team_data_dir / "plan.json"
        self._cancelled = False

    def register_agent(self, agent_id: str):
        """Initialize an agent's inbox file."""
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        if not inbox_file.exists():
            inbox_file.write_text("[]")

    async def wait_for_mail(
        self, agent_id: str, task_id: Optional[str] = None
    ) -> list[dict]:
        """Poll until undelivered mail arrives or task reaches terminal state.

        Args:
            agent_id: The agent whose inbox to monitor.
            task_id: If provided, also check plan.json for terminal task status
                     (approved/failed). Returns empty list if task is terminal.

        Returns:
            List of undelivered mail dicts, or empty list if task is terminal.
        """
        while not self._cancelled:
            unread = self._peek_undelivered(agent_id)
            if unread:
                return unread
            if task_id and self._is_task_terminal(task_id):
                return []
            await asyncio.sleep(0.5)
        return []

    def _peek_undelivered(self, agent_id: str) -> list[dict]:
        """Read undelivered mails without modifying the file."""
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        if not inbox_file.exists():
            return []
        try:
            mails = json.loads(inbox_file.read_text(encoding="utf-8"))
            return [m for m in mails if not m.get("delivered")]
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[Mailbox] Failed to read inbox for {agent_id}: {e}")
            return []

    def ack_delivered(self, agent_id: str, message_ids: list[str]):
        """Mark messages as delivered after successful prompt delivery.

        Uses file locking to avoid conflicts with MCP server writes.
        """
        inbox_file = self.inbox_dir / f"{agent_id}.json"
        if not inbox_file.exists():
            return

        ids_set = set(message_ids)
        try:
            with open(inbox_file, "r+") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    mails = json.loads(f.read())
                    for m in mails:
                        if m.get("id") in ids_set:
                            m["delivered"] = True
                    f.seek(0)
                    f.truncate()
                    f.write(json.dumps(mails, ensure_ascii=False, indent=2))
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[Mailbox] Failed to ack messages for {agent_id}: {e}")

    def _is_task_terminal(self, task_id: str) -> bool:
        """Check if a task has reached terminal status in plan.json."""
        if not self.plan_file.exists():
            return False
        try:
            plan = json.loads(self.plan_file.read_text(encoding="utf-8"))
            for phase in plan.get("phases", []):
                for task in phase.get("tasks", []):
                    if task.get("task_id") == task_id:
                        return task.get("status") in ("approved", "failed")
        except (json.JSONDecodeError, KeyError, OSError):
            pass
        return False

    def get_task_status(self, task_id: str) -> Optional[str]:
        """Read a task's current status from plan.json."""
        if not self.plan_file.exists():
            return None
        try:
            plan = json.loads(self.plan_file.read_text(encoding="utf-8"))
            for phase in plan.get("phases", []):
                for task in phase.get("tasks", []):
                    if task.get("task_id") == task_id:
                        return task.get("status")
        except (json.JSONDecodeError, KeyError, OSError):
            pass
        return None

    def all_tasks_resolved(self, phase_tasks: list[dict]) -> bool:
        """Check if all tasks in a phase are resolved (approved or failed)."""
        for t in phase_tasks:
            task_id = t.get("task_id") or t.task_id if hasattr(t, "task_id") else None
            if not task_id:
                continue
            status = self.get_task_status(task_id)
            if status not in ("approved", "failed"):
                return False
        return True

    def send_auto_mail(self, from_id: str, to_id: str, content: str):
        """Append a mail to an agent's inbox (used by Scheduler for auto-submit).

        Uses file locking for concurrent safety, same as MCP server's _append_mail.
        """
        inbox_file = self.inbox_dir / f"{to_id}.json"
        inbox_file.parent.mkdir(parents=True, exist_ok=True)
        if not inbox_file.exists():
            inbox_file.write_text("[]")

        mail = {
            "id": f"msg-auto-{uuid.uuid4().hex[:8]}",
            "from": from_id,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "delivered": False,
        }

        try:
            with open(inbox_file, "r+") as f:
                fcntl.flock(f, fcntl.LOCK_EX)
                try:
                    mails = json.loads(f.read())
                    mails.append(mail)
                    f.seek(0)
                    f.truncate()
                    f.write(json.dumps(mails, ensure_ascii=False, indent=2))
                finally:
                    fcntl.flock(f, fcntl.LOCK_UN)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[Mailbox] Failed to send auto-mail to {to_id}: {e}")

    async def shutdown(self):
        """Signal all wait loops to exit."""
        self._cancelled = True
