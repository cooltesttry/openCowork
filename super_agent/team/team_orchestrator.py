"""Main orchestrator for Agent Team system.

Manages the full lifecycle: planning → phase execution → phase review → final summary.

In the dual MCP architecture:
- Leader creates/modifies plans via Plan MCP (create_plan, modify_phases, update_task)
- All agents communicate via Mailbox MCP (send_mail)
- Scheduler reads plan.json directly instead of parsing LLM text output
- All agents share the same workspace directory
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from super_agent.models import WorkerConfig, LLMResult, utc_now
from super_agent.worker import Worker, ClaudeSdkWorker
from super_agent.events import EventType, SessionEventManager

from .models import Message, Phase, Plan, TaskStep, TeamSession
from .mailbox import FileMailbox
from .persistence import TeamSessionStore
from .prompts import (
    build_final_summary_prompt,
    build_memory_writer_prompt,
    build_phase_review_prompt,
    build_planning_prompt,
)
from .scheduler import PhaseScheduler
from .activity_log import TeamActivityLog
from .memory_store import MemoryStore

logger = logging.getLogger(__name__)

# Valid task_id pattern: alphanumeric, hyphens, underscores only
_TASK_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_CONTEXT_HEADER = "## Context Usage"
_CONTEXT_SECTION = "### Estimated usage by category"
_CONTEXT_TABLE_HEADER = "| Category | Tokens | Percentage |"


def _sanitize_task_id(raw_id: str, fallback_prefix: str = "task") -> str:
    """Sanitize a task_id to prevent path traversal."""
    if raw_id and _TASK_ID_RE.match(raw_id) and len(raw_id) <= 128:
        return raw_id
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", raw_id)[:64]
    if safe and _TASK_ID_RE.match(safe):
        return safe
    return f"{fallback_prefix}_{uuid.uuid4().hex[:6]}"


def _ensure_unique_task_ids(tasks: list) -> list:
    """Ensure all task_ids within a list are unique."""
    seen: set[str] = set()
    for task in tasks:
        original = task.task_id
        while task.task_id in seen:
            task.task_id = f"{original}_{uuid.uuid4().hex[:4]}"
        seen.add(task.task_id)
    return tasks


def _build_previous_results_summary(plan: Plan, up_to_phase_index: int) -> str:
    """Build a summary of results from completed phases for Worker context."""
    if up_to_phase_index <= 0:
        return ""

    parts = []
    for phase in plan.phases[:up_to_phase_index]:
        if phase.status != "completed":
            continue
        parts.append(f"### Phase {phase.phase_index}: {phase.description}")
        for task in phase.tasks:
            if task.result and task.result.summary:
                summary = task.result.summary
                files = ""
                if task.result.files:
                    files = f" (files: {', '.join(task.result.files)})"
                parts.append(f"- [{task.task_id}] {summary}{files}")
            elif task.result_text:
                parts.append(f"- [{task.task_id}] {task.result_text[:200]}")
    return "\n".join(parts)


def _read_plan_from_file(team_data_dir: Path) -> Optional[dict]:
    """Read plan.json from the team data directory."""
    plan_file = team_data_dir / "plan.json"
    if not plan_file.exists():
        return None
    try:
        return json.loads(plan_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[Orchestrator] Failed to read plan.json: {e}")
        return None


def _plan_data_to_plan(plan_data: dict, plan_id: str, available_worker_ids: Optional[set[str]] = None) -> Plan:
    """Convert plan.json data dict to a Plan object with validation."""
    fallback_worker = "default"
    if available_worker_ids:
        if "default" not in available_worker_ids:
            fallback_worker = next(iter(sorted(available_worker_ids)), "default")

    phases = []
    for i, phase_data in enumerate(plan_data.get("phases", [])):
        phase = Phase(
            phase_id=phase_data.get("phase_id", f"phase_{i}"),
            phase_index=i,
            description=phase_data.get("description", ""),
            status=phase_data.get("status", "pending"),
        )
        for task_data in phase_data.get("tasks", []):
            raw_task_id = task_data.get("task_id", f"task_{uuid.uuid4().hex[:6]}")
            worker_type = task_data.get("worker_type_id", fallback_worker)
            if available_worker_ids and worker_type not in available_worker_ids:
                logger.warning(f"[Orchestrator] Unknown worker_type_id '{worker_type}', using '{fallback_worker}'")
                worker_type = fallback_worker
            phase.tasks.append(
                TaskStep(
                    task_id=_sanitize_task_id(raw_task_id),
                    description=task_data.get("description", ""),
                    worker_type_id=worker_type,
                    context=task_data.get("context", {}),
                    status=task_data.get("status", "pending"),
                )
            )
            _ensure_unique_task_ids(phase.tasks)
        phases.append(phase)

    planning_basis = plan_data.get("planning_basis", {})
    if not isinstance(planning_basis, dict):
        planning_basis = {}

    return Plan(
        plan_id=plan_id,
        objective=plan_data.get("objective", ""),
        phases=phases,
        version=plan_data.get("version", 1),
        change_log=plan_data.get("change_log", []),
        planning_basis=planning_basis,
    )


def _slugify(text: str, max_len: int = 40) -> str:
    """Convert text to a slug suitable for directory names.

    Preserves CJK characters (U+4E00–U+9FFF) alongside ASCII alphanumerics.
    Non-slug characters become hyphens; consecutive hyphens are collapsed.
    """
    # Keep ASCII alphanumerics and CJK unified ideographs; replace rest with hyphen
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", text).strip("-")
    # Truncate
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip("-")
    return slug or "project"


def _parse_compact_number(value: str) -> Optional[int]:
    """Parse numbers like 95.3k / 1.2m to integer tokens."""
    if not value:
        return None
    raw = value.strip().lower().replace(",", "")
    raw = raw.replace(" ", "")
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)([km]?)$", raw)
    if not match:
        return None
    number = float(match.group(1))
    suffix = match.group(2)
    if suffix == "k":
        number *= 1000
    elif suffix == "m":
        number *= 1_000_000
    return int(round(number))


def _extract_context_usage_tokens(content: str) -> Optional[tuple[int, int]]:
    """Extract used/window token counts from /context output text."""
    if not content or not content.startswith(_CONTEXT_HEADER):
        return None
    if _CONTEXT_SECTION not in content or _CONTEXT_TABLE_HEADER not in content:
        return None
    tokens_line = None
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if "tokens:" in stripped.lower():
            tokens_line = stripped
            break
    if not tokens_line:
        return None
    tokens_line = tokens_line.replace("**", "")
    match = re.search(r"Tokens:\s*([^/]+)\s*/\s*([^\s(]+)", tokens_line, re.IGNORECASE)
    if not match:
        return None
    used_tokens = _parse_compact_number(match.group(1).strip())
    window_tokens = _parse_compact_number(match.group(2).strip())
    if used_tokens is None or window_tokens is None:
        return None
    return used_tokens, window_tokens


async def _collect_phase_review_context_usage(
    lead_worker: Worker,
    lead_config: WorkerConfig,
) -> dict[str, Any]:
    """Call /context after phase review and return compact usage payload."""
    try:
        context_result = await lead_worker.run_async(
            config=lead_config,
            prompt="/context",
            event_callback=None,  # Do not stream /context output to UI
        )
    except Exception:
        return {"status": "failed", "error_code": "QUERY_EXCEPTION"}

    if context_result.error:
        return {"status": "failed", "error_code": "SDK_ERROR"}

    parsed = _extract_context_usage_tokens(context_result.text or "")
    if not parsed:
        text = (context_result.text or "").lower()
        if "unknown command" in text or "unrecognized command" in text:
            return {"status": "failed", "error_code": "UNKNOWN_COMMAND"}
        return {"status": "failed", "error_code": "PARSE_FAILED"}

    used_tokens, window_tokens = parsed
    if window_tokens <= 0:
        return {"status": "failed", "error_code": "PARSE_FAILED"}
    percent = int(round((used_tokens / window_tokens) * 100))
    percent = max(0, min(100, percent))
    return {
        "status": "ok",
        "used_tokens": used_tokens,
        "window_tokens": window_tokens,
        "percent": percent,
    }


def _unique_dir(parent: Path, slug: str) -> Path:
    """Create a uniquely-named directory under parent using atomic mkdir."""
    for i in itertools.count(1):
        name = slug if i == 1 else f"{slug}-{i}"
        try:
            (parent / name).mkdir(parents=True, exist_ok=False)
            return parent / name
        except FileExistsError:
            continue


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    """Extract the first valid JSON object from text."""
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
        raw = raw.strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end < 0 or end <= start:
        return None
    candidate = raw[start : end + 1]
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _truncate_chars(text: str, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    return text[: max_chars - 3].rstrip() + "..."


def _normalize_basis_fields(plan_data: Optional[dict[str, Any]]) -> dict[str, str]:
    basis_raw = plan_data.get("planning_basis", {}) if isinstance(plan_data, dict) else {}
    basis = basis_raw if isinstance(basis_raw, dict) else {}
    return {
        "goal_alignment": str(basis.get("goal_alignment", "") or "").strip(),
        "deliverables_acceptance": str(
            basis.get("deliverables_acceptance", "") or ""
        ).strip(),
        "default_assumptions": str(basis.get("default_assumptions", "") or "").strip(),
    }


def _phase_tail(plan_data: Optional[dict[str, Any]], phase_index: int) -> list[dict[str, Any]]:
    phases_raw = plan_data.get("phases", []) if isinstance(plan_data, dict) else []
    phases = phases_raw if isinstance(phases_raw, list) else []
    if phase_index < -1:
        phase_index = -1
    tail = phases[phase_index + 1 :]
    return [p for p in tail if isinstance(p, dict)]


def _compute_plan_basis_delta(
    pre_plan_data: Optional[dict[str, Any]],
    post_plan_data: Optional[dict[str, Any]],
    *,
    phase_index: int,
) -> dict[str, Any]:
    pre = pre_plan_data if isinstance(pre_plan_data, dict) else {}
    post = post_plan_data if isinstance(post_plan_data, dict) else {}
    pre_version = int(pre.get("version", 0))
    post_version = int(post.get("version", pre_version))
    pre_basis = _normalize_basis_fields(pre)
    post_basis = _normalize_basis_fields(post)
    basis_changed_fields = [
        key for key in pre_basis.keys() if pre_basis.get(key, "") != post_basis.get(key, "")
    ]
    pre_tail = _phase_tail(pre, phase_index)
    post_tail = _phase_tail(post, phase_index)
    phases_changed = (
        json.dumps(pre_tail, ensure_ascii=False, sort_keys=True)
        != json.dumps(post_tail, ensure_ascii=False, sort_keys=True)
    )
    planning_basis_changed = bool(basis_changed_fields)
    plan_changed = (post_version != pre_version) or planning_basis_changed or phases_changed

    change_parts: list[str] = []
    if planning_basis_changed:
        change_parts.append(
            "planning_basis fields updated: " + ", ".join(basis_changed_fields)
        )
    if phases_changed:
        change_parts.append(f"remaining phases changed after phase {phase_index}")
    if plan_changed and not change_parts:
        change_parts.append(f"plan version changed: v{pre_version} -> v{post_version}")

    return {
        "plan_changed": bool(plan_changed),
        "phases_changed": bool(phases_changed),
        "planning_basis_changed": bool(planning_basis_changed),
        "basis_changed_fields": basis_changed_fields,
        "change_brief": "; ".join(change_parts),
        "pre_version": pre_version,
        "post_version": post_version,
    }


class TeamOrchestrator:
    """Main orchestrator for Agent Team runs."""

    def __init__(
        self,
        base_dir: Path,
        worker: Optional[Worker] = None,
        worker_factory: Optional[Callable[[], Worker]] = None,
        event_manager: Optional[SessionEventManager] = None,
    ):
        self.base_dir = base_dir
        self.worker = worker
        self.worker_factory = worker_factory or (lambda: ClaudeSdkWorker())
        self.event_manager = event_manager
        self.store = TeamSessionStore(base_dir)
        self._active_mailbox: Optional[FileMailbox] = None
        self._active_task: Optional[asyncio.Task] = None
        # Paths to MCP server scripts
        self._mcp_dir = Path(__file__).parent
        self._mailbox_mcp_path = str(self._mcp_dir / "mcp_mailbox_server.py")
        self._plan_mcp_path = str(self._mcp_dir / "mcp_plan_server.py")

    def _emit(self, event_type: EventType, data: Optional[dict] = None):
        """Emit event if event_manager is available."""
        if self.event_manager:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.event_manager.emit(event_type, data))
            except RuntimeError:
                pass

    def create_session(
        self,
        objective: str,
        lead_config: WorkerConfig,
        workspace_dir: Optional[str] = None,
    ) -> TeamSession:
        """Create a new Team session."""
        session_id = f"team-{uuid.uuid4().hex[:12]}"
        ws_dir = workspace_dir or str(self.base_dir / "workspace" / session_id)
        Path(ws_dir).mkdir(parents=True, exist_ok=True)

        # Create team data directory under .opencowork/team/{session_id}/
        team_data_dir = str(self.base_dir / session_id)
        Path(team_data_dir).mkdir(parents=True, exist_ok=True)
        (Path(team_data_dir) / "inboxes").mkdir(exist_ok=True)

        session = TeamSession(
            session_id=session_id,
            lead_config=lead_config,
            workspace_dir=ws_dir,
            team_data_dir=team_data_dir,
            plan=Plan(plan_id=f"plan-{session_id}", objective=objective),
        )
        self.store.save_session(session)
        return session

    def _build_lead_config_with_mcps(self, session: TeamSession) -> WorkerConfig:
        """Build Lead's WorkerConfig with both Plan MCP and Mailbox MCP injected."""
        config = WorkerConfig.from_dict(session.lead_config.to_dict())

        team_ws = session.team_data_dir or session.workspace_dir
        plan_mcp = {
            "command": sys.executable,
            "args": [self._plan_mcp_path],
            "env": {
                "TEAM_WORKSPACE": team_ws,
            },
        }
        mailbox_mcp = {
            "command": sys.executable,
            "args": [self._mailbox_mcp_path],
            "env": {
                "TEAM_WORKSPACE": team_ws,
                "TEAM_AGENT_ID": "lead",
            },
        }

        if isinstance(config.mcp_servers, dict):
            config.mcp_servers["team-plan"] = plan_mcp
            config.mcp_servers["team-mailbox"] = mailbox_mcp
        elif isinstance(config.mcp_servers, list):
            config.mcp_servers.append({"name": "team-plan", **plan_mcp})
            config.mcp_servers.append({"name": "team-mailbox", **mailbox_mcp})
        else:
            config.mcp_servers = {
                "team-plan": plan_mcp,
                "team-mailbox": mailbox_mcp,
            }

        return config

    async def _connect_worker(
        self,
        worker: Worker,
        config: WorkerConfig,
        workspace_dir: Path,
        *,
        resume_sdk_session_id: Optional[str] = None,
    ) -> None:
        """Connect worker with optional resume while preserving compatibility."""
        try:
            await worker.connect(
                config,
                workspace=workspace_dir,
                resume_sdk_session_id=resume_sdk_session_id,
            )
        except TypeError:
            await worker.connect(config, workspace=workspace_dir)

    async def run_async(
        self,
        session_id: str,
        available_worker_configs: dict[str, WorkerConfig],
        worker_types_info: Optional[list[dict]] = None,
    ):
        """Execute a complete Team session."""
        session = self.store.load_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        workspace_dir = Path(session.workspace_dir)
        team_data_dir = Path(session.team_data_dir) if session.team_data_dir else workspace_dir
        activity_log = TeamActivityLog(team_data_dir)
        memory_store = MemoryStore(team_data_dir)
        self._emit(EventType.TEAM_SESSION_START, {"session_id": session_id})

        try:
            # ═══ Planning Phase ═══
            session.status = "planning"
            self.store.save_session(session)
            self._emit(EventType.TEAM_PLANNING_START, {"session_id": session_id})

            # Planning uses a dedicated Lead session.
            planning_config = self._build_lead_config_with_mcps(session)
            planning_config.include_partial_messages = True
            planning_worker = self.worker_factory()

            async def lead_event_callback(event_type, data=None):
                event_data = {"agent": "lead", **(data or {})}
                self._emit(event_type, event_data)

            plan_data: dict[str, Any] | None = None
            available_ids = set(available_worker_configs.keys()) if available_worker_configs else None
            try:
                await self._connect_worker(
                    planning_worker,
                    planning_config,
                    workspace_dir,
                    resume_sdk_session_id=None,
                )

                activity_log.log_section("Planning")
                activity_log.log_prompt_summary("planning", f"Objective: {session.plan.objective}")
                planning_result = await planning_worker.run_async(
                    config=planning_config,
                    prompt=build_planning_prompt(
                        session.plan.objective,
                        worker_types_info or [],
                        workspace_path=session.workspace_dir,
                    ),
                    event_callback=lead_event_callback,
                )
                session.lead_sdk_session_id = planning_result.sdk_session_id
                activity_log.log_lead_response("planning", planning_result.text or "")

                plan_data = _read_plan_from_file(team_data_dir)
                if not plan_data:
                    raise RuntimeError("Leader did not create a plan via create_plan tool")
                activity_log.log_plan(plan_data)
                session.plan = _plan_data_to_plan(plan_data, session.plan.plan_id, available_ids)

                project_name = plan_data.get("project_name", "")
                if not project_name:
                    project_name = _slugify(session.plan.objective)
                else:
                    project_name = _slugify(project_name)
                project_path = _unique_dir(workspace_dir, project_name)
                session.project_dir = str(project_path)
                self.store.save_session(session)
                self._emit(
                    EventType.TEAM_PLANNING_COMPLETE,
                    {
                        "session_id": session_id,
                        "plan": session.plan.to_dict(),
                    },
                )
            finally:
                try:
                    await planning_worker.disconnect()
                except Exception:
                    pass

            if not plan_data:
                raise RuntimeError("Planning phase failed to persist plan")

            memory_store.init_memory(
                plan=session.plan,
                workspace_dir=session.workspace_dir,
                project_dir=session.project_dir or "",
                logs_dir=str(activity_log.logs_dir),
            )

            # ═══ Phase Execution Loop ═══
            phase_idx = 0
            while phase_idx < len(session.plan.phases):
                phase = session.plan.phases[phase_idx]
                session.current_phase_index = phase_idx
                session.status = "executing"
                session.phase_runtime = {
                    "phase_index": phase_idx,
                    "lead_sdk_session_id": None,
                    "lead_context_seeded": False,
                    "lead_reconnect_count": 0,
                }
                self.store.save_session(session)

                lead_config = self._build_lead_config_with_mcps(session)
                lead_config.include_partial_messages = True
                lead_worker = self.worker_factory()

                lead_context_header, lead_used_ids = memory_store.build_lead_phase_pack(
                    plan=session.plan,
                    phase=phase,
                    phase_index=phase_idx,
                    logs_dir=str(activity_log.logs_dir),
                )
                memory_store.mark_used(lead_used_ids, phase_idx)

                worker_pack, worker_used_ids = memory_store.build_worker_phase_pack(
                    plan=session.plan,
                    phase=phase,
                    phase_index=phase_idx,
                    logs_dir=str(activity_log.logs_dir),
                )
                memory_store.mark_used(worker_used_ids, phase_idx)

                def on_lead_session_update(sdk_session_id: str) -> None:
                    runtime = session.phase_runtime if isinstance(session.phase_runtime, dict) else {}
                    previous = str(runtime.get("lead_sdk_session_id", "")).strip()
                    if previous and previous != sdk_session_id:
                        runtime["lead_reconnect_count"] = int(runtime.get("lead_reconnect_count", 0)) + 1
                    runtime["lead_sdk_session_id"] = sdk_session_id
                    session.phase_runtime = runtime
                    session.lead_sdk_session_id = sdk_session_id
                    self.store.save_session(session)

                def on_lead_context_seeded(seed: bool) -> None:
                    runtime = session.phase_runtime if isinstance(session.phase_runtime, dict) else {}
                    runtime["lead_context_seeded"] = bool(seed)
                    session.phase_runtime = runtime
                    self.store.save_session(session)

                context_usage: dict[str, Any] = {
                    "status": "failed",
                    "error_code": "NOT_COLLECTED",
                }
                pre_review_plan_data: dict[str, Any] | None = None
                updated_plan_data: dict[str, Any] | None = None
                phase_review_text = ""
                phase_review_decision = "approve"
                phase_plan_basis_delta: dict[str, Any] = {
                    "plan_changed": False,
                    "phases_changed": False,
                    "planning_basis_changed": False,
                    "basis_changed_fields": [],
                    "change_brief": "",
                    "pre_version": int(session.plan.version) if session.plan else 0,
                    "post_version": int(session.plan.version) if session.plan else 0,
                }

                try:
                    await self._connect_worker(
                        lead_worker,
                        lead_config,
                        workspace_dir,
                        resume_sdk_session_id=None,
                    )

                    mailbox = FileMailbox(team_data_dir)
                    self._active_mailbox = mailbox

                    scheduler = PhaseScheduler(
                        worker_factory=self.worker_factory,
                        workspace_dir=workspace_dir,
                        team_data_dir=team_data_dir,
                        mailbox=mailbox,
                        event_emitter=self._emit,
                        persist_fn=lambda: self.store.save_session(session),
                        previous_results_summary=worker_pack,
                        mcp_mailbox_server_path=self._mailbox_mcp_path,
                        project_dir=session.project_dir or "",
                        planning_basis=session.plan.planning_basis if session.plan else {},
                        activity_log=activity_log,
                        lead_context_header=lead_context_header,
                        inject_lead_context_once=True,
                        phase_resume_enabled=True,
                        on_lead_session_update=on_lead_session_update,
                        on_lead_context_seeded=on_lead_context_seeded,
                    )

                    phase = await scheduler.execute_phase(
                        phase,
                        available_worker_configs,
                        lead_worker=lead_worker,
                        lead_config=lead_config,
                    )
                    if scheduler.latest_lead_worker:
                        lead_worker = scheduler.latest_lead_worker
                    session.plan.phases[phase_idx] = phase
                    self.store.save_session(session)

                    # ═══ Phase Review ═══
                    session.status = "phase_review"
                    self.store.save_session(session)
                    self._emit(
                        EventType.TEAM_PHASE_REVIEW_START,
                        {
                            "phase_id": phase.phase_id,
                            "phase_index": phase_idx,
                        },
                    )

                    remaining_phases = session.plan.phases[phase_idx + 1 :]
                    activity_log.log_section(f"Phase {phase_idx} Review")
                    activity_log.log_prompt_summary(
                        "phase_review", f"Phase {phase_idx}: {phase.description}"
                    )
                    pre_review_plan_data = session.plan.to_dict() if session.plan else {}
                    phase_review_prompt = build_phase_review_prompt(
                        phase,
                        remaining_phases,
                        project_dir=session.project_dir or "",
                        logs_dir=str(activity_log.logs_dir),
                        planning_basis=session.plan.planning_basis if session.plan else {},
                    )
                    phase_review_prompt = (
                        "## Context Anchor\n"
                        f"- Phase: {phase_idx}\n"
                        "- Use memory pointers and approved submissions as source of truth.\n\n"
                        + phase_review_prompt
                    )
                    review_result = await lead_worker.run_async(
                        config=lead_config,
                        prompt=phase_review_prompt,
                        event_callback=lead_event_callback,
                    )
                    if review_result.sdk_session_id:
                        on_lead_session_update(review_result.sdk_session_id)
                    phase_review_text = review_result.text or ""
                    activity_log.log_lead_response("phase_review", phase_review_text)
                    context_usage = await _collect_phase_review_context_usage(
                        lead_worker, lead_config
                    )

                    updated_plan_data = _read_plan_from_file(team_data_dir)
                    post_review_plan_data = (
                        updated_plan_data
                        if isinstance(updated_plan_data, dict)
                        else (session.plan.to_dict() if session.plan else {})
                    )
                    phase_plan_basis_delta = _compute_plan_basis_delta(
                        pre_review_plan_data,
                        post_review_plan_data,
                        phase_index=phase_idx,
                    )
                    if updated_plan_data:
                        old_version = session.plan.version
                        new_plan = _plan_data_to_plan(
                            updated_plan_data, session.plan.plan_id, available_ids
                        )
                        if new_plan.version > old_version:
                            phase_review_decision = "modify"
                            phase.phase_review_decision = "modify"
                            activity_log.log_event("Plan modified by Lead")
                            old_phases = session.plan.phases
                            session.plan = new_plan
                            for i in range(
                                min(
                                    phase_idx + 1,
                                    len(old_phases),
                                    len(session.plan.phases),
                                )
                            ):
                                session.plan.phases[i] = old_phases[i]
                            self._emit(
                                EventType.TEAM_PLAN_UPDATED,
                                {"plan": session.plan.to_dict()},
                            )
                        else:
                            phase_review_decision = "approve"
                            phase.phase_review_decision = "approve"
                    else:
                        phase_review_decision = "approve"
                        phase.phase_review_decision = "approve"
                    if phase_plan_basis_delta.get("change_brief"):
                        activity_log.log_event(
                            f"Plan/Basis delta: {phase_plan_basis_delta.get('change_brief')}"
                        )

                    # Context usage threshold fallback: rebuild session for memory writer.
                    memory_writer_header = ""
                    if (
                        context_usage.get("status") == "ok"
                        and int(context_usage.get("percent", 0)) >= 70
                    ):
                        try:
                            await lead_worker.disconnect()
                        except Exception:
                            pass
                        lead_worker = self.worker_factory()
                        await self._connect_worker(
                            lead_worker,
                            lead_config,
                            workspace_dir,
                            resume_sdk_session_id=None,
                        )
                        runtime = session.phase_runtime if isinstance(session.phase_runtime, dict) else {}
                        runtime["lead_reconnect_count"] = int(runtime.get("lead_reconnect_count", 0)) + 1
                        runtime["lead_context_seeded"] = False
                        session.phase_runtime = runtime
                        self.store.save_session(session)
                        memory_writer_header = lead_context_header + "\n\n"

                    # Memory writer (single round) + commit.
                    final_submissions: list[dict[str, str]] = []
                    logs_path = Path(activity_log.logs_dir)
                    for task in phase.tasks:
                        pattern = f"phase{phase_idx}_{task.task_id}_worker-{task.task_id}_submit*_final.md"
                        matches = sorted(logs_path.glob(pattern))
                        if matches:
                            target = matches[-1]
                            try:
                                content = target.read_text(encoding="utf-8")
                            except OSError:
                                content = ""
                            final_submissions.append(
                                {
                                    "task_id": task.task_id,
                                    "ref": str(target),
                                    "content": _truncate_chars(content, 6000),
                                }
                            )

                    memory_prompt = build_memory_writer_prompt(
                        phase=phase,
                        planning_basis=session.plan.planning_basis if session.plan else {},
                        phase_review_text=phase_review_text,
                        final_submissions=final_submissions,
                        snapshot=memory_store.read_snapshot(),
                        plan_basis_delta=phase_plan_basis_delta,
                    )
                    memory_result = await lead_worker.run_async(
                        config=lead_config,
                        prompt=memory_writer_header + memory_prompt,
                        event_callback=lead_event_callback,
                    )
                    if memory_result.sdk_session_id:
                        on_lead_session_update(memory_result.sdk_session_id)
                    memory_payload = _extract_json_object(memory_result.text or "")
                    commit_info = memory_store.commit_phase(
                        phase_index=phase_idx,
                        phase=phase,
                        plan=session.plan,
                        plan_data=updated_plan_data or (session.plan.to_dict() if session.plan else {}),
                        lead_phase_review_text=phase_review_text,
                        logs_dir=str(activity_log.logs_dir),
                        memory_writer_payload=memory_payload,
                        plan_basis_delta=phase_plan_basis_delta,
                    )
                    activity_log.log_event(
                        "Memory committed for phase "
                        f"{phase_idx}: {commit_info.get('summary_file', commit_info.get('delta_file', ''))} "
                        f"(outcome={commit_info.get('phase_outcome', 'partial')})"
                    )

                    # Abort signal.
                    if updated_plan_data and updated_plan_data.get("abort"):
                        phase_review_decision = "abort"
                        phase.phase_review_decision = "abort"
                        phase.phase_review_notes = updated_plan_data.get(
                            "abort_reason", "Leader aborted"
                        )
                        session.status = "failed"
                        session.error = f"Lead aborted after Phase {phase_idx}"
                        self._emit(
                            EventType.TEAM_PHASE_REVIEW_COMPLETE,
                            {
                                "phase_id": phase.phase_id,
                                "decision": "abort",
                                "context_usage": context_usage,
                            },
                        )
                        session.plan.phases[phase_idx] = phase
                        self.store.save_session(session)
                        break

                    self._emit(
                        EventType.TEAM_PHASE_REVIEW_COMPLETE,
                        {
                            "phase_id": phase.phase_id,
                            "decision": phase_review_decision,
                            "context_usage": context_usage,
                        },
                    )
                    session.plan.phases[phase_idx] = phase
                    self.store.save_session(session)
                    phase_idx += 1
                finally:
                    self._active_mailbox = None
                    try:
                        await lead_worker.disconnect()
                    except Exception:
                        pass
                    session.phase_runtime = {}
                    self.store.save_session(session)

            # ═══ Final Summary ═══
            if session.status != "failed":
                session.status = "completing"
                self.store.save_session(session)

                final_config = self._build_lead_config_with_mcps(session)
                final_config.include_partial_messages = True
                final_worker = self.worker_factory()
                try:
                    await self._connect_worker(
                        final_worker,
                        final_config,
                        workspace_dir,
                        resume_sdk_session_id=None,
                    )
                    activity_log.log_section("Final Summary")
                    final_header = (
                        "## Final Context\n"
                        f"{memory_store.read_north_star().strip()}\n\n"
                        f"{memory_store.read_short_context().strip()}\n\n"
                        f"- Logs: {str(activity_log.logs_dir)}\n"
                        f"- Phase summaries: {str(memory_store.phase_summaries_dir)}\n"
                        f"- Knowledge: {str(memory_store.knowledge_file)}\n"
                    )
                    final_result = await final_worker.run_async(
                        config=final_config,
                        prompt=final_header
                        + "\n\n"
                        + build_final_summary_prompt(
                            session.plan,
                            project_dir=session.project_dir or "",
                            logs_dir=str(activity_log.logs_dir),
                        ),
                        event_callback=lead_event_callback,
                    )
                    session.lead_sdk_session_id = final_result.sdk_session_id
                    session.final_output = final_result.text
                    activity_log.log_lead_response("final_summary", final_result.text or "")
                    session.status = "completed"
                    session.completed_at = utc_now()

                    try:
                        final_output_path = team_data_dir / "__final_output.json"
                        final_output_path.write_text(
                            json.dumps(
                                {
                                    "objective": session.plan.objective if session.plan else "",
                                    "final_output": session.final_output,
                                    "session_id": session.session_id,
                                },
                                ensure_ascii=False,
                                indent=2,
                            ),
                            encoding="utf-8",
                        )
                    except Exception as e:
                        logger.warning(
                            f"[TeamOrchestrator] Failed to write __final_output.json: {e}"
                        )
                finally:
                    try:
                        await final_worker.disconnect()
                    except Exception:
                        pass

        except asyncio.CancelledError:
            session.status = "cancelled"
        except Exception as e:
            session.status = "failed"
            session.error = str(e)
            logger.exception(f"[TeamOrchestrator] Session {session_id} failed")
            self._emit(EventType.TEAM_SESSION_ERROR, {
                "session_id": session_id,
                "error": str(e),
            })

        self.store.save_session(session)
        self._emit(EventType.TEAM_SESSION_COMPLETE, {
            "session_id": session_id,
            "status": session.status,
        })

    async def cancel(self, session_id: str):
        """Cancel a running session."""
        session = self.store.load_session(session_id)
        if session:
            session.status = "cancelled"
            self.store.save_session(session)

        if self._active_mailbox:
            await self._active_mailbox.shutdown()
            self._active_mailbox = None
