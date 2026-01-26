"""
Event emission module for Super Agent real-time progress display.

Provides WebSocket-based event broadcasting for session progress updates.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    """Event types for Super Agent progress updates."""
    
    # Session lifecycle
    SESSION_START = "session_start"
    SESSION_COMPLETE = "session_complete"
    SESSION_ERROR = "session_error"
    
    # Cycle lifecycle
    CYCLE_START = "cycle_start"
    CYCLE_END = "cycle_end"
    
    # Worker events
    WORKER_START = "worker_start"
    WORKER_STREAM = "worker_stream"
    WORKER_TOOL_CALL = "worker_tool_call"
    WORKER_TOOL_RESULT = "worker_tool_result"
    WORKER_COMPLETE = "worker_complete"
    WORKER_ERROR = "worker_error"
    
    # Checker events
    CHECKER_START = "checker_start"
    CHECKER_STREAM = "checker_stream"
    CHECKER_COMPLETE = "checker_complete"
    CHECKER_ERROR = "checker_error"


@dataclass
class SessionEvent:
    """A single event in a session's timeline."""
    
    event_type: EventType
    timestamp: str
    data: dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.event_type.value,
            "timestamp": self.timestamp,
            "data": self.data,
        }
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


class SessionEventManager:
    """
    Manages WebSocket connections and event emission for a single session.
    
    Usage:
        manager = SessionEventManager("session-123")
        await manager.connect(websocket)
        await manager.emit(EventType.CYCLE_START, {"cycle_index": 1})
        await manager.disconnect(websocket)
    """
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.connections: list[WebSocket] = []
        self.event_history: list[SessionEvent] = []
        self._lock = asyncio.Lock()
    
    async def connect(self, websocket: WebSocket) -> None:
        """Add a WebSocket connection to this session's broadcast list."""
        await websocket.accept()
        async with self._lock:
            self.connections.append(websocket)
        logger.info(f"[Events] Session {self.session_id}: WebSocket connected ({len(self.connections)} total)")
        
        # Send event history to new connection
        for event in self.event_history:
            try:
                await websocket.send_text(event.to_json())
            except Exception:
                pass
    
    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection from this session's broadcast list."""
        async with self._lock:
            if websocket in self.connections:
                self.connections.remove(websocket)
        logger.info(f"[Events] Session {self.session_id}: WebSocket disconnected ({len(self.connections)} remaining)")
    
    async def emit(self, event_type: EventType, data: Optional[dict[str, Any]] = None) -> None:
        """Broadcast an event to all connected WebSockets."""
        timestamp = datetime.now(timezone.utc).isoformat()
        event = SessionEvent(
            event_type=event_type,
            timestamp=timestamp,
            data=data or {},
        )
        
        # Store in history
        self.event_history.append(event)
        
        # Broadcast to all connections
        message = event.to_json()
        disconnected: list[WebSocket] = []
        
        async with self._lock:
            for ws in self.connections:
                try:
                    await ws.send_text(message)
                except Exception as e:
                    logger.warning(f"[Events] Failed to send to WebSocket: {e}")
                    disconnected.append(ws)
            
            # Clean up failed connections
            for ws in disconnected:
                if ws in self.connections:
                    self.connections.remove(ws)
        
        logger.debug(f"[Events] Session {self.session_id}: Emitted {event_type.value}")
    
    def get_emitter(self) -> Callable[[EventType, Optional[dict]], None]:
        """
        Get a synchronous-looking emitter function for use in callbacks.
        
        This creates an async task to emit the event, suitable for use
        in contexts where async/await is not available.
        """
        def emit_sync(event_type: EventType, data: Optional[dict] = None) -> None:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.emit(event_type, data))
            except RuntimeError:
                # No running loop, skip emission
                pass
        return emit_sync


# Global registry of session event managers
_session_managers: dict[str, SessionEventManager] = {}
_registry_lock = asyncio.Lock()


async def get_or_create_manager(session_id: str) -> SessionEventManager:
    """Get or create a SessionEventManager for the given session ID."""
    async with _registry_lock:
        if session_id not in _session_managers:
            _session_managers[session_id] = SessionEventManager(session_id)
            logger.info(f"[Events] Created manager for session {session_id}")
        return _session_managers[session_id]


async def remove_manager(session_id: str) -> None:
    """Remove a SessionEventManager when session is complete."""
    async with _registry_lock:
        if session_id in _session_managers:
            del _session_managers[session_id]
            logger.info(f"[Events] Removed manager for session {session_id}")


def get_manager_sync(session_id: str) -> Optional[SessionEventManager]:
    """Get a SessionEventManager synchronously (returns None if not found)."""
    return _session_managers.get(session_id)
