from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid as uuid_mod
from pathlib import Path
from typing import Optional

from .models import WorkerConfig, LLMResult, utc_now
from typing import Callable, Any

logger = logging.getLogger(__name__)

# Type alias for event callback
EventCallback = Callable[[Any, dict], None]


async def _graceful_close_client(client, timeout_seconds: float = 5.0) -> None:
    """Gracefully close ClaudeSDKClient, allowing session data to persist for resume.

    Sends EOF via end_input(), waits for process to exit naturally,
    then calls disconnect() for final cleanup.
    """
    if not client:
        return

    try:
        query = getattr(client, '_query', None)
        transport = getattr(query, 'transport', None) if query else None

        if transport and hasattr(transport, 'end_input'):
            # Step 1: Send EOF to stdin — process can finish naturally
            await transport.end_input()
            logger.debug("[Worker] Sent EOF to SDK process")

            # Step 2: Wait for process to exit naturally (with timeout)
            process = getattr(transport, '_process', None)
            if process and process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
                    logger.debug(f"[Worker] SDK process exited naturally (code={process.returncode})")
                except asyncio.TimeoutError:
                    logger.warning(f"[Worker] SDK process did not exit within {timeout_seconds}s, will terminate")
    except Exception as e:
        logger.warning(f"[Worker] Error during graceful close: {e}")

    # Step 3: Standard disconnect for final cleanup
    # If process already exited, transport.close() will just clean up references.
    # If process didn't exit (timeout), transport.close() will terminate it.
    try:
        await client.disconnect()
    except Exception as e:
        logger.warning(f"[Worker] Error during final disconnect: {e}")


class Worker:
    async def connect(self, config: WorkerConfig, workspace: Optional[Path] = None):
        """Optional: create a persistent client for reuse across multiple run_async calls."""
        pass  # Default no-op, subclasses can override

    async def disconnect(self):
        """Optional: close the persistent client."""
        pass  # Default no-op, subclasses can override

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self.disconnect()

    async def run_async(
        self,
        config: WorkerConfig,
        prompt: str,
        workspace: Optional[Path] = None,
        event_callback: Optional[EventCallback] = None,
        resume_sdk_session_id: Optional[str] = None,
    ) -> LLMResult:
        """Run worker with the given prompt.

        Args:
            resume_sdk_session_id: If provided, resume from this SDK session
        """
        raise NotImplementedError


class StubWorker(Worker):
    async def run_async(
        self,
        config: WorkerConfig,
        prompt: str,
        workspace: Optional[Path] = None,
        event_callback: Optional[EventCallback] = None,
        resume_sdk_session_id: Optional[str] = None,
    ) -> LLMResult:
        """Stub worker that returns a mock LLMResult for testing."""
        # Simulate resume by returning same session ID if provided
        session_id = resume_sdk_session_id or f"stub-session-{utc_now()}"
        return LLMResult(
            text=f"Stub response for prompt: {prompt[:100]}...\nTimestamp: {utc_now()}",
            tool_calls=[],
            tool_results=[],
            sdk_session_id=session_id,
            usage=None,
            error=None,
        )


class ClaudeSdkWorker(Worker):
    def __init__(self):
        self._client = None  # Optional persistent ClaudeSDKClient
        self._block_state = {}  # Track content block state across stream events

    async def connect(self, config: WorkerConfig, workspace: Optional[Path] = None):
        """Create a persistent SDK client for reuse across multiple run_async calls."""
        from claude_agent_sdk import ClaudeSDKClient

        options = self._build_options(config, workspace)
        self._client = ClaudeSDKClient(options=options)
        await self._client.__aenter__()
        logger.info("[Worker] Persistent client connected")

    async def disconnect(self):
        """Close the persistent SDK client gracefully for session resume."""
        if self._client:
            timeout = float(os.environ.get('CLAUDE_SDK_GRACEFUL_CLOSE_TIMEOUT', '5'))
            await _graceful_close_client(self._client, timeout)
            self._client = None
            logger.info("[Worker] Persistent client disconnected")

    async def run_async(
        self,
        config: WorkerConfig,
        prompt: str,
        workspace: Optional[Path] = None,
        event_callback: Optional[EventCallback] = None,
        resume_sdk_session_id: Optional[str] = None,
    ) -> LLMResult:
        """Run worker with the given prompt.

        If a persistent client exists (via connect()), reuses it.
        Otherwise falls back to creating a new client per call (backward compatible).

        Args:
            config: Worker configuration (model, provider, system_prompt, etc.)
            prompt: The user prompt to send (already built by caller)
            workspace: Working directory
            event_callback: Optional callback for events
            resume_sdk_session_id: If provided, resume from this SDK session (only used in fallback mode)
        """
        # Replace placeholders in prompt
        final_prompt = self._replace_placeholders(prompt, config, workspace)

        if self._client:
            # Reuse persistent client
            return await self._run_on_client(self._client, final_prompt, event_callback)
        else:
            # Fallback: create a new client per call (backward compatible)
            return await self._run_new_client(
                config, final_prompt, workspace, event_callback, resume_sdk_session_id
            )

    async def _run_on_client(
        self,
        client,
        final_prompt: str,
        event_callback: Optional[EventCallback] = None,
    ) -> LLMResult:
        """Run a query on an existing persistent client."""
        from claude_agent_sdk import ResultMessage

        logger.info(f"[Worker] Reusing persistent client, sending query (length={len(final_prompt)} chars)")
        logger.debug(f"[Worker] Query prompt: {final_prompt[:200]}...")

        # Emit worker_start event
        if event_callback:
            from .events import EventType
            await event_callback(EventType.WORKER_START, {
                "user_prompt": final_prompt,
                "persistent_client": True,
            })

        await client.query(final_prompt)

        text_parts, tool_calls, tool_results = [], [], []
        sdk_session_id = None
        usage = None
        error_text = None

        async for msg in client.receive_response():
            sdk_session_id, usage, msg_error = await self._process_message(
                msg, text_parts, tool_calls, tool_results,
                sdk_session_id, event_callback,
            )
            if msg_error:
                error_text = msg_error
            if isinstance(msg, ResultMessage):
                break

        text = "".join(text_parts).strip()
        logger.info(f"[Worker] Completed (persistent): {len(tool_calls)} tool calls, {len(text)} chars output")

        return LLMResult(
            text=text,
            tool_calls=tool_calls,
            tool_results=tool_results,
            sdk_session_id=sdk_session_id,
            usage=usage,
            error=error_text,
        )

    async def _run_new_client(
        self,
        config: WorkerConfig,
        final_prompt: str,
        workspace: Optional[Path] = None,
        event_callback: Optional[EventCallback] = None,
        resume_sdk_session_id: Optional[str] = None,
    ) -> LLMResult:
        """Run with a new client per call (original behavior, backward compatible)."""
        from claude_agent_sdk import ClaudeSDKClient, ResultMessage

        options = self._build_options(config, workspace)

        # Enable resume if session ID provided
        if resume_sdk_session_id:
            options.resume = resume_sdk_session_id
            options.system_prompt = None
            logger.info(f"[Worker] Resuming SDK session: {resume_sdk_session_id}")

        sdk_session_id = resume_sdk_session_id
        text_parts: list[str] = []
        tool_calls: list[dict] = []
        tool_results: list[dict] = []
        usage = None
        error_text = None

        # Emit worker_start event
        if event_callback:
            from .events import EventType
            await event_callback(EventType.WORKER_START, {
                "system_prompt": getattr(options, 'system_prompt', None),
                "user_prompt": final_prompt,
                "model": getattr(options, 'model', None),
                "max_turns": getattr(options, 'max_turns', None),
                "permission_mode": getattr(options, 'permission_mode', None),
                "cwd": getattr(options, 'cwd', None),
                "resume": resume_sdk_session_id,
            })

        client = ClaudeSDKClient(options=options)
        await client.__aenter__()
        try:
            logger.info(f"[Worker] Connected to SDK, sending query (length={len(final_prompt)} chars, resume={resume_sdk_session_id is not None})")
            logger.debug(f"[Worker] Query prompt: {final_prompt[:200]}...")
            await client.query(final_prompt)

            async for msg in client.receive_messages():
                sdk_session_id, usage, msg_error = await self._process_message(
                    msg, text_parts, tool_calls, tool_results,
                    sdk_session_id, event_callback,
                )
                if msg_error:
                    error_text = msg_error
                if isinstance(msg, ResultMessage):
                    break
        finally:
            timeout = float(os.environ.get('CLAUDE_SDK_GRACEFUL_CLOSE_TIMEOUT', '5'))
            await _graceful_close_client(client, timeout)

        text = "".join(text_parts).strip()
        logger.info(f"[Worker] Completed: {len(tool_calls)} tool calls, {len(text)} chars output")
        logger.debug(f"[Worker] Output preview: {text[:100]}...")

        return LLMResult(
            text=text,
            tool_calls=tool_calls,
            tool_results=tool_results,
            sdk_session_id=sdk_session_id,
            usage=usage,
            error=error_text,
        )

    async def _process_message(
        self, msg, text_parts, tool_calls, tool_results,
        sdk_session_id, event_callback,
    ):
        """Process a single SDK message. Returns (sdk_session_id, usage, error_text)."""
        from claude_agent_sdk import (
            AssistantMessage,
            ResultMessage,
            SystemMessage,
            TextBlock,
            ToolResultBlock,
            ToolUseBlock,
            UserMessage,
        )
        from claude_agent_sdk.types import StreamEvent

        usage = None
        error_text = None

        if isinstance(msg, StreamEvent):
            if event_callback:
                await self._process_stream_event(msg, event_callback)
            return sdk_session_id, usage, error_text

        if isinstance(msg, SystemMessage):
            if getattr(msg, "subtype", None) == "init":
                data = getattr(msg, "data", {})
                if isinstance(data, dict):
                    sdk_session_id = data.get("session_id", sdk_session_id)

        elif isinstance(msg, AssistantMessage):
            if event_callback:
                from .events import EventType
                model = getattr(msg, 'model', None)
                if model:
                    await event_callback(EventType.WORKER_STREAM, {
                        "stream_type": "model_info",
                        "model": model,
                    })
            for block in msg.content:
                if isinstance(block, TextBlock):
                    text_parts.append(block.text)
                elif isinstance(block, ToolUseBlock):
                    logger.info(f"[Worker] Tool call: {block.name}")
                    tool_calls.append({
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    if event_callback:
                        from .events import EventType
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
                        })

        elif isinstance(msg, UserMessage):
            for block in msg.content:
                if isinstance(block, ToolResultBlock):
                    tool_results.append({
                        "tool_use_id": block.tool_use_id,
                        "content": block.content,
                        "is_error": getattr(block, "is_error", False),
                    })
                    if event_callback:
                        from .events import EventType
                        content_preview = block.content
                        if isinstance(content_preview, str) and len(content_preview) > 1000:
                            content_preview = content_preview[:1000] + "..."
                        await event_callback(EventType.WORKER_TOOL_RESULT, {
                            "tool_id": block.tool_use_id,
                            "content": content_preview,
                            "is_error": getattr(block, "is_error", False),
                        })

        elif isinstance(msg, ResultMessage):
            usage = getattr(msg, "usage", None)
            # Extract session_id from ResultMessage if available
            result_session = getattr(msg, "session_id", None)
            if result_session:
                sdk_session_id = result_session
            # Capture error state
            if getattr(msg, "is_error", False):
                error_text = getattr(msg, "result", None) or "SDK session ended with error"

        return sdk_session_id, usage, error_text

    async def _process_stream_event(self, sdk_event, event_callback):
        """Process an SDK StreamEvent and emit WORKER_STREAM events."""
        from .events import EventType

        raw_event = sdk_event.event
        event_type = raw_event.get("type")

        if event_type == "content_block_start":
            index = raw_event.get("index", 0)
            content_block = raw_event.get("content_block", {})
            block_type = content_block.get("type")

            if block_type == "text":
                block_id = f"text_{uuid_mod.uuid4().hex[:8]}_{index}"
                self._block_state[index] = {"type": "text", "id": block_id}
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "text_start",
                    "block_id": block_id,
                    "content": "",
                })
            elif block_type == "tool_use":
                tool_id = content_block.get("id", f"tool_{index}")
                tool_name = content_block.get("name", "unknown")
                self._block_state[index] = {
                    "type": "tool_input",
                    "id": tool_id,
                    "name": tool_name,
                }
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "tool_input_start",
                    "block_id": tool_id,
                    "tool_name": tool_name,
                    "content": "",
                })
            elif block_type == "thinking":
                block_id = f"thinking_{uuid_mod.uuid4().hex[:8]}_{index}"
                self._block_state[index] = {"type": "thinking", "id": block_id}
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "thinking_start",
                    "block_id": block_id,
                    "content": "",
                })

        elif event_type == "content_block_delta":
            index = raw_event.get("index", 0)
            delta = raw_event.get("delta", {})
            delta_type = delta.get("type")
            block = self._block_state.get(index)
            if not block:
                return

            if delta_type == "text_delta" and block["type"] == "text":
                text = delta.get("text", "")
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "text_delta",
                    "block_id": block["id"],
                    "content": text,
                })
            elif delta_type == "thinking_delta" and block["type"] == "thinking":
                text = delta.get("thinking", "")
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "thinking_delta",
                    "block_id": block["id"],
                    "content": text,
                })
            elif delta_type == "input_json_delta" and block["type"] == "tool_input":
                partial = delta.get("partial_json", "")
                await event_callback(EventType.WORKER_STREAM, {
                    "stream_type": "tool_input_delta",
                    "block_id": block["id"],
                    "content": partial,
                })

        elif event_type == "content_block_stop":
            index = raw_event.get("index", 0)
            block = self._block_state.pop(index, None)
            if block:
                suffix = {"text": "text_end", "thinking": "thinking_end", "tool_input": "tool_input_end"}
                stream_type = suffix.get(block["type"])
                if stream_type:
                    await event_callback(EventType.WORKER_STREAM, {
                        "stream_type": stream_type,
                        "block_id": block["id"],
                        "content": "",
                    })

    @staticmethod
    def _build_options(
        config: WorkerConfig, workspace: Optional[Path]
    ) -> "ClaudeAgentOptions":
        """Build SDK options. System prompt comes entirely from config."""
        from claude_agent_sdk import ClaudeAgentOptions

        mcp_servers = _normalize_mcp_servers(config.mcp_servers)
        permission_mode = config.permission_mode or "bypassPermissions"
        allowed_tools = None
        if permission_mode != "default":
            allowed_tools = config.tools_allow or None

        options = ClaudeAgentOptions(
            model=config.model,
            system_prompt=config.prompt.get("system"),  # 100% from config
            allowed_tools=allowed_tools,
            disallowed_tools=config.tools_block or None,
            max_turns=config.max_turns,
            include_partial_messages=config.include_partial_messages,
        )

        options.permission_mode = permission_mode
        if mcp_servers:
            options.mcp_servers = mcp_servers
        env = _build_env(config)
        if env:
            options.env = env
        if config.cwd:
            options.cwd = config.cwd
        elif workspace is not None:
            options.cwd = str(workspace)
        if config.setting_sources:
            options.setting_sources = list(config.setting_sources)
        else:
            options.setting_sources = ["project"]
        if config.output_format:
            if isinstance(config.output_format, dict):
                options.output_format = dict(config.output_format)
            else:
                raise ValueError("output_format must be an object")
        return options

    @staticmethod
    def _replace_placeholders(prompt: str, config: WorkerConfig, workspace: Optional[Path]) -> str:
        """Replace placeholders in prompt with actual values.
        
        Supported placeholders:
            {{TIME}} -> current UTC time (YYYY-MM-DD HH:MM UTC)
            {{CWD}} -> current working directory
        """
        from datetime import datetime, timezone
        
        cwd = config.cwd or (str(workspace) if workspace else "")
        current_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        
        result = prompt
        result = result.replace("{{TIME}}", current_time)
        result = result.replace("{{CWD}}", cwd)
        
        return result




def _normalize_mcp_servers(value: object) -> dict:
    if isinstance(value, dict):
        return value
    if not isinstance(value, list):
        return {}
    servers: dict = {}
    for item in value:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not name:
            continue
        server = dict(item)
        server.pop("name", None)
        servers[name] = server
    return servers


def _build_env(config: WorkerConfig) -> dict:
    env: dict[str, str] = {}

    endpoint = (config.endpoint or "").rstrip("/")
    if endpoint.endswith("/v1"):
        endpoint = endpoint[:-3]

    if endpoint:
        env["ANTHROPIC_BASE_URL"] = endpoint
    elif config.provider == "openrouter":
        env["ANTHROPIC_BASE_URL"] = "https://openrouter.ai/api"
        if config.api_key:
            env["ANTHROPIC_AUTH_TOKEN"] = config.api_key
        env["ANTHROPIC_API_KEY"] = ""
    elif config.provider == "local":
        env["ANTHROPIC_BASE_URL"] = "http://localhost:1234/v1"

    if config.provider != "openrouter":
        if config.api_key:
            env["ANTHROPIC_API_KEY"] = config.api_key
        elif config.provider == "local" and "ANTHROPIC_API_KEY" not in env:
            env["ANTHROPIC_API_KEY"] = "sk-dummy-key"

    if config.max_tokens > 0:
        env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(config.max_tokens)
    if config.max_thinking_tokens > 0:
        env["MAX_THINKING_TOKENS"] = str(config.max_thinking_tokens)

    # Keep Bash pre-flight model aligned for custom providers/endpoints.
    if config.model and (endpoint or config.provider in ("openrouter", "local", "openai")):
        env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = config.model
        env["ANTHROPIC_SMALL_FAST_MODEL"] = config.model

    if config.env:
        env.update(config.env)
    return env
