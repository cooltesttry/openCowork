from __future__ import annotations

from dataclasses import dataclass
import json
import logging
from .models import CheckerResult, TaskDefinition, LLMResult, WorkerConfig

logger = logging.getLogger(__name__)


class Checker:
    async def check(
        self, task: TaskDefinition, result: LLMResult, cycle_index: int
    ) -> CheckerResult:
        raise NotImplementedError


class BasicChecker(Checker):
    async def check(
        self, task: TaskDefinition, result: LLMResult, cycle_index: int
    ) -> CheckerResult:
        passed = result.error is None
        if passed:
            return CheckerResult(passed=True, reason="no_error")
        next_input = {"previous_error": result.error, "objective": task.objective}
        return CheckerResult(passed=False, reason="has_error", next_input=next_input)


class ReflectiveChecker(Checker):
    def __init__(self, config: WorkerConfig):
        # We use a WorkerConfig to define how the Judge operates (model, api_key, etc.)
        self.config = config

    async def check(
        self, task: TaskDefinition, result: LLMResult, cycle_index: int,
        event_callback=None
    ) -> CheckerResult:
        import json
        from claude_agent_sdk import (
            AssistantMessage,
            ClaudeAgentOptions,
            ClaudeSDKClient,
            ResultMessage,
            SystemMessage,
            TextBlock,
            ToolResultBlock,
            ToolUseBlock,
            UserMessage,
        )
        from .events import EventType

        # 1. Construct the Judge's Prompt
        # We strictly separate context: The Judge only sees the Task and the Result.
        prompt = self._build_judge_prompt(task, result)

        # 2. Configure the Judge's environment
        options = self._build_options(self.config)
        
        # 3. Call LLM
        response_text = ""
        try:
            logger.info(f"[Checker] Calling LLM Judge for cycle {cycle_index}")
            logger.debug(f"[Checker] Judge prompt length: {len(prompt)} chars")
            logger.debug(f"[Checker] ===== FULL JUDGE PROMPT START =====")
            logger.debug(f"[Checker] {prompt}")
            logger.debug(f"[Checker] ===== FULL JUDGE PROMPT END =====")
            
            async with ClaudeSDKClient(options=options) as client:
                logger.info(f"[Checker] Connected to SDK, sending Judge query...")
                # We use a single-turn query for the Judge
                await client.query(prompt)
                logger.info(f"[Checker] Waiting for Judge response stream...")
                
                async for msg in client.receive_messages():
                    # Log message type for debugging
                    msg_type = type(msg).__name__
                    logger.debug(f"[Checker] Received message: {msg_type}")
                    
                    # Handle AssistantMessage (text and tool calls)
                    if isinstance(msg, AssistantMessage):
                        for block in msg.content:
                            if isinstance(block, TextBlock):
                                chunk = block.text
                                response_text += chunk
                                logger.info(f"[Checker] Stream chunk ({len(chunk)} chars): {chunk[:100]}...")
                                if event_callback:
                                    await event_callback(EventType.CHECKER_STREAM, {
                                        "chunk": chunk[:200],
                                        "total_length": len(response_text),
                                    })
                            elif isinstance(block, ToolUseBlock):
                                logger.info(f"[Checker] Tool call: {block.name}")
                                if event_callback:
                                    input_preview = {}
                                    for k, v in (block.input or {}).items():
                                        if isinstance(v, str) and len(v) > 500:
                                            input_preview[k] = v[:500] + "..."
                                        else:
                                            input_preview[k] = v
                                    await event_callback(EventType.WORKER_TOOL_CALL, {
                                        "tool_name": block.name,
                                        "tool_id": block.id,
                                        "input": input_preview,
                                        "source": "checker",
                                    })
                    
                    # Handle UserMessage (tool results)
                    elif isinstance(msg, UserMessage):
                        for block in msg.content:
                            if isinstance(block, ToolResultBlock):
                                logger.info(f"[Checker] Tool result for: {block.tool_use_id}")
                                if event_callback:
                                    content_preview = block.content
                                    if isinstance(content_preview, str) and len(content_preview) > 1000:
                                        content_preview = content_preview[:1000] + "..."
                                    await event_callback(EventType.WORKER_TOOL_RESULT, {
                                        "tool_id": block.tool_use_id,
                                        "content": content_preview,
                                        "is_error": getattr(block, "is_error", False),
                                        "source": "checker",
                                    })
                    
                    elif isinstance(msg, ResultMessage):
                        break
                
                logger.info(f"[Checker] Judge response complete. Total length: {len(response_text)} chars")
                logger.debug(f"[Checker] ===== FULL JUDGE RESPONSE START =====")
                logger.debug(f"[Checker] {response_text}")
                logger.debug(f"[Checker] ===== FULL JUDGE RESPONSE END =====")
                
        except Exception as e:
            # Fallback if Judge fails: Assume Pass but warn? Or Fail?
            # For safety, we fail if we can't judge.
            logger.error(f"[Checker] Judge LLM call failed: {e}")
            import traceback
            logger.error(f"[Checker] Traceback: {traceback.format_exc()}")
            return CheckerResult(
                passed=False, 
                reason=f"judge_error: {str(e)}",
                next_input={"error_feedback": "The automated judge failed to evaluate your work. Please review it manually constraints."}
            )

        # 4. Parse JSON Output
        try:
            # Look for JSON block ```json ... ``` or raw JSON
            cleaned_json = self._extract_json(response_text)
            data = json.loads(cleaned_json)
            
            # New format: verdict (failed/needs_improvement/passed)
            verdict = data.get("verdict", "").lower()
            reason = data.get("reason", "No reason provided.")
            feedback = data.get("feedback", "")
            verified = data.get("verified", [])
            
            # Fallback for old format
            if not verdict and "passed" in data:
                verdict = "passed" if data.get("passed") else "failed"
            
            logger.info(f"[Checker] Judge verdict: {verdict}, reason: {reason[:100]}")
            logger.debug(f"[Checker] Judge feedback: {feedback[:150] if feedback else 'None'}...")
            logger.debug(f"[Checker] Verified items: {verified}")
            
            if verdict == "passed":
                return CheckerResult(passed=True, reason=f"verified_passed: {reason}")
            else:
                # Both "failed" and "needs_improvement" trigger retry
                return CheckerResult(
                    passed=False,
                    reason=f"{verdict}: {reason}",
                    next_input={
                        "review_verdict": verdict,
                        "review_feedback": feedback,
                        "review_reason": reason,
                        "verified_items": verified,
                        "previous_attempt_summary": result.summary
                    }
                )

        except Exception:
            # Parsing failed
            logger.error(f"[Checker] Failed to parse Judge response: {response_text[:200]}...")
            return CheckerResult(
                passed=False,
                reason="judge_parsing_error",
                next_input={"review_feedback": f"Reviewer output was malformed: {response_text[:200]}..."}
            )

    def _build_judge_prompt(self, task: TaskDefinition, result: LLMResult) -> str:
        # Extract output from LLMResult text
        # If __output.json was used, result.text contains the JSON string
        # Try to parse it, otherwise use raw text
        output_data = result.text
        
        try:
            parsed = json.loads(result.text)
            if isinstance(parsed, dict):
                # If it's structured output from __output.json
                output_data = json.dumps(parsed, indent=2, ensure_ascii=False)
        except (json.JSONDecodeError, TypeError):
            output_data = result.text
        
        summary = result.text.splitlines()[0] if result.text else "no output"
        
        return f"""You are an expert QA Auditor. Your job is to INDEPENDENTLY VERIFY the work submitted by an autonomous Worker.

⚠️ CRITICAL: Do NOT blindly trust the Worker's self-report. You MUST verify all claims using available tools.

# Task Objective
{task.objective}

# Expected Outcome (if specified)
{json.dumps(task.expected_output, indent=2) if task.expected_output else "Not specified - use your judgment based on the objective."}

# Worker's Claimed Output
Summary: {summary}
Output: {output_data}
Error reported: {result.error or "None"}

---

# Verification Protocol

## Step 1: Identify Claimed Deliverables
What did the Worker claim to deliver? (files, code, text, research, etc.)

## Step 2: VERIFY Each Deliverable
⚠️ You MUST use tools to verify:
- **Files**: Use `Read` tool to read and verify file contents match the objective.
- **Code**: Read the code, check syntax, logic, and completeness.
- **Documents/Text**: Read and evaluate quality, accuracy, and completeness.
- **Data**: Verify data integrity and correctness.

Do NOT skip verification. Do NOT assume the Worker's report is accurate.

## Step 3: Render Verdict
After verification, respond with ONLY valid JSON (no markdown code blocks):

{{
  "verdict": "failed" | "needs_improvement" | "passed",
  "reason": "Brief explanation of your verdict",
  "feedback": "Specific, actionable instructions for what to fix or improve. Leave empty if passed.",
  "verified": ["List what you actually verified with tools"]
}}

### Verdict Definitions:
- **failed**: Task not completed, major errors, or Worker's claims don't match reality. Worker should retry.
- **needs_improvement**: Core task done but quality/completeness can be improved. Provide specific improvements needed.
- **passed**: Task fully completed, verified, and ready to deliver. No further work needed.
"""

    def _extract_json(self, text: str) -> str:
        import re
        # Try to find ```json ... ```
        match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
        if match:
            return match.group(1)
        # Try to find { ... }
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return match.group(0)
        return text

    @staticmethod
    def _build_options(config: WorkerConfig) -> "ClaudeAgentOptions":
        # Re-use the worker's _build_env helper for consistent configuration
        from claude_agent_sdk import ClaudeAgentOptions
        from .worker import _build_env
        
        env = _build_env(config)
        
        options = ClaudeAgentOptions(
            model=config.model,
            max_turns=10,  # Allow multiple turns for tool verification
            env=env,
            setting_sources=[],  # Don't load any settings files
        )
        options.permission_mode = "bypassPermissions"
        return options
