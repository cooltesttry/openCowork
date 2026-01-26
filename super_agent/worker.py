from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from .models import WorkerConfig, LLMResult, utc_now
from typing import Callable, Any

logger = logging.getLogger(__name__)

# Type alias for event callback
EventCallback = Callable[[Any, dict], None]


class Worker:
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
            config: Worker configuration (model, provider, system_prompt, etc.)
            prompt: The user prompt to send (already built by caller)
            workspace: Working directory
            event_callback: Optional callback for events
        
        The prompt will have placeholders replaced:
            {{TIME}} -> current UTC time
            {{CWD}} -> current working directory
        """
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

        options = self._build_options(config, workspace)
        
        # Enable resume if session ID provided
        if resume_sdk_session_id:
            options.resume = resume_sdk_session_id
            logger.info(f"[Worker] Resuming SDK session: {resume_sdk_session_id}")
        
        # Replace placeholders in prompt
        final_prompt = self._replace_placeholders(prompt, config, workspace)

        text_parts: list[str] = []
        tool_calls: list[dict] = []
        tool_results: list[dict] = []
        sdk_session_id = resume_sdk_session_id  # Keep same session ID on resume
        usage = None

        # Emit worker_start event with EXACT SDK parameters before calling SDK
        if event_callback:
            from .events import EventType
            await event_callback(EventType.WORKER_START, {
                "system_prompt": getattr(options, 'system_prompt', None),
                "user_prompt": final_prompt,
                "model": getattr(options, 'model', None),
                "max_turns": getattr(options, 'max_turns', None),
                "permission_mode": getattr(options, 'permission_mode', None),
                "cwd": getattr(options, 'cwd', None),
                "resume": resume_sdk_session_id,  # Show resume status in event
            })

        async with ClaudeSDKClient(options=options) as client:
            logger.info(f"[Worker] Connected to SDK, sending query (length={len(final_prompt)} chars, resume={resume_sdk_session_id is not None})")
            logger.debug(f"[Worker] Query prompt: {final_prompt[:200]}...")
            await client.query(final_prompt)

            async for msg in client.receive_messages():
                if isinstance(msg, SystemMessage):
                    if getattr(msg, "subtype", None) == "init":
                        data = getattr(msg, "data", {})
                        if isinstance(data, dict):
                            sdk_session_id = data.get("session_id", sdk_session_id)

                elif isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            text_parts.append(block.text)
                        elif isinstance(block, ToolUseBlock):
                            logger.info(f"[Worker] Tool call: {block.name}")
                            tool_calls.append(
                                {
                                    "id": block.id,
                                    "name": block.name,
                                    "input": block.input,
                                }
                            )
                            # Emit tool call event with input
                            if event_callback:
                                from .events import EventType
                                # Truncate input for large values
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
                            tool_results.append(
                                {
                                    "tool_use_id": block.tool_use_id,
                                    "content": block.content,
                                    "is_error": getattr(block, "is_error", False),
                                }
                            )
                            # Emit tool result event
                            if event_callback:
                                from .events import EventType
                                # Truncate content for large results
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
                    break

        text = "".join(text_parts).strip()
        
        logger.info(f"[Worker] Completed: {len(tool_calls)} tool calls, {len(text)} chars output")
        logger.debug(f"[Worker] Output preview: {text[:100]}...")
        
        return LLMResult(
            text=text,
            tool_calls=tool_calls,
            tool_results=tool_results,
            sdk_session_id=sdk_session_id,
            usage=usage,
            error=None,
        )

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

    if config.env:
        env.update(config.env)
    return env
