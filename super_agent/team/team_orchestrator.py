"""Main orchestrator for Agent Team system.

Manages the full lifecycle: planning → phase execution → phase review → final summary.
"""

from __future__ import annotations

import asyncio
import json
import json_repair
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from super_agent.models import WorkerConfig, LLMResult, utc_now
from super_agent.worker import Worker, ClaudeSdkWorker
from super_agent.events import EventType, SessionEventManager

from .models import Message, Phase, Plan, TaskStep, TeamSession
from .mailbox import Mailbox
from .persistence import TeamSessionStore
from .prompts import (
    build_final_summary_prompt,
    build_phase_review_prompt,
    build_planning_prompt,
    build_task_review_prompt,
)
from .scheduler import PhaseScheduler

logger = logging.getLogger(__name__)

# Valid task_id pattern: alphanumeric, hyphens, underscores only
_TASK_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _sanitize_task_id(raw_id: str, fallback_prefix: str = "task") -> str:
    """Sanitize a task_id from LLM output to prevent path traversal.

    Only allows alphanumeric characters, hyphens, and underscores.
    Returns a safe fallback if the input is invalid.
    """
    if raw_id and _TASK_ID_RE.match(raw_id) and len(raw_id) <= 128:
        return raw_id
    # Strip unsafe characters and try to salvage something
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", raw_id)[:64]
    if safe and _TASK_ID_RE.match(safe):
        return safe
    return f"{fallback_prefix}_{uuid.uuid4().hex[:6]}"


def _ensure_unique_task_ids(tasks: list) -> list:
    """Ensure all task_ids within a list are unique, renaming duplicates."""
    seen: set[str] = set()
    for task in tasks:
        original = task.task_id
        while task.task_id in seen:
            task.task_id = f"{original}_{uuid.uuid4().hex[:4]}"
        seen.add(task.task_id)
    return tasks


def _extract_json(text: str) -> dict:
    """Extract JSON from LLM response text, handling markdown fences and minor errors."""
    # Try direct parse first
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass

    # Try extracting from markdown code block
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try finding first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    # Last resort: use json_repair to fix common LLM JSON errors
    # (trailing commas, single quotes, unquoted keys, missing brackets, etc.)
    if "{" in text:
        try:
            candidate = text[text.find("{"):]
            result = json_repair.loads(candidate)
            if isinstance(result, dict):
                return result
        except Exception:
            pass

    return {}


def _parse_plan(text: str, plan: Plan, available_worker_ids: set[str] | None = None) -> Plan:
    """Parse Lead's planning output into a Plan object."""
    data = _extract_json(text)

    # Determine a safe fallback worker type
    fallback_worker = "default"
    if available_worker_ids:
        if "default" not in available_worker_ids:
            fallback_worker = next(iter(sorted(available_worker_ids)), "default")

    if not data:
        logger.warning("[Orchestrator] Failed to parse plan JSON, creating single-phase fallback")
        plan.phases = [
            Phase(
                phase_id="phase_0",
                phase_index=0,
                description="Execute the requested task",
                tasks=[
                    TaskStep(
                        task_id="task_001",
                        description=plan.objective,
                        worker_type_id=fallback_worker,
                    )
                ],
            )
        ]
        return plan

    plan.objective = data.get("objective", plan.objective)
    plan.phases = []
    for i, phase_data in enumerate(data.get("phases", [])):
        phase = Phase(
            phase_id=phase_data.get("phase_id", f"phase_{i}"),
            phase_index=i,
            description=phase_data.get("description", ""),
        )
        for task_data in phase_data.get("tasks", []):
            raw_task_id = task_data.get("task_id", f"task_{uuid.uuid4().hex[:6]}")
            worker_type = task_data.get("worker_type_id", fallback_worker)
            # Validate worker_type_id against available configs
            if available_worker_ids and worker_type not in available_worker_ids:
                logger.warning(f"[Orchestrator] Unknown worker_type_id '{worker_type}', using '{fallback_worker}'")
                worker_type = fallback_worker
            phase.tasks.append(
                TaskStep(
                    task_id=_sanitize_task_id(raw_task_id),
                    description=task_data.get("description", ""),
                    worker_type_id=worker_type,
                    context=task_data.get("context", {}),
                )
            )
        _ensure_unique_task_ids(phase.tasks)
        plan.phases.append(phase)

    return plan


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
                output_dir = ""
                if task.result.output_dir:
                    output_dir = f" [dir: {task.result.output_dir}]"
                parts.append(f"- [{task.task_id}] {summary}{files}{output_dir}")
            elif task.result_text:
                parts.append(f"- [{task.task_id}] {task.result_text[:200]}")
    return "\n".join(parts)


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
        self.worker = worker  # Legacy: shared worker (backward compat)
        self.worker_factory = worker_factory or (lambda: ClaudeSdkWorker())
        self.event_manager = event_manager
        self.store = TeamSessionStore(base_dir)
        # Active run state for cancellation
        self._active_mailbox: Optional[Mailbox] = None
        self._active_task: Optional[asyncio.Task] = None

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
        max_task_submits: int = 3,
    ) -> TeamSession:
        """Create a new Team session."""
        session_id = f"team-{uuid.uuid4().hex[:12]}"
        ws_dir = workspace_dir or str(self.base_dir / "workspace" / session_id)
        Path(ws_dir).mkdir(parents=True, exist_ok=True)

        session = TeamSession(
            session_id=session_id,
            lead_config=lead_config,
            workspace_dir=ws_dir,
            max_task_submits=max_task_submits,
            plan=Plan(plan_id=f"plan-{session_id}", objective=objective),
        )
        self.store.save_session(session)
        return session

    async def run_async(
        self,
        session_id: str,
        available_worker_configs: dict[str, WorkerConfig],
        worker_types_info: Optional[list[dict]] = None,
    ):
        """Execute a complete Team session.

        Args:
            session_id: The session to run.
            available_worker_configs: Map of worker_type_id -> WorkerConfig.
            worker_types_info: List of dicts with worker type metadata for planning prompt.
        """
        session = self.store.load_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        self._emit(EventType.TEAM_SESSION_START, {"session_id": session_id})

        try:
            # ═══ Planning Phase ═══
            session.status = "planning"
            self.store.save_session(session)
            self._emit(EventType.TEAM_PLANNING_START, {"session_id": session_id})

            # Create Lead-specific persistent worker
            lead_worker = self.worker_factory()
            try:
                # Enable streaming for real-time display
                session.lead_config.include_partial_messages = True
                await lead_worker.connect(session.lead_config)

                # Create event callback for lead worker
                async def lead_event_callback(event_type, data=None):
                    event_data = {"agent": "lead", **(data or {})}
                    self._emit(event_type, event_data)

                lead_result = await lead_worker.run_async(
                    config=session.lead_config,
                    prompt=build_planning_prompt(
                        session.plan.objective,
                        worker_types_info or [],
                    ),
                    event_callback=lead_event_callback,
                )
                session.lead_sdk_session_id = lead_result.sdk_session_id
                session.plan = _parse_plan(
                    lead_result.text, session.plan,
                    available_worker_ids=set(available_worker_configs.keys()) if available_worker_configs else None,
                )
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
                    mailbox = Mailbox()
                    self._active_mailbox = mailbox

                    # Build previous results summary
                    prev_summary = _build_previous_results_summary(session.plan, phase_idx)

                    # Lead review callback (closure captures session and lead_worker)
                    async def lead_review_fn(task: TaskStep, message: Message) -> Message:
                        return await self._lead_review_task(session, task, message, lead_worker, lead_event_callback)

                    # Execute Phase
                    scheduler = PhaseScheduler(
                        worker_factory=self.worker_factory,
                        workspace_dir=Path(session.workspace_dir),
                        mailbox=mailbox,
                        event_emitter=self._emit,
                        max_task_submits=session.max_task_submits,
                        persist_fn=lambda: self.store.save_session(session),
                        previous_results_summary=prev_summary,
                    )
                    phase = await scheduler.execute_phase(
                        phase, available_worker_configs, lead_review_fn
                    )
                    self._active_mailbox = None  # Phase done, clear reference
                    session.plan.phases[phase_idx] = phase
                    self.store.save_session(session)

                    # ═══ Phase Review ═══
                    if phase.status == "failed":
                        # Skip review for failed phases
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

                    remaining_phases = session.plan.phases[phase_idx + 1 :]
                    review_text = await self._lead_phase_review(
                        session, phase, remaining_phases, lead_worker, lead_event_callback
                    )
                    decision = _extract_json(review_text)

                    decision_type = decision.get("decision", "approve")
                    if decision_type == "approve":
                        phase.phase_review_decision = "approve"
                        phase_idx += 1
                    elif decision_type == "modify":
                        phase.phase_review_decision = "modify"
                        phase.phase_review_notes = decision.get("reason", "")
                        # Compute available worker IDs for validation
                        available_worker_ids = set(available_worker_configs.keys()) if available_worker_configs else None
                        fallback_worker = "default"
                        if available_worker_ids and "default" not in available_worker_ids:
                            fallback_worker = next(iter(sorted(available_worker_ids)), "default")
                        # Replace remaining phases
                        new_phases = []
                        for i, p_data in enumerate(decision.get("updated_phases", [])):
                            new_phase = Phase(
                                phase_id=p_data.get("phase_id", f"phase_{phase_idx + 1 + i}"),
                                phase_index=phase_idx + 1 + i,
                                description=p_data.get("description", ""),
                            )
                            for t_data in p_data.get("tasks", []):
                                raw_tid = t_data.get("task_id", f"task_{uuid.uuid4().hex[:6]}")
                                worker_type = t_data.get("worker_type_id", fallback_worker)
                                # Validate worker_type_id against available configs
                                if available_worker_ids and worker_type not in available_worker_ids:
                                    logger.warning(f"[Orchestrator] Unknown worker_type_id '{worker_type}' in modify, using '{fallback_worker}'")
                                    worker_type = fallback_worker
                                new_phase.tasks.append(
                                    TaskStep(
                                        task_id=_sanitize_task_id(raw_tid),
                                        description=t_data.get("description", ""),
                                        worker_type_id=worker_type,
                                        context=t_data.get("context", {}),
                                    )
                                )
                            _ensure_unique_task_ids(new_phase.tasks)
                            new_phases.append(new_phase)

                        session.plan.phases = session.plan.phases[: phase_idx + 1] + new_phases
                        # Re-index all phases
                        for i, p in enumerate(session.plan.phases):
                            p.phase_index = i
                        session.plan.version += 1
                        session.plan.change_log.append(
                            f"v{session.plan.version}: Phase {phase_idx} review - {decision.get('reason', '')}"
                        )
                        self._emit(EventType.TEAM_PLAN_UPDATED, {
                            "plan": session.plan.to_dict(),
                        })
                        phase_idx += 1
                    elif decision_type == "abort":
                        phase.phase_review_decision = "abort"
                        phase.phase_review_notes = decision.get("reason", "")
                        session.status = "failed"
                        session.error = f"Lead aborted: {decision.get('reason', '')}"
                        break
                    else:
                        # Unknown decision, treat as approve
                        phase.phase_review_decision = "approve"
                        phase_idx += 1

                    self._emit(EventType.TEAM_PHASE_REVIEW_COMPLETE, {
                        "phase_id": phase.phase_id,
                        "decision": phase.phase_review_decision,
                    })
                    self.store.save_session(session)

                # ═══ Final Summary ═══
                if session.status != "failed":
                    session.status = "completing"
                    self.store.save_session(session)

                    final_result = await lead_worker.run_async(
                        config=session.lead_config,
                        prompt=build_final_summary_prompt(session.plan),
                        event_callback=lead_event_callback,
                    )
                    session.lead_sdk_session_id = final_result.sdk_session_id
                    session.final_output = final_result.text
                    session.status = "completed"
                    session.completed_at = utc_now()

                    # Write __final_output.json to workspace root
                    try:
                        final_output_path = Path(session.workspace_dir) / "__final_output.json"
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

    async def _lead_review_task(
        self, session: TeamSession, task: TaskStep, message: Message,
        lead_worker: Optional[Worker] = None,
        event_callback=None,
    ) -> Message:
        """Lead reviews a single Worker submission."""
        prompt = build_task_review_prompt(task, message)
        worker = lead_worker or self.worker
        result = await worker.run_async(
            config=session.lead_config,
            prompt=prompt,
            resume_sdk_session_id=session.lead_sdk_session_id if not lead_worker else None,
            event_callback=event_callback,
        )
        session.lead_sdk_session_id = result.sdk_session_id

        decision = _extract_json(result.text)

        if decision.get("decision") == "approve":
            return Message(
                from_id="lead",
                to_id=f"worker-{task.task_id}",
                task_id=task.task_id,
                content="approved",
                message_type="approve",
            )
        else:
            return Message(
                from_id="lead",
                to_id=f"worker-{task.task_id}",
                task_id=task.task_id,
                content=decision.get("content", "Please revise your submission."),
                message_type="feedback",
            )

    async def _lead_phase_review(
        self, session: TeamSession, phase: Phase, remaining_phases: list[Phase],
        lead_worker: Optional[Worker] = None,
        event_callback=None,
    ) -> str:
        """Lead performs Phase-level review."""
        prompt = build_phase_review_prompt(phase, remaining_phases)
        worker = lead_worker or self.worker
        result = await worker.run_async(
            config=session.lead_config,
            prompt=prompt,
            resume_sdk_session_id=session.lead_sdk_session_id if not lead_worker else None,
            event_callback=event_callback,
        )
        session.lead_sdk_session_id = result.sdk_session_id
        return result.text

    async def cancel(self, session_id: str):
        """Cancel a running session."""
        session = self.store.load_session(session_id)
        if session:
            session.status = "cancelled"
            self.store.save_session(session)

        # Shutdown active mailbox to unblock waiting coroutines
        if self._active_mailbox:
            await self._active_mailbox.shutdown()
            self._active_mailbox = None
