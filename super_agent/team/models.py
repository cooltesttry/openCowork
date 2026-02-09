"""Data models for Agent Team system."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from super_agent.models import WorkerConfig, utc_now


def _new_msg_id() -> str:
    return f"msg-{uuid.uuid4().hex[:8]}"


@dataclass
class Message:
    """Mailbox message between Worker and Lead.

    In the new architecture, messages are plain text delivered via Mailbox MCP.
    The message_type field is kept for backward compatibility but is no longer
    used for approve/feedback routing (that's handled by plan.json status).
    """

    from_id: str          # "worker-{task_id}" or "lead"
    to_id: str            # "lead" or "worker-{task_id}"
    content: str          # Message body (plain text)
    task_id: str = ""     # Associated task (optional, for tracking)
    message_id: str = field(default_factory=_new_msg_id)
    timestamp: str = field(default_factory=utc_now)

    def to_dict(self) -> dict:
        return {
            "from_id": self.from_id,
            "to_id": self.to_id,
            "content": self.content,
            "task_id": self.task_id,
            "message_id": self.message_id,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Message":
        return cls(
            from_id=data["from_id"],
            to_id=data["to_id"],
            content=data.get("content", ""),
            task_id=data.get("task_id", ""),
            message_id=data.get("message_id", _new_msg_id()),
            timestamp=data.get("timestamp", utc_now()),
        )


@dataclass
class TaskResult:
    """Structured output from a Worker task."""

    summary: str = ""
    content: str = ""
    files: list[str] = field(default_factory=list)
    instruction: str = ""
    output_dir: str = ""

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "content": self.content,
            "files": list(self.files),
            "instruction": self.instruction,
            "output_dir": self.output_dir,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TaskResult":
        return cls(
            summary=data.get("summary", ""),
            content=data.get("content", ""),
            files=list(data.get("files", [])),
            instruction=data.get("instruction", ""),
            output_dir=data.get("output_dir", ""),
        )


@dataclass
class TaskStep:
    """A single executable task within a Phase."""

    task_id: str
    description: str
    worker_type_id: str
    context: dict = field(default_factory=dict)
    status: str = "pending"  # pending | running | approved | failed
    worker_sdk_session_id: Optional[str] = None
    messages: list[Message] = field(default_factory=list)
    result: Optional[TaskResult] = None
    result_text: str = ""
    result_error: Optional[str] = None
    submit_count: int = 0
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "description": self.description,
            "worker_type_id": self.worker_type_id,
            "context": dict(self.context),
            "status": self.status,
            "worker_sdk_session_id": self.worker_sdk_session_id,
            "messages": [m.to_dict() for m in self.messages],
            "result": self.result.to_dict() if self.result else None,
            "result_text": self.result_text,
            "result_error": self.result_error,
            "submit_count": self.submit_count,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TaskStep":
        return cls(
            task_id=data["task_id"],
            description=data.get("description", ""),
            worker_type_id=data.get("worker_type_id", ""),
            context=dict(data.get("context", {})),
            status=data.get("status", "pending"),
            worker_sdk_session_id=data.get("worker_sdk_session_id"),
            messages=[Message.from_dict(m) for m in data.get("messages", [])],
            result=TaskResult.from_dict(data["result"]) if data.get("result") else None,
            result_text=data.get("result_text", ""),
            result_error=data.get("result_error"),
            submit_count=int(data.get("submit_count", 0)),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )


@dataclass
class Phase:
    """A group of parallel tasks."""

    phase_id: str
    phase_index: int = 0
    description: str = ""
    tasks: list[TaskStep] = field(default_factory=list)
    status: str = "pending"  # pending | running | completed | failed
    phase_review_decision: Optional[str] = None  # approve | modify | abort
    phase_review_notes: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "phase_id": self.phase_id,
            "phase_index": self.phase_index,
            "description": self.description,
            "tasks": [t.to_dict() for t in self.tasks],
            "status": self.status,
            "phase_review_decision": self.phase_review_decision,
            "phase_review_notes": self.phase_review_notes,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Phase":
        return cls(
            phase_id=data["phase_id"],
            phase_index=int(data.get("phase_index", 0)),
            description=data.get("description", ""),
            tasks=[TaskStep.from_dict(t) for t in data.get("tasks", [])],
            status=data.get("status", "pending"),
            phase_review_decision=data.get("phase_review_decision"),
            phase_review_notes=data.get("phase_review_notes"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )


@dataclass
class Plan:
    """Complete execution plan (dynamically adjustable)."""

    plan_id: str
    objective: str = ""
    phases: list[Phase] = field(default_factory=list)
    version: int = 0
    change_log: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "plan_id": self.plan_id,
            "objective": self.objective,
            "phases": [p.to_dict() for p in self.phases],
            "version": self.version,
            "change_log": list(self.change_log),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Plan":
        return cls(
            plan_id=data["plan_id"],
            objective=data.get("objective", ""),
            phases=[Phase.from_dict(p) for p in data.get("phases", [])],
            version=int(data.get("version", 0)),
            change_log=list(data.get("change_log", [])),
        )


@dataclass
class TeamSession:
    """Full session state for a Team Agent run."""

    session_id: str
    status: str = "pending"  # pending | planning | executing | phase_review | completed | failed | cancelled
    plan: Optional[Plan] = None
    current_phase_index: int = -1
    lead_config: Optional[WorkerConfig] = None
    lead_sdk_session_id: Optional[str] = None
    workspace_dir: str = ""
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    completed_at: Optional[str] = None
    final_output: Optional[str] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "status": self.status,
            "plan": self.plan.to_dict() if self.plan else None,
            "current_phase_index": self.current_phase_index,
            "lead_config": self.lead_config.to_dict() if self.lead_config else None,
            "lead_sdk_session_id": self.lead_sdk_session_id,
            "workspace_dir": self.workspace_dir,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "completed_at": self.completed_at,
            "final_output": self.final_output,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TeamSession":
        return cls(
            session_id=data["session_id"],
            status=data.get("status", "pending"),
            plan=Plan.from_dict(data["plan"]) if data.get("plan") else None,
            current_phase_index=int(data.get("current_phase_index", -1)),
            lead_config=WorkerConfig.from_dict(data["lead_config"]) if data.get("lead_config") else None,
            lead_sdk_session_id=data.get("lead_sdk_session_id"),
            workspace_dir=data.get("workspace_dir", ""),
            created_at=data.get("created_at", utc_now()),
            updated_at=data.get("updated_at", utc_now()),
            completed_at=data.get("completed_at"),
            final_output=data.get("final_output"),
            error=data.get("error"),
        )
