"""Mailbox for Worker↔Lead communication in Agent Team system."""

from __future__ import annotations

import asyncio
from typing import Optional

from .models import Message

# Sentinel objects for signaling
_SENTINEL_SHUTDOWN = object()
SENTINEL_WORKER_FAILED = "___worker_failed___"


class Mailbox:
    """Phase-scoped message queue managing Worker↔Lead communication.

    Supports termination signals: worker_failed / cancelled / shutdown
    can all unblock waiting receive calls.
    """

    def __init__(self):
        self._lead_queue: asyncio.Queue = asyncio.Queue()
        self._worker_queues: dict[str, asyncio.Queue] = {}
        self._cancelled = False

    def register_worker(self, task_id: str):
        """Register a worker queue for the given task."""
        self._worker_queues[task_id] = asyncio.Queue()

    async def send_to_lead(self, message: Message):
        """Worker sends a message to Lead."""
        await self._lead_queue.put(message)

    async def receive_for_lead(self) -> Optional[Message]:
        """Lead takes next message from queue. Returns None on shutdown."""
        item = await self._lead_queue.get()
        if item is _SENTINEL_SHUTDOWN or self._cancelled:
            return None
        return item

    async def send_to_worker(self, task_id: str, message: Message):
        """Lead sends feedback/approval to a specific Worker."""
        q = self._worker_queues.get(task_id)
        if q:
            await q.put(message)

    async def receive_for_worker(self, task_id: str) -> Optional[Message]:
        """Worker waits for Lead feedback. Returns None on shutdown."""
        q = self._worker_queues.get(task_id)
        if not q:
            return None
        item = await q.get()
        if item is _SENTINEL_SHUTDOWN or self._cancelled:
            return None
        return item

    async def notify_worker_failed(self, task_id: str):
        """Send failure sentinel to Lead to prevent deadlock."""
        fail_msg = Message(
            from_id=f"worker-{task_id}",
            to_id="lead",
            task_id=task_id,
            content="",
            message_type=SENTINEL_WORKER_FAILED,
        )
        await self._lead_queue.put(fail_msg)

    def remove_worker(self, task_id: str):
        """Remove a worker queue after task completion."""
        self._worker_queues.pop(task_id, None)

    async def shutdown(self):
        """Cancel all blocking waits."""
        self._cancelled = True
        # Wake up Lead
        await self._lead_queue.put(_SENTINEL_SHUTDOWN)
        # Wake up all waiting Workers
        for q in self._worker_queues.values():
            await q.put(_SENTINEL_SHUTDOWN)
