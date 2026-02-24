"""Phase scheduler for Agent Team system.

Inbox-driven scheduling: Workers and Leader communicate via Mailbox MCP.
Scheduler polls inbox files, wraps mail as prompts, and delivers to Agents.
Approve/fail detection via plan.json (Plan MCP), content via Mailbox MCP.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from super_agent.models import WorkerConfig, LLMResult, utc_now
from super_agent.worker import Worker
from super_agent.events import EventType

from .models import Message, Phase, TaskResult, TaskStep
from .mailbox import FileMailbox
from .prompts import (
    build_worker_prompt,
    build_worker_submit_reminder_prompt,
    build_task_review_prompt,
)
from .activity_log import TeamActivityLog

logger = logging.getLogger(__name__)


class PhaseScheduler:
    """Executes a single Phase: parallel Workers + Lead review loop.

    Workers submit results via send_mail MCP → inbox file.
    Scheduler polls inbox, wraps mail as prompt, delivers to Agent.
    Leader reviews via Plan MCP (update_task) + Mailbox MCP (send_mail).
    """

    def __init__(
        self,
        *,
        worker_factory: Optional[Callable[[], Worker]] = None,
        workspace_dir: Path,
        team_data_dir: Optional[Path] = None,
        mailbox: FileMailbox,
        event_emitter: Callable[[EventType, Optional[dict]], None],
        persist_fn: Optional[Callable[[], None]] = None,
        previous_results_summary: str = "",
        mcp_mailbox_server_path: str = "",
        project_dir: str = "",
        planning_basis: Optional[dict[str, Any]] = None,
        activity_log: Optional[TeamActivityLog] = None,
        lead_context_header: str = "",
        inject_lead_context_once: bool = True,
        phase_resume_enabled: bool = True,
        max_lead_reconnect_attempts: int = 2,
        max_lead_review_turns: int = 8,
        max_lead_prompt_chars: int = 60_000,
        on_lead_session_update: Optional[Callable[[str], None]] = None,
        on_lead_context_seeded: Optional[Callable[[bool], None]] = None,
        # Legacy compat
        worker: Optional[Worker] = None,
        max_task_submits: int = 3,
    ):
        if worker_factory is not None:
            self.worker_factory = worker_factory
        elif worker is not None:
            _w = worker
            self.worker_factory = lambda: _w
        else:
            raise ValueError("Either worker_factory or worker must be provided")
        self.workspace_dir = workspace_dir
        self.team_data_dir = team_data_dir or workspace_dir
        self.mailbox = mailbox
        self._emit = event_emitter
        self.persist_fn = persist_fn
        self.previous_results_summary = previous_results_summary
        self.mcp_mailbox_server_path = mcp_mailbox_server_path or str(
            Path(__file__).parent / "mcp_mailbox_server.py"
        )
        self.project_dir = project_dir
        self.planning_basis = planning_basis if isinstance(planning_basis, dict) else {}
        self.max_task_submits = max_task_submits
        self.activity_log = activity_log
        self._phase_index = 0
        self.lead_context_header = lead_context_header
        self.inject_lead_context_once = bool(inject_lead_context_once)
        self.phase_resume_enabled = bool(phase_resume_enabled)
        self.max_lead_reconnect_attempts = max(1, int(max_lead_reconnect_attempts))
        self.max_lead_review_turns = max(1, int(max_lead_review_turns))
        self.max_lead_prompt_chars = max(1024, int(max_lead_prompt_chars))
        self.on_lead_session_update = on_lead_session_update
        self.on_lead_context_seeded = on_lead_context_seeded
        self._lead_context_seeded = False
        self._lead_review_turns = 0
        self._lead_prompt_chars = 0
        self._active_lead_session_id: Optional[str] = None
        self.latest_lead_worker: Optional[Worker] = None
        self.latest_lead_config: Optional[WorkerConfig] = None

    async def execute_phase(
        self,
        phase: Phase,
        worker_configs: dict[str, WorkerConfig],
        lead_worker: Worker,
        lead_config: WorkerConfig,
    ) -> Phase:
        """Execute all tasks in a phase with parallel Workers and Lead review."""
        phase.status = "running"
        phase.started_at = utc_now()
        self._phase_index = phase.phase_index
        self.latest_lead_worker = lead_worker
        self.latest_lead_config = lead_config
        if self.activity_log:
            self.activity_log.log_section(f"Phase {phase.phase_index}: {phase.description}")
        self._emit(EventType.TEAM_PHASE_START, {
            "phase_id": phase.phase_id,
            "phase_index": phase.phase_index,
            "description": phase.description,
            "task_count": len(phase.tasks),
        })
        self._persist()

        # Register inbox for each task + lead
        for task in phase.tasks:
            self.mailbox.register_agent(f"worker-{task.task_id}")
        self.mailbox.register_agent("lead")

        # Write team config for list_members
        self._write_team_config(phase)

        # Start all Worker coroutines in parallel
        worker_tasks = {
            task.task_id: asyncio.create_task(
                self._worker_loop(task, worker_configs.get(task.worker_type_id), phase)
            )
            for task in phase.tasks
        }

        # Start Lead review coroutine
        lead_task = asyncio.create_task(
            self._lead_loop(phase, lead_worker, lead_config)
        )

        # Wait for all Workers to finish (approved or failed)
        await asyncio.gather(*worker_tasks.values(), return_exceptions=True)
        # Lead loop exits when all tasks are resolved
        await lead_task

        # Merge Phase status
        has_failed = any(t.status == "failed" for t in phase.tasks)
        all_approved = all(t.status == "approved" for t in phase.tasks)

        if all_approved:
            phase.status = "completed"
        elif has_failed:
            phase.status = "failed"
        else:
            phase.status = "failed"

        phase.completed_at = utc_now()
        self._emit(EventType.TEAM_PHASE_COMPLETE, {
            "phase_id": phase.phase_id,
            "status": phase.status,
        })
        self._persist()

        # Sync plan.json task statuses back to in-memory TaskStep objects
        self._sync_plan_to_tasks(phase)

        return phase

    async def _connect_worker(
        self,
        worker: Worker,
        config: WorkerConfig,
        *,
        resume_sdk_session_id: Optional[str] = None,
    ) -> None:
        """Connect worker with optional resume, preserving backward compatibility."""
        try:
            await worker.connect(
                config,
                workspace=self.workspace_dir,
                resume_sdk_session_id=resume_sdk_session_id,
            )
        except TypeError:
            await worker.connect(config, workspace=self.workspace_dir)

    async def _reconnect_lead_worker(
        self,
        lead_worker: Worker,
        lead_config: WorkerConfig,
        *,
        prefer_resume: bool,
    ) -> tuple[Worker, bool]:
        """Reconnect Lead worker, optionally attempting resume first."""
        try:
            await lead_worker.disconnect()
        except Exception:
            pass

        resume_id = self._active_lead_session_id if prefer_resume else None
        if resume_id:
            resumed_worker = self.worker_factory()
            try:
                await self._connect_worker(
                    resumed_worker, lead_config, resume_sdk_session_id=resume_id
                )
                return resumed_worker, True
            except Exception as e:
                logger.warning(
                    "[Scheduler] Lead resume reconnect failed for phase %s: %s",
                    self._phase_index,
                    e,
                )
                try:
                    await resumed_worker.disconnect()
                except Exception:
                    pass

        fresh_worker = self.worker_factory()
        await self._connect_worker(fresh_worker, lead_config, resume_sdk_session_id=None)
        return fresh_worker, False

    async def _worker_loop(
        self,
        task: TaskStep,
        config: Optional[WorkerConfig],
        phase: Phase,
    ):
        """Single Worker execute-submit-wait-feedback loop."""
        if not config:
            task.status = "failed"
            task.result_error = f"Worker type '{task.worker_type_id}' not found"
            self._emit(EventType.TEAM_TASK_FAILED, {
                "task_id": task.task_id,
                "error": task.result_error,
            })
            self._persist()
            return

        task.status = "running"
        task.started_at = utc_now()
        self._emit(EventType.TEAM_TASK_START, {
            "task_id": task.task_id,
            "description": task.description,
            "worker_type_id": task.worker_type_id,
        })
        self._persist()
        if self.activity_log:
            self.activity_log.log_event(f"Task {task.task_id} started (worker: {task.worker_type_id})")

        # Inject Mailbox MCP into worker config
        worker_config = self._inject_mailbox_mcp(config, task)
        prompt = build_worker_prompt(
            task, phase.tasks, self.previous_results_summary,
            project_dir=self.project_dir,
            logs_dir=str(self.activity_log.logs_dir) if self.activity_log else "",
            planning_basis=self.planning_basis,
        )

        task_worker = self.worker_factory()
        try:
            worker_config.include_partial_messages = True
            await task_worker.connect(worker_config, workspace=self.workspace_dir)

            tool_calls_by_id: dict[str, dict[str, Any]] = {}
            current_run_seq = 0

            async def task_event_callback(event_type, data=None):
                event_data = {"task_id": task.task_id, **(data or {})}
                self._emit(event_type, event_data)
                nonlocal tool_calls_by_id, current_run_seq

                if event_type == EventType.WORKER_TOOL_CALL:
                    tool_id = str(event_data.get("tool_id", "")).strip()
                    if tool_id:
                        tool_calls_by_id[tool_id] = {
                            "tool_name": event_data.get("tool_name"),
                            "input": event_data.get("input"),
                        }
                elif event_type == EventType.WORKER_TOOL_RESULT:
                    self._maybe_track_submission_from_tool_result(
                        task=task,
                        run_seq=current_run_seq,
                        tool_calls_by_id=tool_calls_by_id,
                        tool_result_event=event_data,
                    )

            async def run_worker_turn(turn_prompt: str, *, update_result_text: bool = True) -> tuple[LLMResult, int]:
                nonlocal tool_calls_by_id, current_run_seq
                current_run_seq = self._start_task_run(task)
                tool_calls_by_id = {}
                result = await task_worker.run_async(
                    config=worker_config,
                    prompt=turn_prompt,
                    workspace=self.workspace_dir,
                    event_callback=task_event_callback,
                )
                if result.error:
                    raise RuntimeError(result.error)
                task.worker_sdk_session_id = result.sdk_session_id
                if update_result_text:
                    task.result_text = result.text
                return result, current_run_seq

            async def ensure_submission_or_fallback(trigger_run_seq: int):
                if self._has_submission_for_run(task, trigger_run_seq):
                    return

                logger.warning(
                    "[Scheduler] Worker %s did not submit in run %s; issuing reminder",
                    task.task_id,
                    trigger_run_seq,
                )
                self._emit(EventType.TEAM_TASK_SUBMIT_REMINDER, {
                    "task_id": task.task_id,
                    "run_seq": trigger_run_seq,
                })

                reminder_prompt = build_worker_submit_reminder_prompt(task, trigger_run_seq)
                reminder_run_seq = trigger_run_seq
                try:
                    _, reminder_run_seq = await run_worker_turn(
                        reminder_prompt, update_result_text=False
                    )
                    reminder_state = self._ensure_submission_state(task)
                    reminder_state["reminder_attempted_run_seq"] = reminder_run_seq
                    self._persist()
                except Exception as e:
                    logger.warning(
                        "[Scheduler] Reminder run failed for %s: %s; falling back to auto-submit",
                        task.task_id,
                        e,
                    )
                    reminder_state = self._ensure_submission_state(task)
                    reminder_run_seq = int(reminder_state.get("run_seq", trigger_run_seq))
                    reminder_state["reminder_attempted_run_seq"] = reminder_run_seq
                    self._persist()

                if self._has_submission_for_run(task, reminder_run_seq):
                    return

                self._auto_submit_for_run(task, reminder_run_seq)

            # First execution
            _, first_run_seq = await run_worker_turn(prompt)
            await ensure_submission_or_fallback(first_run_seq)

            # Scheduling loop: idle → check inbox/plan → deliver → new turn
            while True:
                # Wait for inbox mail or task terminal state
                mails = await self.mailbox.wait_for_mail(
                    f"worker-{task.task_id}",
                    task_id=task.task_id,
                )

                # Check plan.json for terminal status
                plan_status = self.mailbox.get_task_status(task.task_id)
                if plan_status == "approved":
                    task.status = "approved"
                    task.completed_at = utc_now()
                    if self.activity_log:
                        self.activity_log.drain_mail_log(
                            self._phase_index,
                        )
                        self.activity_log.mark_final(
                            self._phase_index, task.task_id,
                            f"worker-{task.task_id}",
                        )
                    self._emit(EventType.TEAM_TASK_COMPLETE, {
                        "task_id": task.task_id,
                        "status": "approved",
                    })
                    self._persist()
                    break
                if plan_status == "failed":
                    task.status = "failed"
                    task.result_error = "Marked as failed by Leader"
                    self._emit(EventType.TEAM_TASK_FAILED, {
                        "task_id": task.task_id,
                        "error": task.result_error,
                    })
                    self._persist()
                    break

                if not mails:
                    # Woke up due to cancellation or terminal state without mail
                    continue

                # Max submits check
                task.submit_count += 1
                if task.submit_count > self.max_task_submits:
                    task.status = "failed"
                    task.result_error = f"Exceeded max submits ({self.max_task_submits})"
                    self._emit(EventType.TEAM_TASK_FAILED, {
                        "task_id": task.task_id,
                        "error": task.result_error,
                    })
                    self._persist()
                    break

                # Wrap feedback mails as prompt and deliver
                if self.activity_log:
                    self.activity_log.drain_mail_log(self._phase_index)
                feedback_prompt = self._wrap_mail_as_prompt(mails)
                task.status = "running"

                # Record messages for history
                for m in mails:
                    task.messages.append(Message(
                        from_id=m.get("from", "lead"),
                        to_id=f"worker-{task.task_id}",
                        content=m.get("content", ""),
                        task_id=task.task_id,
                    ))

                self._emit(EventType.TEAM_TASK_FEEDBACK, {
                    "task_id": task.task_id,
                    "feedback": feedback_prompt[:200],
                })
                self._persist()

                _, feedback_run_seq = await run_worker_turn(feedback_prompt)
                await ensure_submission_or_fallback(feedback_run_seq)

                # Ack delivery after successful execution
                self.mailbox.ack_delivered(
                    f"worker-{task.task_id}",
                    [m["id"] for m in mails],
                )

        except asyncio.CancelledError:
            task.status = "failed"
            task.result_error = "Cancelled"
            self._persist()
        except Exception as e:
            task.status = "failed"
            task.result_error = str(e)
            self._emit(EventType.TEAM_TASK_FAILED, {
                "task_id": task.task_id,
                "error": str(e),
            })
            self._persist()
        finally:
            await task_worker.disconnect()

    async def _lead_loop(
        self,
        phase: Phase,
        lead_worker: Worker,
        lead_config: WorkerConfig,
    ):
        """Lead processes Worker submissions from inbox."""
        task_ids = [t.task_id for t in phase.tasks]

        while not self._all_tasks_resolved(phase):
            # Wait for mail in Lead's inbox
            mails = await self.mailbox.wait_for_mail("lead")

            if not mails:
                # Check if all tasks are resolved (might have been resolved without mail)
                if self._all_tasks_resolved(phase):
                    break
                continue

            # Identify which task this mail relates to
            # Update task submit_count and record messages
            for m in mails:
                from_id = m.get("from", "")
                # Extract task_id from "worker-{task_id}"
                if from_id.startswith("worker-"):
                    related_task_id = from_id[len("worker-"):]
                    task = next((t for t in phase.tasks if t.task_id == related_task_id), None)
                    if task:
                        submit_source = self._submission_source_from_mail(m)
                        task.messages.append(Message(
                            from_id=from_id,
                            to_id="lead",
                            content=m.get("content", ""),
                            task_id=related_task_id,
                        ))
                        self._emit(
                            EventType.TEAM_TASK_RESUBMIT if task.submit_count > 1 else EventType.TEAM_TASK_SUBMITTED,
                            {
                                "task_id": related_task_id,
                                "submit_count": task.submit_count,
                                "submit_source": submit_source,
                            },
                        )

            # Build review prompt with all pending mails
            # Drain mail log to capture Worker→Lead mails
            if self.activity_log:
                self.activity_log.drain_mail_log(self._phase_index)

            # Add review instructions
            review_tasks = set()
            prompt_blocks: list[str] = []
            for m in mails:
                from_id = m.get("from", "")
                if from_id.startswith("worker-"):
                    tid = from_id[len("worker-"):]
                    task = next((t for t in phase.tasks if t.task_id == tid), None)
                    if task:
                        review_tasks.add(tid)
                        prompt_blocks.append(
                            build_task_review_prompt(
                                task,
                                m.get("content", ""),
                                project_dir=self.project_dir,
                            )
                        )
            prompt = "\n\n---\n\n".join(prompt_blocks)
            if not prompt.strip():
                continue

            if (
                self._lead_review_turns >= self.max_lead_review_turns
                or self._lead_prompt_chars + len(prompt) > self.max_lead_prompt_chars
            ):
                try:
                    lead_worker, _ = await self._reconnect_lead_worker(
                        lead_worker,
                        lead_config,
                        prefer_resume=False,
                    )
                    self.latest_lead_worker = lead_worker
                    self._lead_context_seeded = False
                    if self.on_lead_context_seeded:
                        self.on_lead_context_seeded(False)
                    self._lead_review_turns = 0
                    self._lead_prompt_chars = 0
                except Exception as e:
                    logger.warning(
                        "[Scheduler] Lead proactive refresh failed in phase %s: %s",
                        self._phase_index,
                        e,
                    )

            if (
                self.inject_lead_context_once
                and not self._lead_context_seeded
                and self.lead_context_header.strip()
            ):
                prompt = f"{self.lead_context_header.rstrip()}\n\n{prompt}"
            elif self.inject_lead_context_once and self._lead_context_seeded:
                prompt = (
                    "## Context Anchor\n"
                    f"- Phase: {self._phase_index}\n"
                    "- Reuse the seeded phase context.\n"
                    "- Quick pass boundary: if request is simple and history-independent, no deep retrieval needed.\n"
                    "- If request is ambiguous/high-risk/history-constrained, run quick pass:\n"
                    "  1) check previous phase summary + north star\n"
                    "  2) check top knowledge hits by keywords/entities\n"
                    "  3) if conflict or low confidence, read refs (workflow/logs/phase summaries)\n\n"
                    f"{prompt}"
                )

            self._emit(EventType.TEAM_REVIEW_START, {
                "task_ids": list(review_tasks),
            })

            try:
                async def lead_event_callback(event_type, data=None):
                    event_data = {"agent": "lead", **(data or {})}
                    self._emit(event_type, event_data)

                lead_result = await lead_worker.run_async(
                    config=lead_config,
                    prompt=prompt,
                    event_callback=lead_event_callback,
                )
                self._lead_review_turns += 1
                self._lead_prompt_chars += len(prompt)
                if lead_result.sdk_session_id:
                    self._active_lead_session_id = lead_result.sdk_session_id
                    if self.on_lead_session_update:
                        self.on_lead_session_update(lead_result.sdk_session_id)
                if self.inject_lead_context_once and not self._lead_context_seeded:
                    self._lead_context_seeded = True
                    if self.on_lead_context_seeded:
                        self.on_lead_context_seeded(True)
                if self.activity_log:
                    self.activity_log.log_lead_response(
                        f"task_review({','.join(review_tasks)})",
                        lead_result.text or "",
                    )
                    self.activity_log.drain_mail_log(self._phase_index)
                # Ack delivery only after successful review
                self.mailbox.ack_delivered("lead", [m["id"] for m in mails])
            except Exception as e:
                logger.error(f"[Scheduler] Lead review failed: {e}")
                # Do NOT ack — mails will be redelivered next round
                recovered = False
                for attempt in range(self.max_lead_reconnect_attempts):
                    try:
                        lead_worker, resumed = await self._reconnect_lead_worker(
                            lead_worker,
                            lead_config,
                            prefer_resume=self.phase_resume_enabled,
                        )
                        self.latest_lead_worker = lead_worker
                        self._lead_context_seeded = False
                        if self.on_lead_context_seeded:
                            self.on_lead_context_seeded(False)
                        if not resumed:
                            self._active_lead_session_id = None
                        recovered = True
                        break
                    except Exception as reconnect_error:
                        logger.warning(
                            "[Scheduler] Lead reconnect attempt %s/%s failed: %s",
                            attempt + 1,
                            self.max_lead_reconnect_attempts,
                            reconnect_error,
                        )
                if not recovered:
                    logger.error("[Scheduler] Lead reconnect failed; waiting for mailbox redelivery")

            # Refresh task statuses from plan.json
            self._sync_plan_to_tasks(phase)

            self._emit(EventType.TEAM_REVIEW_COMPLETE, {
                "task_ids": list(review_tasks),
            })
            self._persist()

    def _all_tasks_resolved(self, phase: Phase) -> bool:
        """Check if all tasks in a phase are in terminal state."""
        for task in phase.tasks:
            # Check both in-memory and plan.json status
            plan_status = self.mailbox.get_task_status(task.task_id)
            if plan_status in ("approved", "failed"):
                continue
            if task.status in ("approved", "failed"):
                continue
            return False
        return True

    def _sync_plan_to_tasks(self, phase: Phase):
        """Sync plan.json task statuses back to in-memory TaskStep objects."""
        plan_file = self.team_data_dir / "plan.json"
        if not plan_file.exists():
            return
        try:
            plan_data = json.loads(plan_file.read_text(encoding="utf-8"))
            for p in plan_data.get("phases", []):
                if p.get("phase_index") == phase.phase_index:
                    for plan_task in p.get("tasks", []):
                        for mem_task in phase.tasks:
                            if mem_task.task_id == plan_task.get("task_id"):
                                plan_status = plan_task.get("status")
                                if plan_status in ("approved", "failed"):
                                    mem_task.status = plan_status
                                    if plan_status == "approved" and not mem_task.completed_at:
                                        mem_task.completed_at = utc_now()
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"[Scheduler] Failed to sync plan.json: {e}")

    def _inject_mailbox_mcp(self, config: WorkerConfig, task: TaskStep) -> WorkerConfig:
        """Create a new WorkerConfig with Mailbox MCP injected."""
        new_config = WorkerConfig.from_dict(config.to_dict())

        mailbox_mcp = {
            "command": sys.executable,
            "args": [self.mcp_mailbox_server_path],
            "env": {
                "TEAM_WORKSPACE": str(self.team_data_dir),
                "TEAM_AGENT_ID": f"worker-{task.task_id}",
            },
        }

        # Merge MCP servers
        if isinstance(new_config.mcp_servers, dict):
            new_config.mcp_servers["team-mailbox"] = mailbox_mcp
        elif isinstance(new_config.mcp_servers, list):
            new_config.mcp_servers.append({"name": "team-mailbox", **mailbox_mcp})
        else:
            new_config.mcp_servers = {"team-mailbox": mailbox_mcp}

        return new_config

    def _wrap_mail_as_prompt(self, mails: list[dict]) -> str:
        """Wrap inbox mails as a user prompt for delivery."""
        parts = []
        for mail in mails:
            parts.append(
                f"Mail from {mail.get('from', 'unknown')}:\n"
                f"─────────────────\n"
                f"{mail.get('content', '')}\n"
                f"─────────────────"
            )
        return "\n\n".join(parts)

    def _ensure_submission_state(self, task: TaskStep) -> dict[str, Any]:
        """Return normalized submission-tracking state for a task."""
        raw = task.submission_state if isinstance(task.submission_state, dict) else {}

        def _to_int(value: object, default: int) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return default

        state: dict[str, Any] = {
            "run_seq": max(0, _to_int(raw.get("run_seq"), 0)),
            "last_submit_run_seq": _to_int(raw.get("last_submit_run_seq"), -1),
            "last_submit_source": str(raw.get("last_submit_source", "") or ""),
            "last_submit_message_id": str(raw.get("last_submit_message_id", "") or ""),
            "last_submit_at": str(raw.get("last_submit_at", "") or ""),
            "submission_seq": max(0, _to_int(raw.get("submission_seq"), 0)),
            "auto_submission_seq": max(0, _to_int(raw.get("auto_submission_seq"), 0)),
            "reminder_attempted_run_seq": _to_int(raw.get("reminder_attempted_run_seq"), -1),
        }

        for key, value in raw.items():
            if key not in state:
                state[key] = value

        task.submission_state = state
        return state

    def _start_task_run(self, task: TaskStep) -> int:
        """Increment per-task run sequence and persist immediately."""
        state = self._ensure_submission_state(task)
        state["run_seq"] = int(state.get("run_seq", 0)) + 1
        self._persist()
        return int(state["run_seq"])

    def _has_submission_for_run(self, task: TaskStep, run_seq: int) -> bool:
        state = self._ensure_submission_state(task)
        return int(state.get("last_submit_run_seq", -1)) == int(run_seq)

    def _is_send_mail_tool(self, tool_name: object) -> bool:
        name = str(tool_name or "").strip().lower()
        return bool(name) and (
            name == "send_mail"
            or name.endswith("__send_mail")
            or name.endswith(".send_mail")
        )

    def _maybe_track_submission_from_tool_result(
        self,
        *,
        task: TaskStep,
        run_seq: int,
        tool_calls_by_id: dict[str, dict[str, Any]],
        tool_result_event: dict[str, Any],
    ):
        """Track successful send_mail(to=lead) from worker tool events."""
        if run_seq <= 0:
            return

        tool_id = str(tool_result_event.get("tool_id", "")).strip()
        if not tool_id:
            return

        call = tool_calls_by_id.get(tool_id, {})
        tool_name = call.get("tool_name")
        if not self._is_send_mail_tool(tool_name):
            return

        tool_input = call.get("input")
        recipient = ""
        if isinstance(tool_input, dict):
            recipient = str(tool_input.get("to", "")).strip().lower()
        if recipient != "lead":
            return

        if bool(tool_result_event.get("is_error", False)):
            return

        self._record_submission(
            task=task,
            run_seq=run_seq,
            source="worker_mail",
            message_id="",
        )

    def _record_submission(
        self,
        *,
        task: TaskStep,
        run_seq: int,
        source: str,
        message_id: str = "",
    ):
        """Persist successful submission state and emit tracking event."""
        state = self._ensure_submission_state(task)
        last_run_seq = int(state.get("last_submit_run_seq", -1))
        last_source = str(state.get("last_submit_source", "") or "")

        if last_run_seq != int(run_seq):
            state["submission_seq"] = int(state.get("submission_seq", 0)) + 1
        if source == "auto_submit" and not (last_run_seq == int(run_seq) and last_source == "auto_submit"):
            state["auto_submission_seq"] = int(state.get("auto_submission_seq", 0)) + 1

        state["last_submit_run_seq"] = int(run_seq)
        state["last_submit_source"] = source
        state["last_submit_message_id"] = message_id or ""
        state["last_submit_at"] = utc_now()

        self._emit(EventType.TEAM_TASK_SUBMISSION_TRACKED, {
            "task_id": task.task_id,
            "run_seq": int(run_seq),
            "source": source,
            "submission_seq": int(state.get("submission_seq", 0)),
            "auto_submission_seq": int(state.get("auto_submission_seq", 0)),
            "message_id": state.get("last_submit_message_id", ""),
        })
        self._persist()

    def _auto_submit_for_run(self, task: TaskStep, run_seq: int):
        """Auto-submit task result and persist source metadata."""
        worker_id = f"worker-{task.task_id}"
        logger.warning(
            "[Scheduler] Worker %s did not send mail in run %s; auto-submitting",
            task.task_id,
            run_seq,
        )
        content = (
            "[Auto-submitted] Worker execution complete.\n\n"
            f"{task.result_text[:2000] if task.result_text else '(no output)'}"
        )
        message_id = self.mailbox.send_auto_mail(
            worker_id,
            "lead",
            content,
            meta={"source": "auto_submit", "run_seq": int(run_seq)},
        )
        self._emit(EventType.TEAM_TASK_AUTOSUBMIT, {
            "task_id": task.task_id,
            "run_seq": int(run_seq),
            "message_id": message_id,
        })
        self._record_submission(
            task=task,
            run_seq=run_seq,
            source="auto_submit",
            message_id=message_id,
        )

    def _submission_source_from_mail(self, mail: dict[str, Any]) -> str:
        meta = mail.get("meta")
        if isinstance(meta, dict):
            source = str(meta.get("source", "")).strip()
            if source:
                return source
        message_id = str(mail.get("id", "")).strip()
        if message_id.startswith("msg-auto-"):
            return "auto_submit"
        return "worker_mail"

    def _write_team_config(self, phase: Phase):
        """Write .team/config.json with member info for list_members tool."""
        config_path = self.team_data_dir / "config.json"
        config_path.parent.mkdir(parents=True, exist_ok=True)

        members = [{"id": "lead", "role": "Lead Agent", "description": "Plans, reviews, and directs"}]
        for task in phase.tasks:
            members.append({
                "id": f"worker-{task.task_id}",
                "role": "Worker",
                "description": task.description[:100],
            })

        config_path.write_text(
            json.dumps({"members": members}, ensure_ascii=False, indent=2)
        )

    def _persist(self):
        """Call persistence callback if provided."""
        if self.persist_fn:
            try:
                self.persist_fn()
            except Exception as e:
                logger.warning(f"[Scheduler] Persist failed: {e}")
