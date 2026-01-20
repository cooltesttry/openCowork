"""
Session and SessionMessage data models for multi-turn conversations.
"""
from dataclasses import dataclass, field, asdict
from typing import Optional, Literal, Any
import time
import uuid


@dataclass
class SessionMessage:
    """A single message in a session."""
    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: float
    blocks: Optional[list[dict]] = None  # For structured rendering (tool use, thinking, etc.)
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> "SessionMessage":
        return cls(
            id=data["id"],
            role=data["role"],
            content=data["content"],
            timestamp=data["timestamp"],
            blocks=data.get("blocks"),
        )
    
    @classmethod
    def create(cls, role: Literal["user", "assistant"], content: str, blocks: Optional[list[dict]] = None) -> "SessionMessage":
        return cls(
            id=str(uuid.uuid4()),
            role=role,
            content=content,
            timestamp=time.time(),
            blocks=blocks,
        )


@dataclass
class Session:
    """A conversation session containing multiple messages."""
    id: str
    title: str
    created_at: float
    updated_at: float
    messages: list[SessionMessage] = field(default_factory=list)
    sdk_session_id: Optional[str] = None  # Claude Agent SDK session ID for resumption
    last_model_name: Optional[str] = None  # Last used model name
    last_endpoint_name: Optional[str] = None  # Last used endpoint name
    last_security_mode: Optional[str] = None  # Last used security mode
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "messages": [m.to_dict() for m in self.messages],
            "sdk_session_id": self.sdk_session_id,
            "last_model_name": self.last_model_name,
            "last_endpoint_name": self.last_endpoint_name,
            "last_security_mode": self.last_security_mode,
        }
    
    def to_summary(self) -> dict:
        """Return session metadata without full messages (for list view)."""
        return {
            "id": self.id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message_count": len(self.messages),
            "last_model_name": self.last_model_name,
            "last_endpoint_name": self.last_endpoint_name,
            "last_security_mode": self.last_security_mode,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        return cls(
            id=data["id"],
            title=data["title"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            messages=[SessionMessage.from_dict(m) for m in data.get("messages", [])],
            sdk_session_id=data.get("sdk_session_id"),
            last_model_name=data.get("last_model_name"),
            last_endpoint_name=data.get("last_endpoint_name"),
            last_security_mode=data.get("last_security_mode"),
        )
    
    @classmethod
    def create(cls, title: str = "New Chat") -> "Session":
        now = time.time()
        return cls(
            id=str(uuid.uuid4()),
            title=title,
            created_at=now,
            updated_at=now,
            messages=[],
        )
    
    def add_message(self, message: SessionMessage) -> None:
        """Add a message and update the timestamp."""
        self.messages.append(message)
        self.updated_at = time.time()
        
        # Auto-generate title from first user message if still default
        if self.title == "New Chat" and message.role == "user" and message.content:
            # Use first 50 chars of first user message as title
            self.title = message.content[:50].strip()
            if len(message.content) > 50:
                self.title += "..."
