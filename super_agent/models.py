from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clone_mcp_servers(value: object) -> object:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, list):
        return [dict(item) if isinstance(item, dict) else item for item in value]
    return value


@dataclass
class WorkerConfig:
    id: str
    name: str
    model: str
    provider: Optional[str] = None
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    mcp_servers: object = field(default_factory=list)
    prompt: dict = field(default_factory=dict)
    tools_allow: list[str] = field(default_factory=list)
    tools_block: list[str] = field(default_factory=list)
    env: dict = field(default_factory=dict)
    cwd: Optional[str] = None
    max_turns: int = 1
    max_tokens: int = 0
    max_thinking_tokens: int = 0
    setting_sources: list[str] = field(default_factory=list)
    permission_mode: Optional[str] = None
    include_partial_messages: bool = False
    output_format: Optional[dict] = None
    preserve_context: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "model": self.model,
            "provider": self.provider,
            "api_key": self.api_key,
            "endpoint": self.endpoint,
            "mcp_servers": _clone_mcp_servers(self.mcp_servers),
            "prompt": dict(self.prompt),
            "tools_allow": list(self.tools_allow),
            "tools_block": list(self.tools_block),
            "env": dict(self.env),
            "cwd": self.cwd,
            "max_turns": self.max_turns,
            "max_tokens": self.max_tokens,
            "max_thinking_tokens": self.max_thinking_tokens,
            "setting_sources": list(self.setting_sources),
            "permission_mode": self.permission_mode,
            "include_partial_messages": self.include_partial_messages,
            "output_format": (
                dict(self.output_format)
                if isinstance(self.output_format, dict)
                else self.output_format
            ),
            "preserve_context": self.preserve_context,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkerConfig":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            model=data["model"],
            provider=data.get("provider"),
            api_key=data.get("api_key"),
            endpoint=data.get("endpoint"),
            mcp_servers=_clone_mcp_servers(data.get("mcp_servers", [])),
            prompt=dict(data.get("prompt", {})),
            tools_allow=list(data.get("tools_allow", [])),
            tools_block=list(data.get("tools_block", [])),
            env=dict(data.get("env", {})),
            cwd=data.get("cwd"),
            max_turns=int(data.get("max_turns", 10)),
            max_tokens=int(data.get("max_tokens", 0)),
            max_thinking_tokens=int(data.get("max_thinking_tokens", 0)),
            setting_sources=list(data.get("setting_sources", [])),
            permission_mode=data.get("permission_mode"),
            include_partial_messages=bool(data.get("include_partial_messages", False)),
            output_format=data.get("output_format"),
            preserve_context=bool(data.get("preserve_context", False)),
        )


@dataclass
class TaskDefinition:
    task_id: str
    name: str
    objective: str
    inputs: dict = field(default_factory=dict)
    expected_output: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "name": self.name,
            "objective": self.objective,
            "inputs": dict(self.inputs),
            "expected_output": dict(self.expected_output),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TaskDefinition":
        return cls(
            task_id=data["task_id"],
            name=data.get("name", data["task_id"]),
            objective=data.get("objective", ""),
            inputs=dict(data.get("inputs", {})),
            expected_output=dict(data.get("expected_output", {})),
        )


@dataclass
class LLMResult:
    """Unified LLM output format returned by Worker.
    
    This is the raw output from the LLM, without any business logic processing.
    The Orchestrator is responsible for converting this into WorkerResult.
    """
    text: str = ""
    tool_calls: list = field(default_factory=list)
    tool_results: list = field(default_factory=list)
    sdk_session_id: Optional[str] = None
    usage: Optional[dict] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "tool_calls": list(self.tool_calls),
            "tool_results": list(self.tool_results),
            "sdk_session_id": self.sdk_session_id,
            "usage": self.usage,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "LLMResult":
        return cls(
            text=data.get("text", ""),
            tool_calls=list(data.get("tool_calls", [])),
            tool_results=list(data.get("tool_results", [])),
            sdk_session_id=data.get("sdk_session_id"),
            usage=data.get("usage"),
            error=data.get("error"),
        )



@dataclass
class CheckerResult:
    passed: bool
    reason: Optional[str] = None
    next_input: Optional[dict] = None

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "reason": self.reason,
            "next_input": dict(self.next_input) if self.next_input else None,
        }


@dataclass
class CycleRecord:
    """Record of a single Worker cycle."""
    cycle_index: int
    started_at: str
    ended_at: str
    input_payload: dict
    llm_result: LLMResult
    passed: bool
    checker_reason: Optional[str] = None
    # Computed fields (derived from llm_result in Orchestrator)
    summary: str = ""
    artifacts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "cycle_index": self.cycle_index,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "input_payload": dict(self.input_payload),
            "llm_result": self.llm_result.to_dict(),
            "passed": self.passed,
            "checker_reason": self.checker_reason,
            "summary": self.summary,
            "artifacts": list(self.artifacts),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CycleRecord":
        return cls(
            cycle_index=int(data["cycle_index"]),
            started_at=data["started_at"],
            ended_at=data["ended_at"],
            input_payload=dict(data.get("input_payload", {})),
            llm_result=LLMResult.from_dict(data.get("llm_result", data.get("result", {}))),
            passed=bool(data.get("passed", False)),
            checker_reason=data.get("checker_reason"),
            summary=data.get("summary", ""),
            artifacts=list(data.get("artifacts", [])),
        )


@dataclass
class SessionState:
    session_id: str
    status: str
    worker_config: WorkerConfig
    task: TaskDefinition
    cycle_count: int
    max_cycles: int
    input_payload: dict
    last_result: Optional[LLMResult]
    history: list[CycleRecord]
    created_at: str
    updated_at: str
    reset_on_max_cycles: bool = False
    reset_count: int = 0
    max_resets: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "status": self.status,
            "worker_config": self.worker_config.to_dict(),
            "task": self.task.to_dict(),
            "cycle_count": self.cycle_count,
            "max_cycles": self.max_cycles,
            "input_payload": dict(self.input_payload),
            "last_result": self.last_result.to_dict() if self.last_result else None,
            "history": [record.to_dict() for record in self.history],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "reset_on_max_cycles": self.reset_on_max_cycles,
            "reset_count": self.reset_count,
            "max_resets": self.max_resets,
            "last_error": self.last_error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SessionState":
        return cls(
            session_id=data["session_id"],
            status=data.get("status", "pending"),
            worker_config=WorkerConfig.from_dict(data.get("worker_config", {})),
            task=TaskDefinition.from_dict(data.get("task", {})),
            cycle_count=int(data.get("cycle_count", 0)),
            max_cycles=int(data.get("max_cycles", 1)),
            input_payload=dict(data.get("input_payload", {})),
            last_result=(
                LLMResult.from_dict(data["last_result"])
                if data.get("last_result")
                else None
            ),
            history=[
                CycleRecord.from_dict(record) for record in data.get("history", [])
            ],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            reset_on_max_cycles=bool(data.get("reset_on_max_cycles", False)),
            reset_count=int(data.get("reset_count", 0)),
            max_resets=int(data.get("max_resets", 0)),
            last_error=data.get("last_error"),
        )
