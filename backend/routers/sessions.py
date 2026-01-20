"""
Session management REST API endpoints.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import session_storage
from core.task_runner import task_runner


logger = logging.getLogger(__name__)

router = APIRouter()


class CreateSessionRequest(BaseModel):
    """Request body for creating a new session."""
    title: Optional[str] = "New Chat"


class UpdateSessionRequest(BaseModel):
    """Request body for updating a session."""
    title: Optional[str] = None


@router.get("/sessions")
async def list_sessions():
    """
    List all sessions (metadata only, without full messages).
    Returns sessions sorted by updated_at (newest first).
    """
    sessions = session_storage.list_sessions()
    return {"sessions": sessions}


# NOTE: This route MUST come before /sessions/{session_id} routes
# Otherwise FastAPI will match "active" as a session_id
@router.get("/sessions/active/status")
async def get_active_sessions_status():
    """
    Get status of all sessions with active or recent tasks.
    
    Returns a dict mapping session_id to status info.
    """
    return {"sessions": task_runner.get_all_status()}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """
    Get a session by ID with full message history.
    """
    session = session_storage.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return session.to_dict()


@router.post("/sessions")
async def create_session(request: CreateSessionRequest):
    """
    Create a new session.
    Returns the created session (without messages).
    """
    session = session_storage.create_session(title=request.title or "New Chat")
    return session.to_summary()


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, request: UpdateSessionRequest):
    """
    Update a session's metadata (e.g., title).
    """
    session = session_storage.get_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if request.title is not None:
        session.title = request.title
        session_storage.save_session(session)
    
    return session.to_summary()


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """
    Delete a session by ID.
    """
    # Also clear task state for this session
    task_runner.clear_session(session_id)
    
    success = session_storage.delete_session(session_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"success": True, "deleted_id": session_id}


@router.get("/sessions/{session_id}/status")
async def get_session_status(session_id: str):
    """
    Get the execution status of a session.
    
    Returns:
    - status: 'idle' | 'running' | 'completed' | 'error'
    - has_unread: bool - True if completed/error and not viewed
    - task_id: str | None - Current task ID if any
    - error: str | None - Error message if status is 'error'
    """
    execution = task_runner.get_status(session_id)
    
    if not execution:
        return {
            "status": "idle",
            "has_unread": False,
            "task_id": None,
            "error": None,
        }
    
    return {
        "status": execution.status,
        "has_unread": (
            execution.status in ("completed", "error") 
            and not execution.was_viewed
        ),
        "task_id": execution.task_id,
        "error": execution.error,
    }


@router.post("/sessions/{session_id}/mark-read")
async def mark_session_read(session_id: str):
    """
    Mark a session's result as read (clear unread badge).
    """
    task_runner.mark_viewed(session_id)
    return {"success": True}


@router.get("/sessions/{session_id}/events")
async def get_session_events(session_id: str):
    """
    Get cached events for a session (for replay on reconnect).
    """
    events = task_runner.get_cached_events(session_id)
    execution = task_runner.get_status(session_id)
    
    return {
        "events": events,
        "status": execution.status if execution else "idle",
        "error": execution.error if execution else None,
    }

