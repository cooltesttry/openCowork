"""
Session storage service for persisting session data to JSON files.
Sessions are stored in storage/sessions/ directory.
"""
import json
import logging
import os
from pathlib import Path
from typing import Optional

from models.session import Session, SessionMessage


logger = logging.getLogger(__name__)

# Default storage directory - relative to project root
SESSIONS_DIR = Path(__file__).parent.parent.parent / "storage" / "sessions"


def ensure_sessions_dir() -> Path:
    """Ensure the sessions directory exists."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    return SESSIONS_DIR


def get_session_path(session_id: str) -> Path:
    """Get the file path for a session."""
    return ensure_sessions_dir() / f"{session_id}.json"


def list_sessions() -> list[dict]:
    """
    List all sessions (metadata only, without messages).
    Returns a list of session summaries sorted by updated_at (newest first).
    """
    sessions_dir = ensure_sessions_dir()
    sessions = []
    
    for file_path in sessions_dir.glob("*.json"):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                session = Session.from_dict(data)
                sessions.append(session.to_summary())
        except Exception as e:
            logger.warning(f"Failed to load session {file_path}: {e}")
            continue
    
    # Sort by updated_at, newest first
    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return sessions


def get_session(session_id: str) -> Optional[Session]:
    """
    Get a session by ID with full message history.
    Returns None if session not found.
    """
    session_path = get_session_path(session_id)
    
    if not session_path.exists():
        return None
    
    try:
        with open(session_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return Session.from_dict(data)
    except Exception as e:
        logger.error(f"Failed to load session {session_id}: {e}")
        return None


def create_session(title: str = "New Chat") -> Session:
    """
    Create a new session and save it.
    Returns the created session.
    """
    session = Session.create(title=title)
    save_session(session)
    logger.info(f"Created new session: {session.id} - {session.title}")
    return session


def save_session(session: Session) -> bool:
    """
    Save a session to disk.
    Returns True on success, False on failure.
    """
    session_path = get_session_path(session.id)
    
    try:
        with open(session_path, "w", encoding="utf-8") as f:
            json.dump(session.to_dict(), f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save session {session.id}: {e}")
        return False


def update_session(session: Session) -> bool:
    """
    Update an existing session (alias for save_session).
    """
    return save_session(session)


def delete_session(session_id: str) -> bool:
    """
    Delete a session by ID.
    Returns True on success, False if not found or failed.
    """
    session_path = get_session_path(session_id)
    
    if not session_path.exists():
        return False
    
    try:
        session_path.unlink()
        logger.info(f"Deleted session: {session_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete session {session_id}: {e}")
        return False


def get_or_create_default_session() -> Session:
    """
    Get the most recent session, or create a new one if none exist.
    Used to ensure there's always at least one session available.
    """
    sessions = list_sessions()
    
    if sessions:
        # Return the most recent session
        session = get_session(sessions[0]["id"])
        if session:
            return session
    
    # Create a new default session
    return create_session("New Chat")


def add_message_to_session(session_id: str, message: SessionMessage) -> Optional[Session]:
    """
    Add a message to an existing session and save it.
    Returns the updated session, or None if session not found.
    """
    session = get_session(session_id)
    
    if not session:
        logger.warning(f"Session not found: {session_id}")
        return None
    
    session.add_message(message)
    save_session(session)
    return session
