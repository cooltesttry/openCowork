"""
Session management REST API endpoints.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import session_storage


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
    success = session_storage.delete_session(session_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {"success": True, "deleted_id": session_id}
