from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Optional
import json
import shutil
import logging

logger = logging.getLogger(__name__)

from .models import CheckerResult
from .models import (
    CheckerResult,
    CycleRecord,
    LLMResult,
    SessionState,
    TaskDefinition,
    WorkerConfig,
    utc_now,
)
from .persistence import SessionStore
from .worker import StubWorker, Worker
from .events import EventType


STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


class Orchestrator:
    def __init__(
        self,
        base_dir: Optional[Path] = None,
        worker: Optional[Worker] = None,
        checker_config: Optional[WorkerConfig] = None,
        cycle_wait_seconds: int = 0,
    ):
        self.store = SessionStore(base_dir)
        self.worker = worker or StubWorker()
        self.checker_config = checker_config  # Checker worker config
        self.cycle_wait_seconds = max(0, cycle_wait_seconds)

    def create_session(
        self,
        task: TaskDefinition,
        worker_config: WorkerConfig,
        input_payload: Optional[dict] = None,
        max_cycles: int = 3,
        reset_on_max_cycles: bool = False,
        max_resets: int = 0,
    ) -> SessionState:
        session_id = self._new_session_id()
        now = utc_now()
        session = SessionState(
            session_id=session_id,
            status=STATUS_PENDING,
            worker_config=worker_config,
            task=task,
            cycle_count=0,
            max_cycles=max_cycles,
            input_payload=input_payload or dict(task.inputs),
            last_result=None,
            history=[],
            created_at=now,
            updated_at=now,
            reset_on_max_cycles=reset_on_max_cycles,
            max_resets=max_resets,
        )
        self.store.save_session(session)
        self.store.append_log(session_id, f"{now} session created")
        return session

    def run(self, session_id: str) -> SessionState:
        """Synchronous wrapper for async run. Use AsyncOrchestrator.run() in async contexts."""
        try:
            asyncio.get_running_loop()
            raise RuntimeError(
                "Cannot use synchronous Orchestrator.run() inside an async loop. "
                "Use 'await orchestrator.run_async()' instead."
            )
        except RuntimeError:
            pass
        return asyncio.run(self.run_async(session_id))

    async def run_async(self, session_id: str) -> SessionState:
        """Run the session to completion. Override in subclass."""
        raise NotImplementedError("Subclass must implement run_async")

    async def run_once(self, session_id: str) -> SessionState:
        """Run a single cycle. Override in subclass."""
        raise NotImplementedError("Subclass must implement run_once")

    def _handle_max_cycles(self, session: SessionState) -> SessionState:
        if session.reset_on_max_cycles and self._can_reset(session):
            return self._reset_session(session, "max_cycles")
        session.status = STATUS_FAILED
        session.last_error = "max_cycles"
        session.updated_at = utc_now()
        self.store.save_session(session)
        self.store.append_log(session.session_id, f"{session.updated_at} failed max_cycles")
        return session

    def _reset_session(self, session: SessionState, reason: str) -> SessionState:
        session.reset_count += 1
        session.cycle_count = 0
        session.status = STATUS_PENDING
        session.input_payload = dict(session.task.inputs)
        session.updated_at = utc_now()
        self.store.save_session(session)
        self.store.append_log(
            session.session_id, f"{session.updated_at} reset {reason}"
        )
        return session

    @staticmethod
    def _can_reset(session: SessionState) -> bool:
        if session.max_resets <= 0:
            return False
        return session.reset_count < session.max_resets

    @staticmethod
    def _build_cycle_record(
        cycle_index: int,
        started_at: str,
        ended_at: str,
        input_payload: dict,
        llm_result: LLMResult,
        checker_result: CheckerResult,
        summary: str = "",
        artifacts: list = None,
    ) -> CycleRecord:
        return CycleRecord(
            cycle_index=cycle_index,
            started_at=started_at,
            ended_at=ended_at,
            input_payload=dict(input_payload),
            llm_result=llm_result,
            passed=checker_result.passed,
            checker_reason=checker_result.reason,
            summary=summary,
            artifacts=artifacts or [],
        )

    def _load_or_fail(self, session_id: str) -> SessionState:
        session = self.store.load_session(session_id)
        if not session:
            raise KeyError(f"session not found: {session_id}")
        return session

    @staticmethod
    def _new_session_id() -> str:
        return f"session-{uuid.uuid4().hex[:12]}"


class AsyncOrchestrator(Orchestrator):
    # Event manager injected by router for real-time progress updates
    event_manager = None
    
    async def _emit(self, event_type: EventType, data: dict = None):
        """Emit an event if event_manager is available."""
        if self.event_manager:
            await self.event_manager.emit(event_type, data or {})
    
    @staticmethod
    def _build_user_prompt(
        config: WorkerConfig, task: TaskDefinition, input_payload: dict, workspace: Path | None = None
    ) -> str:
        """Build user prompt for Worker.
        
        Combines:
        1. Context info with placeholders ({{TIME}}, {{CWD}})
        2. Task objective
        3. User prompt from config
        4. Input payload
        
        Worker will replace {{TIME}} and {{CWD}} placeholders.
        """
        import json
        
        sections: list[str] = []
        
        # Context info with placeholders (Worker will replace)
        context_info = (
            "Current Time: {{TIME}}\n"
            "Current Working Directory: {{CWD}}\n"
            "IMPORTANT: Use the current time for any date-related tasks. "
            "Ensure all file operations are performed strictly within the Current Working Directory."
        )
        sections.append(context_info)

        if task.objective:
            sections.append(task.objective.strip())
        
        user_prompt = config.prompt.get("user")
        if user_prompt:
            sections.append(str(user_prompt).strip())
        
        if input_payload:
            sections.append(
                "Input:\n" + json.dumps(input_payload, indent=2, ensure_ascii=True)
            )
        
        text = "\n\n".join([section for section in sections if section])
        return text.strip() or " "
    
    def _build_checker_prompt(self, task: TaskDefinition, llm_result: LLMResult) -> str:
        """Build user prompt for Checker Worker.
        
        The System Prompt is in the checker worker config.
        This builds only the dynamic user prompt with task/result info.
        """
        import json
        
        # Extract output from LLMResult text
        output_data = llm_result.text
        try:
            parsed = json.loads(llm_result.text)
            if isinstance(parsed, dict):
                output_data = json.dumps(parsed, indent=2, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            output_data = llm_result.text
        
        prompt = f"""# Task Objective
{task.objective}

# Expected Outcome
{json.dumps(task.expected_output, indent=2, ensure_ascii=False) if task.expected_output else "Not specified - use your judgment based on the objective."}

# Worker's Claimed Output
{output_data}

Error reported: {llm_result.error or "None"}

Please verify the Worker's claims using available tools and render your verdict as JSON."""
        return prompt
    
    def _parse_checker_verdict(self, checker_llm_result: LLMResult) -> CheckerResult:
        """Parse Checker Worker's LLMResult output into CheckerResult."""
        import json
        import re
        
        response_text = checker_llm_result.text
        
        if checker_llm_result.error:
            return CheckerResult(
                passed=False,
                reason=f"checker_error: {checker_llm_result.error}",
                next_input={"error_feedback": f"Checker failed: {checker_llm_result.error}"}
            )
        
        # Extract JSON from response
        try:
            # Try to find ```json ... ```
            match = re.search(r"```json\s*(.*?)\s*```", response_text, re.DOTALL)
            if match:
                json_str = match.group(1)
            else:
                # Try to find { ... }
                match = re.search(r"\{.*\}", response_text, re.DOTALL)
                json_str = match.group(0) if match else response_text
            
            data = json.loads(json_str)
            verdict = data.get("verdict", "failed")
            reason = data.get("reason", "")
            feedback = data.get("feedback", "")
            verified = data.get("verified", [])
            
            if verdict == "passed":
                return CheckerResult(passed=True, reason="verified_passed")
            else:
                return CheckerResult(
                    passed=False,
                    reason=f"{verdict}: {reason}",
                    next_input={
                        "review_verdict": verdict,
                        "review_feedback": feedback,
                        "review_reason": reason,
                        "verified_items": verified,
                    }
                )
        except (json.JSONDecodeError, AttributeError) as e:
            logger.error(f"[Orchestrator] Failed to parse checker verdict: {e}")
            return CheckerResult(
                passed=False,
                reason="checker_parsing_error",
                next_input={"review_feedback": f"Checker output was malformed: {response_text[:200]}..."}
            )
    
    async def run_async(self, session_id: str) -> SessionState:
        """Run the session to completion asynchronously."""
        session = self._load_or_fail(session_id)
        while session.status not in (STATUS_COMPLETED, STATUS_FAILED):
            session = await self.run_once(session.session_id)
            if self.cycle_wait_seconds > 0 and session.status not in (
                STATUS_COMPLETED,
                STATUS_FAILED,
            ):
                await asyncio.sleep(self.cycle_wait_seconds)
        return session

    async def run_once(self, session_id: str) -> SessionState:
        session = self._load_or_fail(session_id)
        if session.status in (STATUS_COMPLETED, STATUS_FAILED):
            return session

        if session.cycle_count >= session.max_cycles:
            return self._handle_max_cycles(session)

        session.status = STATUS_RUNNING
        session.updated_at = utc_now()
        self.store.save_session(session)

        cycle_index = session.cycle_count + 1
        started_at = utc_now()
        workspace = self.store.layout.session_dir(session.session_id)
        
        logger.info(f"[Orchestrator] Session {session.session_id} - Starting Cycle #{cycle_index}")
        logger.debug(f"[Orchestrator] Workspace: {workspace}")
        logger.debug(f"[Orchestrator] Task objective: {session.task.objective[:100]}...")
        
        # Emit cycle start event
        await self._emit(EventType.CYCLE_START, {
            "cycle_index": cycle_index,
            "max_cycles": session.max_cycles,
            "objective": session.task.objective[:100],
        })
        
        # 1. CLEANUP STALE OUTPUT
        output_file = workspace / "__output.json"
        if output_file.exists():
            try:
                output_file.unlink()
            except OSError:
                pass # best effort

        try:
            logger.info(f"[Orchestrator] Session {session.session_id} - Calling Worker...")
            
            # Build user prompt (moved from Worker)
            prompt = self._build_user_prompt(session.worker_config, session.task, session.input_payload, workspace)
            
            # Determine if we should resume (use SDK session from previous cycle)
            resume_sdk_session_id = None
            if session.last_result and session.last_result.sdk_session_id:
                resume_sdk_session_id = session.last_result.sdk_session_id
                logger.info(f"[Orchestrator] Session {session.session_id} - Will resume SDK session: {resume_sdk_session_id}")
            
            # Worker will emit WORKER_START with exact SDK parameters
            # Pass event emitter to worker for tool call events
            llm_result = await self.worker.run_async(
                session.worker_config, prompt, workspace,
                event_callback=self._emit if self.event_manager else None,
                resume_sdk_session_id=resume_sdk_session_id,
            )
            
            # Compute summary and artifacts from LLMResult
            summary = llm_result.text.splitlines()[0] if llm_result.text else "no text output"
            artifacts = []
            
            logger.info(f"[Orchestrator] Session {session.session_id} - Worker returned: summary={summary[:80]}...")
            
            # Emit worker complete event with full output
            await self._emit(EventType.WORKER_COMPLETE, {
                "cycle_index": cycle_index,
                "text": llm_result.text,
                "tool_calls": llm_result.tool_calls,
                "summary": summary,
                "error": llm_result.error,
            })
            
            # 2. INGEST & ARCHIVE
            if output_file.exists():
                logger.info(f"[Orchestrator] Session {session.session_id} - Found __output.json, ingesting...")
                try:
                    content = output_file.read_text(encoding="utf-8")
                    # Try standard JSON parsing first
                    try:
                        data = json.loads(content)
                    except json.JSONDecodeError as parse_err:
                        # Fallback: use json-repair to fix malformed JSON
                        # (e.g., unescaped quotes in LLM-generated content)
                        logger.warning(f"[Orchestrator] Session {session.session_id} - JSON parse failed, attempting repair: {parse_err}")
                        try:
                            from json_repair import repair_json
                            repaired = repair_json(content)
                            data = json.loads(repaired)
                            logger.info(f"[Orchestrator] Session {session.session_id} - JSON repair successful")
                        except Exception as repair_err:
                            logger.error(f"[Orchestrator] Session {session.session_id} - JSON repair also failed: {repair_err}")
                            raise parse_err  # Re-raise original error
                    logger.debug(f"[Orchestrator] __output.json keys: {list(data.keys())}")
                    
                    # Override LLMResult text with structured output from __output.json
                    llm_result.text = json.dumps(data)
                    
                    # If 'files' are present, register them as artifacts
                    # so they show up in UI or logs
                    files_list = data.get("files")
                    if isinstance(files_list, list) and files_list:
                        for f in files_list:
                             if isinstance(f, str):
                                artifacts.append(f)

                    summary += " [Output from __output.json]"
                    
                    # Archive
                    archive_name = f"__output_cycle_{cycle_index:04d}.json"
                    archive_path = workspace / archive_name
                    shutil.copy(output_file, archive_path)
                    artifacts.append(archive_name)
                    
                except Exception as e:
                    # If we can't read/parse, we just log it but don't crash
                    logger.error(f"[Orchestrator] Session {session.session_id} - Failed to process __output.json: {e}")
                    llm_result.error = f"Failed to process __output.json: {str(e)}"
            
        except Exception as exc:
            ended_at = utc_now()
            llm_result = LLMResult(
                text="",
                tool_calls=[],
                tool_results=[],
                sdk_session_id=None,
                usage=None,
                error=str(exc),
            )
            checker_result = CheckerResult(passed=False, reason="worker_exception")
            record = self._build_cycle_record(
                cycle_index,
                started_at,
                ended_at,
                session.input_payload,
                llm_result,
                checker_result,
                summary="worker exception",
            )
            session.history.append(record)
            session.cycle_count = cycle_index
            session.last_result = llm_result
            session.last_error = str(exc)
            session.status = STATUS_FAILED
            session.updated_at = utc_now()
            self.store.save_cycle(session.session_id, record)
            self.store.save_session(session)
            self.store.append_log(
                session.session_id, f"{session.updated_at} failed worker_exception"
            )
            return session
        ended_at = utc_now()

        logger.info(f"[Orchestrator] Session {session.session_id} - Calling Checker Worker...")
        
        # Build checker prompt using new method
        checker_prompt = self._build_checker_prompt(session.task, llm_result)
        
        # Get checker worker config (uses 'checker' worker ID)
        checker_config = self.checker_config or session.worker_config
        
        # Emit checker start event with full config
        await self._emit(EventType.CHECKER_START, {
            "cycle_index": cycle_index,
            "model": checker_config.model if checker_config else None,
            "max_turns": checker_config.max_turns if checker_config else None,
            "prompt_length": len(checker_prompt) if checker_prompt else 0,
            "prompt_preview": checker_prompt[:2000] if checker_prompt else None,
        })
        
        # Call Worker as Checker (no resume - always new session for Checker)
        checker_llm_result = await self.worker.run_async(
            checker_config, checker_prompt,
            workspace=self.store.layout.session_dir(session.session_id),
            event_callback=self._emit if self.event_manager else None,
            resume_sdk_session_id=None,  # Checker always new session
        )
        
        # Parse Worker output to CheckerResult
        checker_result = self._parse_checker_verdict(checker_llm_result)
        
        # Emit checker complete event with feedback
        await self._emit(EventType.CHECKER_COMPLETE, {
            "cycle_index": cycle_index,
            "passed": checker_result.passed,
            "reason": checker_result.reason,
            "next_input": checker_result.next_input,
        })
        
        logger.info(f"[Orchestrator] Session {session.session_id} - Checker result: passed={checker_result.passed}, reason={checker_result.reason}")
        record = self._build_cycle_record(
            cycle_index, started_at, ended_at, session.input_payload, llm_result, checker_result,
            summary=summary, artifacts=artifacts
        )
        session.history.append(record)
        session.cycle_count = cycle_index
        session.last_result = llm_result
        session.updated_at = utc_now()

        if checker_result.passed:
            session.status = STATUS_COMPLETED
        else:
            session.status = STATUS_RUNNING
            if checker_result.next_input is not None:
                session.input_payload = checker_result.next_input

        self.store.save_cycle(session.session_id, record)
        self.store.save_session(session)

        # Emit cycle end event
        await self._emit(EventType.CYCLE_END, {
            "cycle_index": cycle_index,
            "passed": checker_result.passed,
            "status": session.status,
        })

        if session.status == STATUS_COMPLETED:
            logger.info(f"[Orchestrator] Session {session.session_id} - COMPLETED after {cycle_index} cycles")
            self.store.append_log(session.session_id, f"{session.updated_at} completed")
        else:
            logger.info(f"[Orchestrator] Session {session.session_id} - Cycle #{cycle_index} FAILED, will retry...")
        return session

