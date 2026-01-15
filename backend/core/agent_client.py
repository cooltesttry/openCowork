"""
Claude Agent SDK wrapper for streaming interactions.
Supports both streaming (for user-facing) and blocking (for sub-agents) modes.
"""
import asyncio
import json
import logging
import sys
import os
from enum import Enum
from typing import Any, AsyncGenerator, Optional
from dataclasses import dataclass, field

from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    AssistantMessage,
    UserMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
    ToolResultBlock,
    tool,
    create_sdk_mcp_server,
)
from claude_agent_sdk.types import StreamEvent as SDKStreamEvent

from models.settings import AppSettings, MCPServerConfig
from core.search_tools import get_serper_tool, get_tavily_tool, get_brave_tool

import httpx

# Set up logging
logger = logging.getLogger(__name__)


class StreamEventType(str, Enum):
    """Event types for agent streaming."""
    # Lifecycle events
    START = "start"
    DONE = "done"
    ERROR = "error"
    
    # Legacy/aggregated events (backward compatible)
    THINKING = "thinking"
    TEXT = "text"
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    
    # Incremental text events
    TEXT_START = "text_start"
    TEXT_DELTA = "text_delta"
    TEXT_END = "text_end"
    
    # Incremental tool events
    TOOL_INPUT_START = "tool_input_start"
    TOOL_INPUT_DELTA = "tool_input_delta"
    TOOL_INPUT_END = "tool_input_end"
    
    # Incremental thinking events
    THINKING_START = "thinking_start"
    THINKING_DELTA = "thinking_delta"
    THINKING_END = "thinking_end"


@dataclass
class Usage:
    """Token usage statistics."""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    
    def to_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class StreamEvent:
    """Event emitted during agent streaming."""
    type: str  # StreamEventType value
    content: Any = None
    metadata: dict = field(default_factory=dict)
    id: Optional[str] = None
    usage: Optional[Usage] = None
    
    def to_dict(self) -> dict:
        result = {
            "type": self.type,
            "content": self.content,
            "metadata": self.metadata,
        }
        if self.id:
            result["id"] = self.id
        if self.usage:
            result["usage"] = self.usage.to_dict()
        return result
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict())


@dataclass
class AgentResponse:
    """Aggregated response for blocking invoke() calls."""
    text: str
    tool_calls: list[dict]
    events: list[StreamEvent]
    usage: Usage
    
    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "tool_calls": self.tool_calls,
            "events": [e.to_dict() for e in self.events],
            "usage": self.usage.to_dict(),
        }


def build_mcp_servers(configs: list[MCPServerConfig]) -> dict:
    """Build MCP server configuration dict from settings."""
    servers = {}
    for cfg in configs:
        if not cfg.enabled:
            continue
        if cfg.type == "stdio":
            servers[cfg.name] = {
                "type": "stdio",
                "command": cfg.command,
                "args": cfg.args,
                "env": cfg.env,
            }
        elif cfg.type == "sse":
            # Legacy SSE transport (GET /sse + POST /message)
            servers[cfg.name] = {
                "type": "sse",
                "url": cfg.url,
            }
        elif cfg.type == "http":
            # Streamable HTTP transport (unified POST /mcp endpoint)
            servers[cfg.name] = {
                "type": "http",
                "url": cfg.url,
            }
        # SDK type handled separately
    return servers


def build_agent_options(settings: AppSettings, streaming: bool = True) -> ClaudeAgentOptions:
    """Build ClaudeAgentOptions from app settings."""
    options = ClaudeAgentOptions(
        allowed_tools=settings.allowed_tools,
        disallowed_tools=['WebSearch', 'WebFetch'],  # Disable built-in search to use MCP search instead
        max_turns=settings.max_turns,
        include_partial_messages=streaming,  # Enable incremental events for streaming
        permission_mode='bypassPermissions',  # Auto-allow all tools including MCP tools
        system_prompt="You are a helpful AI assistant. Always format your responses in clean, structured Markdown. Use bold headings, bullet points, and tables where appropriate to present information clearly. When utilizing tools, briefly explain your actions to the user."
    )
    
    # Set model for ANY provider if specified
    if settings.model.model_name:
        options.model = settings.model.model_name
    
    # Configure Environment for Custom Endpoints
    env_vars = {}
    
    # Set Base URL if provided
    if settings.model.endpoint:
        # Strip /v1 suffix if present as SDK likely appends it or /v1/messages
        endpoint = settings.model.endpoint.rstrip("/")
        if endpoint.endswith("/v1"):
            endpoint = endpoint[:-3]
        env_vars["ANTHROPIC_BASE_URL"] = endpoint
    elif settings.model.provider == "local":
        # Default local endpoint if not explicitly set
        env_vars["ANTHROPIC_BASE_URL"] = "http://localhost:1234/v1"
        
    # Handle API Key
    if settings.model.api_key:
        env_vars["ANTHROPIC_API_KEY"] = settings.model.api_key
    elif settings.model.provider == "local":
        # Local providers often need a dummy key if none provided
        env_vars["ANTHROPIC_API_KEY"] = "sk-dummy-key"
    
    # Token limits - only set if > 0
    if settings.model.max_tokens > 0:
        env_vars["CLAUDE_CODE_MAX_OUTPUT_TOKENS"] = str(settings.model.max_tokens)
    if settings.model.max_thinking_tokens > 0:
        env_vars["MAX_THINKING_TOKENS"] = str(settings.model.max_thinking_tokens)
        
    if env_vars:
        options.env = env_vars
    
    # Set MCP servers
    mcp_servers = build_mcp_servers(settings.mcp_servers)
    
    # Configure Search Tool via Stdio MCP Server
    if settings.search.enabled and settings.search.provider in ["serper", "tavily", "brave"] and settings.search.api_key:
        server_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_search_server.py")
        
        # Add Stdio MCP Server configuration
        mcp_servers["search-tools"] = {
            "command": sys.executable,
            "args": [server_script],
            "env": {
                **os.environ,
                "PYTHONUNBUFFERED": "1" # Ensure output is flushed
            }
        }
        
        # Add tool to allowed_tools to prevent permission errors
        # SDK namespaces MCP tools as mcp__{server_name}__{tool_name}
        tool_simple_name = f"{settings.search.provider}_search"
        full_tool_name = f"mcp__search-tools__{tool_simple_name}"
        
        if options.allowed_tools:
            options.allowed_tools.append(full_tool_name)
        else:
            options.allowed_tools = [full_tool_name]

    if mcp_servers:
        options.mcp_servers = mcp_servers
    
    # Set default working directory if configured
    if settings.default_workdir:
        options.cwd = settings.default_workdir
        
    return options


def _process_stream_event(sdk_event: SDKStreamEvent, block_state: dict) -> list[StreamEvent]:
    """Process SDK StreamEvent and return our StreamEvents."""
    events = []
    raw_event = sdk_event.event
    event_type = raw_event.get("type")
    
    if event_type == "message_start":
        events.append(StreamEvent(type=StreamEventType.START.value))
        
    elif event_type == "content_block_start":
        index = raw_event.get("index", 0)
        content_block = raw_event.get("content_block", {})
        block_type = content_block.get("type")
        
        if block_type == "text":
            block_id = f"text_{sdk_event.uuid}_{index}"
            block_state[index] = {"type": "text", "id": block_id, "content": ""}
            events.append(StreamEvent(
                type=StreamEventType.TEXT_START.value,
                id=block_id,
            ))
        elif block_type == "tool_use":
            tool_id = content_block.get("id", f"tool_{index}")
            tool_name = content_block.get("name", "unknown")
            block_state[index] = {
                "type": "tool",
                "id": tool_id,
                "name": tool_name,
                "input_buffer": ""
            }
            events.append(StreamEvent(
                type=StreamEventType.TOOL_INPUT_START.value,
                id=tool_id,
                content={"name": tool_name},
            ))
        elif block_type == "thinking":
            block_id = f"thinking_{index}"
            block_state[index] = {"type": "thinking", "id": block_id, "content": ""}
            logger.info(f"🧠 THINKING_START: Thinking block started (index={index}, id={block_id})")
            events.append(StreamEvent(
                type=StreamEventType.THINKING_START.value,
                id=block_id,
            ))
            
    elif event_type == "content_block_delta":
        index = raw_event.get("index", 0)
        delta = raw_event.get("delta", {})
        delta_type = delta.get("type")
        
        block = block_state.get(index)
        if not block:
            return events
            
        if delta_type == "text_delta" and block["type"] == "text":
            text = delta.get("text", "")
            block["content"] += text
            events.append(StreamEvent(
                type=StreamEventType.TEXT_DELTA.value,
                id=block["id"],
                content=text,
            ))
        elif delta_type == "thinking_delta" and block["type"] == "thinking":
            text = delta.get("thinking", "")
            block["content"] += text
            logger.debug(f"🧠 THINKING_DELTA: {len(text)} chars received")
            # Emit thinking delta event for real-time updates
            events.append(StreamEvent(
                type=StreamEventType.THINKING_DELTA.value,
                id=block["id"],
                content=text,
            ))
        elif delta_type == "input_json_delta" and block["type"] == "tool":
            partial = delta.get("partial_json", "")
            block["input_buffer"] += partial
            events.append(StreamEvent(
                type=StreamEventType.TOOL_INPUT_DELTA.value,
                id=block["id"],
                content=partial,
            ))
            
    elif event_type == "content_block_stop":
        index = raw_event.get("index", 0)
        block = block_state.pop(index, None)
        if block:
            if block["type"] == "text":
                events.append(StreamEvent(
                    type=StreamEventType.TEXT_END.value,
                    id=block["id"],
                ))
                # Also emit legacy TEXT event for backward compatibility
                if block["content"]:
                    events.append(StreamEvent(
                        type=StreamEventType.TEXT.value,
                        content=block["content"],
                    ))
            elif block["type"] == "tool":
                events.append(StreamEvent(
                    type=StreamEventType.TOOL_INPUT_END.value,
                    id=block["id"],
                ))
            elif block["type"] == "thinking":
                logger.info(f"🧠 THINKING_END: Thinking block ended (id={block['id']}, content_length={len(block['content'])})")
                events.append(StreamEvent(
                    type=StreamEventType.THINKING_END.value,
                    id=block["id"],
                ))
                # Also emit legacy THINKING event for backward compatibility
                if block["content"]:
                    events.append(StreamEvent(
                        type=StreamEventType.THINKING.value,
                        content=block["content"],
                    ))
                    
    elif event_type == "message_delta":
        # Extract usage info
        usage_data = raw_event.get("usage", {})
        if usage_data:
            usage = Usage(
                input_tokens=usage_data.get("input_tokens", 0),
                output_tokens=usage_data.get("output_tokens", 0),
                total_tokens=usage_data.get("input_tokens", 0) + usage_data.get("output_tokens", 0),
            )
            # Store in block_state for final event
            block_state["_usage"] = usage
            
    return events


async def stream_agent_response(
    prompt: str,
    settings: AppSettings,
    cwd: Optional[str] = None,
    streaming: bool = True,
) -> AsyncGenerator[StreamEvent, None]:
    """
    Stream agent responses as events.
    
    Args:
        prompt: User prompt
        settings: Application settings
        cwd: Working directory
        streaming: If True, emit incremental events (text_delta, etc.)
                   If False, only emit aggregated events (text, tool_use, etc.)
    
    Yields StreamEvent objects with types:
    - "start": Stream started
    - "text_start/delta/end": Incremental text (when streaming=True)
    - "text": Complete text block (always)
    - "thinking": Thinking content
    - "tool_input_start/delta/end": Incremental tool input (when streaming=True)
    - "tool_use": Tool invocation
    - "tool_result": Tool execution result
    - "error": Error occurred
    - "done": Streaming complete with usage stats
    """

    logger.info(f"Starting stream_agent_response for prompt: {prompt[:100]}...")
    
    try:
        options = build_agent_options(settings, streaming=streaming)
        if cwd:
            options.cwd = cwd
        
        logger.info(f"Agent options: model={options.model}, max_turns={options.max_turns}, permission_mode={getattr(options, 'permission_mode', None)}")
        
        turn_count = 0
        message_count = 0
        block_state = {}  # Track active content blocks for streaming
        total_usage = Usage()
        
        logger.info("Starting SDK query loop...")
        
        async for message in query(prompt=prompt, options=options):
            message_count += 1
            message_type = type(message).__name__
            logger.debug(f"Received message #{message_count}: type={message_type}")
            
            # Handle incremental stream events
            if isinstance(message, SDKStreamEvent):
                stream_events = _process_stream_event(message, block_state)
                for event in stream_events:
                    yield event
                # Update usage if available
                if "_usage" in block_state:
                    total_usage = block_state["_usage"]
                continue

            if isinstance(message, AssistantMessage):
                turn_count += 1
                logger.info(f"AssistantMessage turn {turn_count}: {len(message.content)} content blocks")
                for block in message.content:
                    if isinstance(block, TextBlock):
                        # Check if it's thinking content
                        if getattr(block, "type", None) == "thinking":
                            yield StreamEvent(
                                type=StreamEventType.THINKING.value,
                                content=block.text,
                                metadata={"turn": turn_count}
                            )
                        else:
                            # Always emit TEXT for AssistantMessage content
                            # This serves as a fallback in case streaming didn't emit text events
                            text_preview = block.text[:100] if block.text else ""
                            logger.info(f"AssistantMessage text (turn {turn_count}): {text_preview}...")
                            yield StreamEvent(
                                type=StreamEventType.TEXT.value,
                                content=block.text,
                                metadata={"turn": turn_count}
                            )
                    elif isinstance(block, ThinkingBlock):
                        yield StreamEvent(
                            type=StreamEventType.THINKING.value,
                            content=block.thinking,
                            metadata={"turn": turn_count}
                        )
                    elif isinstance(block, ToolUseBlock):
                        # Log tool use with input preview for debugging
                        input_preview = str(block.input)[:200] if block.input else "None"
                        logger.info(f"Tool use: name={block.name}, id={block.id}, input={input_preview}")
                        
                        # Special logging for TodoWrite to debug todo list issues
                        if block.name == "TodoWrite":
                            logger.info(f"TodoWrite full input: {block.input}")
                        
                        yield StreamEvent(
                            type=StreamEventType.TOOL_USE.value,
                            content={
                                "id": block.id,
                                "name": block.name,
                                "input": block.input,
                            },
                            metadata={"turn": turn_count}
                        )
            
            elif isinstance(message, UserMessage):
                # UserMessage contains tool results after tool execution
                for block in message.content:
                    if isinstance(block, ToolResultBlock):
                        is_error = getattr(block, "is_error", False)
                        result_preview = str(block.content)[:200] if block.content else "None"
                        logger.info(f"Tool result: tool_use_id={block.tool_use_id}, is_error={is_error}, result={result_preview}...")
                        yield StreamEvent(
                            type=StreamEventType.TOOL_RESULT.value,
                            content={
                                "tool_use_id": block.tool_use_id,
                                "result": block.content,
                                "is_error": is_error,
                            },
                            metadata={"turn": turn_count}
                        )
            
            elif isinstance(message, SystemMessage):
                # SystemMessage can contain todos, init info, etc.
                logger.info(f"SystemMessage received: subtype={message.subtype}, data_keys={list(message.data.keys()) if message.data else []}")
                
                # Check for todos in the system message
                if message.data and 'todos' in message.data:
                    todos = message.data['todos']
                    logger.info(f"SystemMessage contains todos: {todos}")
                    yield StreamEvent(
                        type="todos",
                        content={"todos": todos},
                        metadata={"subtype": message.subtype}
                    )
                # Also log init messages for debugging
                elif message.subtype == 'init':
                    logger.info(f"Session init: session_id={message.data.get('session_id')}, tools={message.data.get('tools', [])[:5]}...")
            
            elif isinstance(message, ResultMessage):
                # ResultMessage is the FINAL session result, not individual tool result
                # Only extract usage info here
                logger.info(f"ResultMessage received: subtype={getattr(message, 'subtype', 'unknown')}, is_error={getattr(message, 'is_error', False)}")
                if message.usage:
                    total_usage = Usage(
                        input_tokens=message.usage.get("input_tokens", 0),
                        output_tokens=message.usage.get("output_tokens", 0),
                        total_tokens=message.usage.get("input_tokens", 0) + message.usage.get("output_tokens", 0),
                    )
        
        logger.info(f"SDK query loop finished. Total messages: {message_count}, Total turns: {turn_count}")
        
        yield StreamEvent(
            type=StreamEventType.DONE.value,
            content={"total_turns": turn_count},
            usage=total_usage,
        )
    
    except Exception as e:
        import traceback
        logger.error(f"Error in stream_agent_response: {e}", exc_info=True)
        traceback.print_exc()
        yield StreamEvent(
            type=StreamEventType.ERROR.value,
            content=str(e),
            metadata={"error_type": type(e).__name__}
        )


async def invoke_agent(
    prompt: str,
    settings: AppSettings,
    cwd: Optional[str] = None,
) -> AgentResponse:
    """
    Blocking agent call for sub-agents and background tasks.
    
    Returns aggregated AgentResponse instead of streaming events.
    Internally uses streaming but collects all events before returning.
    """
    events = []
    text_parts = []
    tool_calls = []
    final_usage = Usage()
    
    async for event in stream_agent_response(
        prompt=prompt,
        settings=settings,
        cwd=cwd,
        streaming=False,  # Disable incremental events for simpler processing
    ):
        events.append(event)
        
        if event.type == StreamEventType.TEXT.value:
            text_parts.append(event.content)
        elif event.type == StreamEventType.TOOL_USE.value:
            tool_calls.append(event.content)
        elif event.type == StreamEventType.DONE.value:
            if event.usage:
                final_usage = event.usage
    
    return AgentResponse(
        text="".join(text_parts),
        tool_calls=tool_calls,
        events=events,
        usage=final_usage,
    )


class AgentSession:
    """
    Manages an interactive agent session using ClaudeSDKClient.
    Supports multi-turn conversations.
    """
    
    def __init__(self, settings: AppSettings, cwd: Optional[str] = None):
        self.settings = settings
        self.cwd = cwd
        self.client: Optional[ClaudeSDKClient] = None
        self.history: list[dict] = []
    
    async def start(self) -> None:
        """Start the agent session."""
        options = build_agent_options(self.settings)
        if self.cwd:
            options.cwd = self.cwd
        self.client = ClaudeSDKClient(options=options)
        await self.client.__aenter__()
    
    async def stop(self) -> None:
        """Stop the agent session."""
        if self.client:
            await self.client.__aexit__(None, None, None)
            self.client = None
    
    async def send_message(self, message: str) -> AsyncGenerator[StreamEvent, None]:
        """Send a message and stream the response."""
        if not self.client:
            yield StreamEvent(type=StreamEventType.ERROR.value, content="Session not started")
            return
        
        try:
            await self.client.query(message)
            self.history.append({"role": "user", "content": message})
            
            turn_count = 0
            async for msg in self.client.receive_response():
                if isinstance(msg, AssistantMessage):
                    turn_count += 1
                    for block in msg.content:
                        if isinstance(block, TextBlock):
                            yield StreamEvent(
                                type=StreamEventType.TEXT.value,
                                content=block.text,
                                metadata={"turn": turn_count}
                            )
                        elif isinstance(block, ToolUseBlock):
                            yield StreamEvent(
                                type=StreamEventType.TOOL_USE.value,
                                content={
                                    "id": block.id,
                                    "name": block.name,
                                    "input": block.input,
                                },
                                metadata={"turn": turn_count}
                            )
            
            yield StreamEvent(type=StreamEventType.DONE.value, content={"total_turns": turn_count})
        
        except Exception as e:
            yield StreamEvent(
                type=StreamEventType.ERROR.value,
                content=str(e),
                metadata={"error_type": type(e).__name__}
            )
    
    async def __aenter__(self):
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.stop()
