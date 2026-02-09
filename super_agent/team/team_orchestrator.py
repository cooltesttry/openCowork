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
    build_phase_review_prompt,
    build_planning_prompt,
)
from .scheduler import PhaseScheduler

logger = logging.getLogger(__name__)

# Valid task_id pattern: alphanumeric, hyphens, underscores only
_TASK_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


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

    return Plan(
        plan_id=plan_id,
        objective=plan_data.get("objective", ""),
        phases=phases,
        version=plan_data.get("version", 1),
        change_log=plan_data.get("change_log", []),
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


def _unique_dir(parent: Path, slug: str) -> Path:
    """Create a uniquely-named directory under parent using atomic mkdir."""
    for i in itertools.count(1):
        name = slug if i == 1 else f"{slug}-{i}"
        try:
            (parent / name).mkdir(parents=True, exist_ok=False)
            return parent / name
        except FileExistsError:
            continue


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
        self._emit(EventType.TEAM_SESSION_START, {"session_id": session_id})

        try:
            # ═══ Planning Phase ═══
            session.status = "planning"
            self.store.save_session(session)
            self._emit(EventType.TEAM_PLANNING_START, {"session_id": session_id})

            # Create Lead worker with both MCPs
            lead_config = self._build_lead_config_with_mcps(session)
            lead_config.include_partial_messages = True
            lead_worker = self.worker_factory()

            try:
                await lead_worker.connect(lead_config, workspace=workspace_dir)

                async def lead_event_callback(event_type, data=None):
                    event_data = {"agent": "lead", **(data or {})}
                    self._emit(event_type, event_data)

                # Leader creates plan via create_plan MCP tool
                lead_result = await lead_worker.run_async(
                    config=lead_config,
                    prompt=build_planning_prompt(
                        session.plan.objective,
                        worker_types_info or [],
                        workspace_path=session.workspace_dir,
                    ),
                    event_callback=lead_event_callback,
                )
                session.lead_sdk_session_id = lead_result.sdk_session_id

                # Read plan from plan.json (created by Leader via Plan MCP)
                plan_data = _read_plan_from_file(team_data_dir)
                if not plan_data:
                    raise RuntimeError("Leader did not create a plan via create_plan tool")

                available_ids = set(available_worker_configs.keys()) if available_worker_configs else None
                session.plan = _plan_data_to_plan(
                    plan_data, session.plan.plan_id, available_ids
                )

                # Create project directory from plan's project_name
                project_name = plan_data.get("project_name", "")
                if not project_name:
                    project_name = _slugify(session.plan.objective)
                else:
                    project_name = _slugify(project_name)
                project_path = _unique_dir(workspace_dir, project_name)
                session.project_dir = str(project_path)

                self.store.save_session(session)
                self._emit(EventType.TEAM_PLANNING_COMPLETE, {
                    "session_id": session_id,
                    "plan": session.plan.to_dict(),
                })

                # ═══ Phase Execution Loop ═══
                phase_idx = 0
                while phase_idx < len(session.plan.phases):
                    phase = session.plan.phases[phase_idx]
                    session.current_phase_index = phase_idx
                    session.status = "executing"
                    self.store.save_session(session)

                    # Create Phase mailbox
                    mailbox = FileMailbox(team_data_dir)
                    self._active_mailbox = mailbox

                    # Build previous results summary
                    prev_summary = _build_previous_results_summary(session.plan, phase_idx)

                    # Execute Phase
                    scheduler = PhaseScheduler(
                        worker_factory=self.worker_factory,
                        workspace_dir=workspace_dir,
                        team_data_dir=team_data_dir,
                        mailbox=mailbox,
                        event_emitter=self._emit,
                        persist_fn=lambda: self.store.save_session(session),
                        previous_results_summary=prev_summary,
                        mcp_mailbox_server_path=self._mailbox_mcp_path,
                        project_dir=session.project_dir or "",
                    )
                    phase = await scheduler.execute_phase(
                        phase, available_worker_configs,
                        lead_worker=lead_worker,
                        lead_config=lead_config,
                    )
                    self._active_mailbox = None
                    session.plan.phases[phase_idx] = phase
                    self.store.save_session(session)

                    # ═══ Phase Review ═══
                    if phase.status == "failed":
                        phase.phase_review_decision = "abort"
                        phase.phase_review_notes = "Phase failed - one or more tasks failed"
                        session.status = "failed"
                        session.error = f"Phase {phase_idx} failed"
                        break

                    session.status = "phase_review"
                    self.store.save_session(session)
                    self._emit(EventType.TEAM_PHASE_REVIEW_START, {
                        "phase_id": phase.phase_id,
                        "phase_index": phase_idx,
                    })

                    # Leader reviews phase via Plan MCP (may call modify_phases)
                    remaining_phases = session.plan.phases[phase_idx + 1:]
                    review_result = await lead_worker.run_async(
                        config=lead_config,
                        prompt=build_phase_review_prompt(phase, remaining_phases),
                        event_callback=lead_event_callback,
                    )
                    session.lead_sdk_session_id = review_result.sdk_session_id

                    # Check if Leader modified the plan via modify_phases MCP
                    updated_plan_data = _read_plan_from_file(team_data_dir)
                    if updated_plan_data:
                        old_version = session.plan.version
                        new_plan = _plan_data_to_plan(
                            updated_plan_data, session.plan.plan_id, available_ids
                        )
                        if new_plan.version > old_version:
                            # Plan was modified — Leader used modify_phases
                            phase.phase_review_decision = "modify"
                            # Preserve completed phases' runtime data
                            old_phases = session.plan.phases
                            session.plan = new_plan
                            for i in range(min(phase_idx + 1, len(old_phases), len(session.plan.phases))):
                                session.plan.phases[i] = old_phases[i]
                            self._emit(EventType.TEAM_PLAN_UPDATED, {
                                "plan": session.plan.to_dict(),
                            })
                        else:
                            phase.phase_review_decision = "approve"
                    else:
                        phase.phase_review_decision = "approve"

                    # Check for abort signal — Leader sets "abort": true via abort_plan MCP tool
                    if updated_plan_data and updated_plan_data.get("abort"):
                        phase.phase_review_decision = "abort"
                        phase.phase_review_notes = updated_plan_data.get("abort_reason", "Leader aborted")
                        session.status = "failed"
                        session.error = f"Lead aborted after Phase {phase_idx}"
                        self._emit(EventType.TEAM_PHASE_REVIEW_COMPLETE, {
                            "phase_id": phase.phase_id,
                            "decision": "abort",
                        })
                        break

                    self._emit(EventType.TEAM_PHASE_REVIEW_COMPLETE, {
                        "phase_id": phase.phase_id,
                        "decision": phase.phase_review_decision,
                    })
                    self.store.save_session(session)
                    phase_idx += 1

                # ═══ Final Summary ═══
                if session.status != "failed":
                    session.status = "completing"
                    self.store.save_session(session)

                    final_result = await lead_worker.run_async(
                        config=lead_config,
                        prompt=build_final_summary_prompt(session.plan),
                        event_callback=lead_event_callback,
                    )
                    session.lead_sdk_session_id = final_result.sdk_session_id
                    session.final_output = final_result.text
                    session.status = "completed"
                    session.completed_at = utc_now()

                    # Write __final_output.json
                    try:
                        final_output_path = team_data_dir / "__final_output.json"
                        final_output_path.write_text(
                            json.dumps({
                                "objective": session.plan.objective if session.plan else "",
                                "final_output": session.final_output,
                                "session_id": session.session_id,
                            }, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                    except Exception as e:
                        logger.warning(f"[TeamOrchestrator] Failed to write __final_output.json: {e}")

            finally:
                await lead_worker.disconnect()

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
