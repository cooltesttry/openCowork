"""
Task Runner for background task execution.

Manages independent task execution with:
- Background asyncio.Task execution (decoupled from WebSocket)
- Event caching and persistence to disk
- Reconnect/replay support
- Session status tracking (running, completed, error, unread)
"""
import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Literal, AsyncGenerator, Any, Callable

logger = logging.getLogger(__name__)


TaskStatus = Literal["idle", "running", "completed", "error"]


@dataclass
class TaskExecution:
    """Represents a task execution state."""
    task_id: str
    session_id: str
    prompt: str
    status: TaskStatus
    started_at: str  # ISO format
    completed_at: Optional[str] = None
    error: Optional[str] = None
    was_viewed: bool = False
    event_count: int = 0
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> "TaskExecution":
        return cls(**data)


@dataclass
class SessionTaskState:
    """In-memory state for a session's current task."""
    execution: Optional[TaskExecution] = None
    task: Optional[asyncio.Task] = None
    events: List[dict] = field(default_factory=list)
    subscribers: List[asyncio.Queue] = field(default_factory=list)
    events_file: Optional[Any] = None  # File handle for appending events


class TaskRunner:
    """
    Manages independent task execution.
    
    Tasks run as asyncio.Tasks, independent of WebSocket connections.
    Events are cached in memory and persisted to disk for reconnect support.
    """
    
    def __init__(self, storage_path: str = "storage/tasks"):
        self._storage_path = Path(storage_path)
        self._sessions: Dict[str, SessionTaskState] = {}
        self._lock = asyncio.Lock()
        
    async def start(self):
        """Initialize task runner, restore any persisted state."""
        self._storage_path.mkdir(parents=True, exist_ok=True)
        await self._restore_persisted_state()
        logger.info("[TaskRunner] Started")
    
    async def stop(self):
        """Stop task runner, cancel all running tasks."""
        async with self._lock:
            for session_id, state in self._sessions.items():
                if state.task and not state.task.done():
                    state.task.cancel()
                    try:
                        await state.task
                    except asyncio.CancelledError:
                        pass
                if state.events_file:
                    state.events_file.close()
        logger.info("[TaskRunner] Stopped")
    
    async def _restore_persisted_state(self):
        """Restore task state from disk on startup."""
        if not self._storage_path.exists():
            return
            
        for session_dir in self._storage_path.iterdir():
            if not session_dir.is_dir():
                continue
                
            state_file = session_dir / "current.json"
            if not state_file.exists():
                continue
                
            try:
                with open(state_file, "r") as f:
                    data = json.load(f)
                    execution = TaskExecution.from_dict(data)
                    
                # If task was running when server stopped, mark as error
                if execution.status == "running":
                    execution.status = "error"
                    execution.error = "Server restarted during execution"
                    execution.completed_at = datetime.utcnow().isoformat() + "Z"
                    execution.was_viewed = False
                    self._save_execution(execution)
                    logger.warning(f"[TaskRunner] Session {execution.session_id} task marked as error (server restart)")
                
                # Load cached events
                events = []
                events_file = session_dir / "events.jsonl"
                if events_file.exists():
                    with open(events_file, "r") as f:
                        for line in f:
                            if line.strip():
                                events.append(json.loads(line))
                
                # Create session state
                self._sessions[execution.session_id] = SessionTaskState(
                    execution=execution,
                    events=events,
                )
                logger.info(f"[TaskRunner] Restored session {execution.session_id}: status={execution.status}, events={len(events)}")
                
            except Exception as e:
                logger.error(f"[TaskRunner] Failed to restore session from {session_dir}: {e}")
    
    def _get_session_dir(self, session_id: str) -> Path:
        """Get the storage directory for a session."""
        return self._storage_path / session_id
    
    def _save_execution(self, execution: TaskExecution):
        """Save task execution state to disk."""
        session_dir = self._get_session_dir(execution.session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        
        state_file = session_dir / "current.json"
        with open(state_file, "w") as f:
            json.dump(execution.to_dict(), f, indent=2)
    
    def _append_event(self, session_id: str, event: dict):
        """Append event to disk and in-memory cache."""
        state = self._sessions.get(session_id)
        if not state:
            return
            
        # Add timestamp
        event_with_ts = {**event, "timestamp": int(time.time() * 1000)}
        
        # Add to in-memory cache
        state.events.append(event_with_ts)
        
        # Append to disk
        session_dir = self._get_session_dir(session_id)
        events_file = session_dir / "events.jsonl"
        with open(events_file, "a") as f:
            f.write(json.dumps(event_with_ts) + "\n")
        
        # Update event count
        if state.execution:
            state.execution.event_count = len(state.events)
            self._save_execution(state.execution)
        
        # Notify subscribers
        for queue in state.subscribers:
            try:
                queue.put_nowait(event_with_ts)
            except asyncio.QueueFull:
                pass
    
    async def start_task(
        self,
        session_id: str,
        prompt: str,
        task_coroutine: Callable[[], AsyncGenerator[dict, None]],
    ) -> str:
        """
        Start a new task for a session.
        
        Args:
            session_id: The session ID
            prompt: The user's prompt
            task_coroutine: An async generator that yields events
            
        Returns:
            The task ID
        """
        async with self._lock:
            # Check if session already has a running task
            state = self._sessions.get(session_id)
            if state and state.execution and state.execution.status == "running":
                raise ValueError(f"Session {session_id} already has a running task")
            
            # Create new execution
            task_id = str(uuid.uuid4())
            execution = TaskExecution(
                task_id=task_id,
                session_id=session_id,
                prompt=prompt,
                status="running",
                started_at=datetime.utcnow().isoformat() + "Z",
            )
            
            # Clear old events and create new state
            session_dir = self._get_session_dir(session_id)
            session_dir.mkdir(parents=True, exist_ok=True)
            events_file = session_dir / "events.jsonl"
            if events_file.exists():
                events_file.unlink()  # Clear old events
            
            state = SessionTaskState(
                execution=execution,
                events=[],
            )
            self._sessions[session_id] = state
            
            # Save initial state
            self._save_execution(execution)
            
            # Start background task
            state.task = asyncio.create_task(
                self._run_task(session_id, task_coroutine)
            )
            
            logger.info(f"[TaskRunner] Started task {task_id} for session {session_id}")
            return task_id
    
    async def _run_task(
        self,
        session_id: str,
        task_coroutine: Callable[[], AsyncGenerator[dict, None]],
    ):
        """Background task execution."""
        state = self._sessions.get(session_id)
        if not state or not state.execution:
            return
            
        try:
            async for event in task_coroutine():
                self._append_event(session_id, event)
                
                # Check for done or error events
                if event.get("type") == "done":
                    state.execution.status = "completed"
                    state.execution.completed_at = datetime.utcnow().isoformat() + "Z"
                    self._save_execution(state.execution)
                    logger.info(f"[TaskRunner] Task completed for session {session_id}")
                    
                elif event.get("type") == "error":
                    state.execution.status = "error"
                    state.execution.error = event.get("content", "Unknown error")
                    state.execution.completed_at = datetime.utcnow().isoformat() + "Z"
                    self._save_execution(state.execution)
                    logger.error(f"[TaskRunner] Task errored for session {session_id}: {state.execution.error}")
                    
        except asyncio.CancelledError:
            state.execution.status = "error"
            state.execution.error = "Task was cancelled"
            state.execution.completed_at = datetime.utcnow().isoformat() + "Z"
            self._save_execution(state.execution)
            logger.info(f"[TaskRunner] Task cancelled for session {session_id}")
            raise
            
        except Exception as e:
            state.execution.status = "error"
            state.execution.error = str(e)
            state.execution.completed_at = datetime.utcnow().isoformat() + "Z"
            self._save_execution(state.execution)
            logger.error(f"[TaskRunner] Task failed for session {session_id}: {e}", exc_info=True)
    
    def get_status(self, session_id: str) -> Optional[TaskExecution]:
        """Get current task status for a session."""
        state = self._sessions.get(session_id)
        if state and state.execution:
            return state.execution
        return None
    
    def get_all_status(self) -> Dict[str, dict]:
        """Get status of all sessions."""
        result = {}
        for session_id, state in self._sessions.items():
            if state.execution:
                result[session_id] = {
                    "status": state.execution.status,
                    "has_unread": (
                        state.execution.status in ("completed", "error") 
                        and not state.execution.was_viewed
                    ),
                    "task_id": state.execution.task_id,
                    "error": state.execution.error,
                }
        return result
    
    async def subscribe(self, session_id: str) -> AsyncGenerator[dict, None]:
        """
        Subscribe to events for a session.
        
        First yields all cached events, then yields live events as they arrive.
        """
        state = self._sessions.get(session_id)
        if not state:
            return
        
        # First, yield all cached events
        for event in state.events:
            yield event
        
        # If task is done, we're done
        if state.execution and state.execution.status in ("completed", "error"):
            return
        
        # Subscribe to live events
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        state.subscribers.append(queue)
        
        try:
            while True:
                event = await queue.get()
                yield event
                
                # Check if this is the final event
                if event.get("type") in ("done", "error"):
                    break
        finally:
            if queue in state.subscribers:
                state.subscribers.remove(queue)
    
    def mark_viewed(self, session_id: str):
        """Mark a session's result as viewed."""
        state = self._sessions.get(session_id)
        if state and state.execution:
            state.execution.was_viewed = True
            self._save_execution(state.execution)
            logger.info(f"[TaskRunner] Session {session_id} marked as viewed")
    
    def is_running(self, session_id: str) -> bool:
        """Check if a session has a running task."""
        state = self._sessions.get(session_id)
        return (
            state is not None 
            and state.execution is not None 
            and state.execution.status == "running"
        )
    
    def get_cached_events(self, session_id: str) -> List[dict]:
        """Get all cached events for a session."""
        state = self._sessions.get(session_id)
        if state:
            return state.events.copy()
        return []
    
    async def interrupt_session(self, session_id: str) -> bool:
        """
        Interrupt a running task for a session.
        
        Uses SDK's official interrupt() method for graceful interruption.
        This preserves session state and allows proper cleanup.
        
        Returns:
            True if a task was interrupted, False if no running task.
        """
        async with self._lock:
            state = self._sessions.get(session_id)
            if not state or not state.execution:
                return False
            
            if state.execution.status != "running":
                return False
            
            # Use SDK's official interrupt() method via session_manager
            from core.session_manager import session_manager
            sdk_interrupted = await session_manager.interrupt_session(session_id)
            
            if sdk_interrupted:
                logger.info(f"[TaskRunner] SDK interrupt sent for session {session_id}")
            else:
                # Fallback: cancel asyncio task if SDK interrupt failed
                logger.warning(f"[TaskRunner] SDK interrupt failed, falling back to task.cancel()")
                if state.task and not state.task.done():
                    state.task.cancel()
                    try:
                        await state.task
                    except asyncio.CancelledError:
                        pass
            
            # Update status to completed (user-initiated interruption)
            state.execution.status = "completed"
            state.execution.completed_at = datetime.utcnow().isoformat() + "Z"
            state.execution.error = None
            self._save_execution(state.execution)
            
            # Append interrupt event and done event
            self._append_event(session_id, {
                "type": "system",
                "content": "Task interrupted by user",
            })
            
            self._append_event(session_id, {
                "type": "done",
                "content": {"interrupted": True},
            })
            
            logger.info(f"[TaskRunner] Session {session_id} interrupted by user")
            return True

    
    def clear_session(self, session_id: str):
        """Clear task state for a session (e.g., when session is deleted)."""
        state = self._sessions.pop(session_id, None)
        if state:
            if state.task and not state.task.done():
                state.task.cancel()
            
            # Remove persisted files
            session_dir = self._get_session_dir(session_id)
            if session_dir.exists():
                import shutil
                shutil.rmtree(session_dir)
            
            logger.info(f"[TaskRunner] Cleared session {session_id}")


# Global instance
task_runner = TaskRunner()
