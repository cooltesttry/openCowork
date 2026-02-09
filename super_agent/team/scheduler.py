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
from .prompts import build_worker_prompt, build_task_review_prompt

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
        self.max_task_submits = max_task_submits

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

        # Inject Mailbox MCP into worker config
        worker_config = self._inject_mailbox_mcp(config, task)
        prompt = build_worker_prompt(task, phase.tasks, self.previous_results_summary, project_dir=self.project_dir)

        task_worker = self.worker_factory()
        try:
            worker_config.include_partial_messages = True
            await task_worker.connect(worker_config, workspace=self.workspace_dir)

            async def task_event_callback(event_type, data=None):
                event_data = {"task_id": task.task_id, **(data or {})}
                self._emit(event_type, event_data)

            # First execution
            result = await task_worker.run_async(
                config=worker_config,
                prompt=prompt,
                workspace=self.workspace_dir,
                event_callback=task_event_callback,
            )
            if result.error:
                raise RuntimeError(result.error)
            task.worker_sdk_session_id = result.sdk_session_id
            task.result_text = result.text

            # Check if worker sent mail to lead; if not, auto-submit
            self._auto_submit_if_needed(task)

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

                result = await task_worker.run_async(
                    config=worker_config,
                    prompt=feedback_prompt,
                    workspace=self.workspace_dir,
                    event_callback=task_event_callback,
                )
                if result.error:
                    raise RuntimeError(result.error)
                task.result_text = result.text

                # Check if worker sent mail to lead after feedback; if not, auto-submit
                self._auto_submit_if_needed(task)

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
                        task.messages.append(Message(
                            from_id=from_id,
                            to_id="lead",
                            content=m.get("content", ""),
                            task_id=related_task_id,
                        ))
                        self._emit(
                            EventType.TEAM_TASK_RESUBMIT if task.submit_count > 1 else EventType.TEAM_TASK_SUBMITTED,
                            {"task_id": related_task_id, "submit_count": task.submit_count},
                        )

            # Build review prompt with all pending mails
            prompt = self._wrap_mail_as_prompt(mails)

            # Add review instructions
            review_tasks = set()
            for m in mails:
                from_id = m.get("from", "")
                if from_id.startswith("worker-"):
                    tid = from_id[len("worker-"):]
                    task = next((t for t in phase.tasks if t.task_id == tid), None)
                    if task:
                        review_tasks.add(tid)
                        prompt += f"\n\n{build_task_review_prompt(task, m.get('content', ''))}"

            self._emit(EventType.TEAM_REVIEW_START, {
                "task_ids": list(review_tasks),
            })

            try:
                async def lead_event_callback(event_type, data=None):
                    event_data = {"agent": "lead", **(data or {})}
                    self._emit(event_type, event_data)

                await lead_worker.run_async(
                    config=lead_config,
                    prompt=prompt,
                    event_callback=lead_event_callback,
                )
                # Ack delivery only after successful review
                self.mailbox.ack_delivered("lead", [m["id"] for m in mails])
            except Exception as e:
                logger.error(f"[Scheduler] Lead review failed: {e}")
                # Do NOT ack — mails will be redelivered next round

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
                f"来自 {mail.get('from', 'unknown')} 的邮件：\n"
                f"─────────────────\n"
                f"{mail.get('content', '')}\n"
                f"─────────────────"
            )
        return "\n\n".join(parts)

    def _auto_submit_if_needed(self, task: TaskStep):
        """Check if worker sent mail to lead; if not, auto-submit with result text."""
        worker_id = f"worker-{task.task_id}"
        lead_inbox = self.mailbox._peek_undelivered("lead")
        worker_sent = any(m.get("from") == worker_id for m in lead_inbox)
        if not worker_sent:
            logger.warning(f"[Scheduler] Worker {task.task_id} didn't send_mail, auto-submitting")
            content = f"[自动提交] Worker 执行完成。\n\n{task.result_text[:2000] if task.result_text else '(无输出)'}"
            self.mailbox.send_auto_mail(worker_id, "lead", content)

    def _write_team_config(self, phase: Phase):
        """Write .team/config.json with member info for list_members tool."""
        config_path = self.team_data_dir / "config.json"
        config_path.parent.mkdir(parents=True, exist_ok=True)

        members = [{"id": "lead", "role": "Lead Agent", "description": "规划、审核和指挥"}]
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
