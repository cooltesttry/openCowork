"""Phase scheduler for Agent Team system.

Manages parallel Worker execution, Lead review loop, and state persistence.
"""

from __future__ import annotations

import asyncio
import json
import json_repair
import logging
from pathlib import Path
from typing import Any, Callable, Coroutine, Optional

from super_agent.models import WorkerConfig, LLMResult, utc_now
from super_agent.worker import Worker
from super_agent.events import EventType

from .models import Message, Phase, TaskResult, TaskStep
from .mailbox import Mailbox, SENTINEL_WORKER_FAILED
from .prompts import build_worker_prompt

logger = logging.getLogger(__name__)

# Type for Lead review callback: (task, message) -> response Message
LeadReviewFn = Callable[[TaskStep, Message], Coroutine[Any, Any, Message]]


class PhaseScheduler:
    """Executes a single Phase: parallel Workers + Lead review loop."""

    def __init__(
        self,
        *,
        worker_factory: Optional[Callable[[], Worker]] = None,
        workspace_dir: Path,
        mailbox: Mailbox,
        event_emitter: Callable[[EventType, Optional[dict]], None],
        max_task_submits: int = 3,
        persist_fn: Optional[Callable[[], None]] = None,
        previous_results_summary: str = "",
        # Legacy: accept 'worker' kwarg for backward compat
        worker: Optional[Worker] = None,
    ):
        if worker_factory is not None:
            self.worker_factory = worker_factory
        elif worker is not None:
            # Backward compat: wrap legacy shared worker in a factory
            _w = worker
            self.worker_factory = lambda: _w
        else:
            raise ValueError("Either worker_factory or worker must be provided")
        self.workspace_dir = workspace_dir
        self.mailbox = mailbox
        self._emit = event_emitter
        self.max_task_submits = max_task_submits
        self.persist_fn = persist_fn
        self.previous_results_summary = previous_results_summary

    async def execute_phase(
        self,
        phase: Phase,
        worker_configs: dict[str, WorkerConfig],
        lead_review_fn: LeadReviewFn,
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

        # Create output directory + register mailbox for each task
        for task in phase.tasks:
            task_dir = self.workspace_dir / f"phase_{phase.phase_index}" / task.task_id
            task_dir.mkdir(parents=True, exist_ok=True)
            self.mailbox.register_worker(task.task_id)

        # Start all Worker coroutines in parallel
        worker_tasks = {
            task.task_id: asyncio.create_task(
                self._worker_loop(task, worker_configs.get(task.worker_type_id), phase)
            )
            for task in phase.tasks
        }

        # Start Lead review coroutine
        lead_task = asyncio.create_task(
            self._lead_review_loop(phase, lead_review_fn)
        )

        # Wait for all Workers to finish (approved or failed)
        await asyncio.gather(*worker_tasks.values(), return_exceptions=True)
        # Lead loop exits naturally after all workers resolve
        await lead_task

        # Merge Phase status from actual task states
        has_failed = any(t.status == "failed" for t in phase.tasks)
        all_approved = all(t.status == "approved" for t in phase.tasks)

        if all_approved:
            phase.status = "completed"
        elif has_failed:
            phase.status = "failed"
        else:
            phase.status = "failed"  # Fallback for unexpected states

        phase.completed_at = utc_now()
        self._emit(EventType.TEAM_PHASE_COMPLETE, {
            "phase_id": phase.phase_id,
            "status": phase.status,
        })
        self._persist()
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
            await self.mailbox.notify_worker_failed(task.task_id)
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

        task_dir = self.workspace_dir / f"phase_{phase.phase_index}" / task.task_id
        prompt = build_worker_prompt(task, phase.tasks, self.previous_results_summary)

        # Create an independent worker for this task and connect
        task_worker = self.worker_factory()
        try:
            await task_worker.connect(config, workspace=task_dir)

            while True:
                # Max submits hard limit
                if task.submit_count >= self.max_task_submits:
                    task.status = "failed"
                    task.result_error = f"Exceeded max submits ({self.max_task_submits})"
                    self._emit(EventType.TEAM_TASK_FAILED, {
                        "task_id": task.task_id,
                        "error": task.result_error,
                    })
                    await self.mailbox.notify_worker_failed(task.task_id)
                    self._persist()
                    return

                result = await task_worker.run_async(
                    config=config,
                    prompt=prompt,
                    workspace=task_dir,
                )

                # Check for SDK-level errors
                if result.error:
                    raise RuntimeError(result.error)

                task.worker_sdk_session_id = result.sdk_session_id
                task.result_text = result.text
                task.submit_count += 1

                # Try to read __result.json, fallback to __output.json
                result_file = task_dir / "__result.json"
                fallback_file = task_dir / "__output.json"
                chosen_file = result_file if result_file.exists() else (
                    fallback_file if fallback_file.exists() else None
                )
                if chosen_file:
                    try:
                        raw_text = chosen_file.read_text(encoding="utf-8")
                        try:
                            result_data = json.loads(raw_text)
                        except json.JSONDecodeError:
                            result_data = json_repair.loads(raw_text)
                            if not isinstance(result_data, dict):
                                raise ValueError("Repaired JSON is not a dict")
                        # Map __output.json fields to __result.json schema
                        if chosen_file.name == "__output.json":
                            result_data.setdefault("content", result_data.pop("text_content", ""))
                            result_data.setdefault("instruction", result_data.pop("instruction_to_user", ""))
                        task.result = TaskResult(
                            summary=result_data.get("summary", ""),
                            content=result_data.get("content", ""),
                            files=result_data.get("files", []),
                            instruction=result_data.get("instruction", ""),
                            output_dir=str(task_dir),
                        )
                    except (json.JSONDecodeError, ValueError, OSError) as e:
                        logger.warning(f"[Scheduler] Failed to parse {chosen_file.name} for {task.task_id}: {e}")

                # Fallback: generate TaskResult from result_text if no file found
                if not task.result:
                    task.result = TaskResult(
                        summary=task.result_text[:200] if task.result_text else "",
                        content=task.result_text or "",
                        output_dir=str(task_dir),
                    )

                # Submit result to Lead
                submit_msg = Message(
                    from_id=f"worker-{task.task_id}",
                    to_id="lead",
                    task_id=task.task_id,
                    content=task.result_text,
                    message_type="submit_result",
                )
                task.status = "submitted"
                task.messages.append(submit_msg)
                await self.mailbox.send_to_lead(submit_msg)
                self._emit(
                    EventType.TEAM_TASK_RESUBMIT if task.submit_count > 1 else EventType.TEAM_TASK_SUBMITTED,
                    {
                        "task_id": task.task_id,
                        "submit_count": task.submit_count,
                    },
                )
                self._persist()

                # Wait for Lead feedback
                response = await self.mailbox.receive_for_worker(task.task_id)
                if response is None:
                    # Shutdown/cancelled signal
                    task.status = "failed"
                    task.result_error = "Cancelled"
                    return

                task.messages.append(response)
                self._persist()

                if response.message_type == "approve":
                    task.status = "approved"
                    task.completed_at = utc_now()
                    self.mailbox.remove_worker(task.task_id)
                    self._emit(EventType.TEAM_TASK_COMPLETE, {
                        "task_id": task.task_id,
                        "status": "approved",
                    })
                    self._persist()
                    return
                elif response.message_type == "feedback":
                    task.status = "running"
                    prompt = response.content
                    self._emit(EventType.TEAM_TASK_FEEDBACK, {
                        "task_id": task.task_id,
                        "feedback": response.content[:200],
                    })
                    self._persist()
                    # Continue loop — same client, no resume needed
        except asyncio.CancelledError:
            task.status = "failed"
            task.result_error = "Cancelled"
            await self.mailbox.notify_worker_failed(task.task_id)
            self._persist()
        except Exception as e:
            task.status = "failed"
            task.result_error = str(e)
            self._emit(EventType.TEAM_TASK_FAILED, {
                "task_id": task.task_id,
                "error": str(e),
            })
            await self.mailbox.notify_worker_failed(task.task_id)
            self._persist()
        finally:
            await task_worker.disconnect()

    async def _lead_review_loop(self, phase: Phase, lead_review_fn: LeadReviewFn):
        """Lead processes Worker submissions sequentially from the queue."""
        resolved_count = 0  # approved + failed
        total_tasks = len(phase.tasks)

        while resolved_count < total_tasks:
            message = await self.mailbox.receive_for_lead()
            if message is None:
                # Shutdown signal
                break

            # Handle Worker failure sentinel
            if message.message_type == SENTINEL_WORKER_FAILED:
                resolved_count += 1
                continue

            task = next((t for t in phase.tasks if t.task_id == message.task_id), None)
            if not task:
                resolved_count += 1
                continue

            self._emit(EventType.TEAM_REVIEW_START, {
                "task_id": message.task_id,
            })

            # Call Lead Agent for review — catch exceptions to avoid deadlock
            try:
                response = await lead_review_fn(task, message)
            except Exception as e:
                logger.error(f"[Scheduler] Lead review failed for {message.task_id}: {e}")
                # Send feedback so the worker can retry (or hit max_submits and fail)
                response = Message(
                    from_id="lead",
                    to_id=f"worker-{task.task_id}",
                    task_id=task.task_id,
                    content=f"Lead review error: {e}. Please resubmit.",
                    message_type="feedback",
                )

            # Send response to Worker
            await self.mailbox.send_to_worker(message.task_id, response)

            if response.message_type == "approve":
                resolved_count += 1

            self._emit(EventType.TEAM_REVIEW_COMPLETE, {
                "task_id": message.task_id,
                "decision": response.message_type,
            })
            self._persist()

    def _persist(self):
        """Call persistence callback if provided."""
        if self.persist_fn:
            try:
                self.persist_fn()
            except Exception as e:
                logger.warning(f"[Scheduler] Persist failed: {e}")
