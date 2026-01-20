"""
Session Manager for ClaudeSDKClient lifecycle management.

Manages active ClaudeSDKClient instances, handling:
- Session creation and reuse
- Model/endpoint switching (recreates client)
- Idle session cleanup
- WebSocket association for can_use_tool callbacks
"""
import asyncio
import logging
import time
import uuid
from typing import Optional, Dict, Any, AsyncGenerator
from dataclasses import dataclass, field
from fastapi import WebSocket

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk.types import PermissionResultAllow, PermissionResultDeny
from claude_agent_sdk.types import StreamEvent as SDKStreamEvent
from claude_agent_sdk import (
    AssistantMessage,
    UserMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolUseBlock,
    ToolResultBlock,
)

from models.settings import AppSettings
from core.user_input_handler import user_input_handler

logger = logging.getLogger(__name__)


@dataclass
class ManagedSession:
    """Encapsulates a ClaudeSDKClient with metadata."""
    client: ClaudeSDKClient
    session_id: str  # Our storage session ID
    endpoint_name: Optional[str] = None
    model_name: Optional[str] = None
    security_mode: Optional[str] = None  # Current security/permission mode
    sdk_session_id: Optional[str] = None  # SDK's internal session ID
    slash_commands: list = field(default_factory=list)  # Slash commands from SDK
    last_active: float = field(default_factory=time.time)
    websocket: Optional[WebSocket] = None
    is_started: bool = False
    
    def update_activity(self):
        self.last_active = time.time()
    
    def is_idle(self, max_idle_seconds: float = 300) -> bool:
        return (time.time() - self.last_active) > max_idle_seconds


# Import StreamEvent from agent_client for consistency
from core.agent_client import StreamEvent, StreamEventType, _process_stream_event


class SessionManager:
    """
    Manages active ClaudeSDKClient sessions.
    
    Key features:
    - Reuses existing session if model/endpoint unchanged
    - Recreates session when model/endpoint changes
    - Supports can_use_tool for AskUserQuestion
    - Auto-cleanup of idle sessions
    """
    
    def __init__(self):
        self._sessions: Dict[str, ManagedSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start the session manager (background cleanup task)."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("[SessionManager] Started")
    
    async def stop(self):
        """Stop the session manager and close all sessions."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Close all sessions
        async with self._lock:
            for session_id in list(self._sessions.keys()):
                await self._close_session_internal(session_id)
        
        logger.info("[SessionManager] Stopped")
    
    async def get_or_create(
        self,
        session_id: str,
        settings: AppSettings,
        endpoint_name: Optional[str] = None,
        model_name: Optional[str] = None,
        websocket: Optional[WebSocket] = None,
        resume_sdk_session_id: Optional[str] = None,
        cwd: Optional[str] = None,
        security_mode: Optional[str] = None,
    ) -> ManagedSession:
        """
        Get existing session or create new one.
        
        If model/endpoint changed, closes old session and creates new one.
        """
        async with self._lock:
            existing = self._sessions.get(session_id)
            
            if existing:
                # Check if model/endpoint changed (security_mode can be changed dynamically)
                if (existing.endpoint_name == endpoint_name and 
                    existing.model_name == model_name):
                    # Reuse existing session - DON'T update security_mode here
                    # It will be updated in stream_message after calling set_permission_mode
                    existing.update_activity()
                    existing.websocket = websocket
                    logger.info(f"[SessionManager] Reusing session: {session_id} (pending security_mode: {security_mode})")
                    return existing
                else:
                    # Model/endpoint changed - close and recreate
                    logger.info(f"[SessionManager] Config changed (endpoint={endpoint_name}, model={model_name}), recreating session: {session_id}")
                    await self._close_session_internal(session_id)
            
            # Create new session
            session = await self._create_session(
                session_id=session_id,
                settings=settings,
                endpoint_name=endpoint_name,
                model_name=model_name,
                websocket=websocket,
                resume_sdk_session_id=resume_sdk_session_id,
                cwd=cwd,
                security_mode=security_mode,
            )
            self._sessions[session_id] = session
            return session
    
    async def _create_session(
        self,
        session_id: str,
        settings: AppSettings,
        endpoint_name: Optional[str],
        model_name: Optional[str],
        websocket: Optional[WebSocket],
        resume_sdk_session_id: Optional[str],
        cwd: Optional[str],
        security_mode: Optional[str] = None,
    ) -> ManagedSession:
        """Create a new ClaudeSDKClient session."""
        from core.agent_client import build_agent_options
        
        # Apply model override to settings (copy to avoid mutation)
        if endpoint_name:
            settings.model.selected_endpoint = endpoint_name
        if model_name:
            settings.model.model_name = model_name
        
        # Build options with can_use_tool if websocket provided
        can_use_tool = self._create_can_use_tool(websocket, session_id, security_mode) if websocket else None
        options = build_agent_options(settings, streaming=True, can_use_tool=can_use_tool, security_mode=security_mode)
        
        if cwd:
            options.cwd = cwd
        
        if resume_sdk_session_id:
            options.resume = resume_sdk_session_id
            logger.info(f"[SessionManager] Resuming SDK session: {resume_sdk_session_id}")
        
        # Create client
        client = ClaudeSDKClient(options=options)
        
        session = ManagedSession(
            client=client,
            session_id=session_id,
            endpoint_name=endpoint_name,
            model_name=model_name,
            security_mode=security_mode,
            sdk_session_id=resume_sdk_session_id,
            websocket=websocket,
        )
        
        logger.info(f"[SessionManager] Created session: {session_id} (endpoint={endpoint_name}, model={model_name}, security={security_mode})")
        return session
    
    def _create_can_use_tool(self, websocket: WebSocket, session_id: str, security_mode: Optional[str] = None):
        """Create can_use_tool callback for tool permission approval.
        
        NOTE: This callback is ONLY called by the SDK when permission_mode='default'.
        For other permission modes (acceptEdits, bypassPermissions), the SDK handles
        permissions internally and doesn't call this callback.
        """
        async def can_use_tool(tool_name: str, input_data: dict, context: Any):
            # DEBUG: Log EVERY call to this callback
            logger.info(f"[can_use_tool] CALLED! tool_name={tool_name}, input_keys={list(input_data.keys()) if input_data else []}")
            
            # Handle AskUserQuestion tool specially
            if tool_name == "AskUserQuestion":
                request_id = str(uuid.uuid4())
                questions = input_data.get("questions", [])
                
                logger.info(f"[AskUserQuestion] Requesting user input: {request_id}")
                
                answers = await user_input_handler.request_user_input(
                    request_id=request_id,
                    questions=questions,
                    websocket=websocket,
                    session_id=session_id,
                )
                
                if answers:
                    return PermissionResultAllow(
                        updated_input={
                            "questions": questions,
                            "answers": answers,
                        }
                    )
                else:
                    return PermissionResultDeny(
                        message="User did not provide an answer"
                    )
            
            # For all other tools: SDK calls this callback because permission_mode='default'
            # Always send permission request to frontend and wait for user approval
            request_id = str(uuid.uuid4())
            logger.info(f"[Permission] Requesting approval for tool: {tool_name} (request_id={request_id})")
            
            # Send permission request event to frontend
            permission_event = {
                "type": "permission_request",
                "content": {
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "input": input_data,
                },
                "metadata": {}
            }
            
            try:
                await websocket.send_json(permission_event)
            except Exception as e:
                logger.error(f"[Permission] Failed to send permission request: {e}")
                # If can't send, deny for safety
                return PermissionResultDeny(message="Failed to request permission from user")
            
            # Wait for user response
            approved = await user_input_handler.request_permission(
                request_id=request_id,
                websocket=websocket,
                tool_name=tool_name,
                timeout=120,  # 2 minute timeout for permission approval
            )
            
            if approved:
                logger.info(f"[Permission] User approved tool: {tool_name}")
                return PermissionResultAllow()
            else:
                logger.info(f"[Permission] User denied tool: {tool_name}")
                return PermissionResultDeny(message=f"User denied permission for {tool_name}")
        
        return can_use_tool
    
    async def stream_message(
        self, 
        session: ManagedSession, 
        message: str,
        security_mode: Optional[str] = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Send a message and stream the response with incremental events.
        
        Yields StreamEvents including:
        - text_start/delta/end
        - tool_input_start/delta/end
        - thinking_start/delta/end
        - tool_use, tool_result
        - system (with sdk_session_id)
        - done
        """
        if not session.client:
            yield StreamEvent(type=StreamEventType.ERROR.value, content="Session not initialized")
            return
        
        # Start client if not already started
        if not session.is_started:
            await session.client.__aenter__()
            session.is_started = True
        
        # Apply security_mode dynamically using SDK's set_permission_mode
        if security_mode and security_mode != session.security_mode:
            try:
                await session.client.set_permission_mode(security_mode)
                session.security_mode = security_mode
                logger.info(f"[SessionManager] Set permission_mode to: {security_mode}")
            except Exception as e:
                logger.warning(f"[SessionManager] Failed to set permission_mode: {e}")
        
        try:
            # Send the query
            await session.client.query(message)
            session.update_activity()
            
            turn_count = 0
            block_state = {}  # For processing incremental events
            has_streamed_thinking = False  # Track if thinking was sent via streaming
            
            # Process messages from the client
            async for msg in session.client.receive_messages():
                # Handle incremental stream events (SDKStreamEvent)
                if isinstance(msg, SDKStreamEvent):
                    stream_events = _process_stream_event(msg, block_state)
                    for event in stream_events:
                        # Track if we've sent thinking via streaming
                        if event.type in ['thinking_start', 'thinking_delta', 'thinking_end']:
                            has_streamed_thinking = True
                        yield event
                    continue
                
                # Handle SystemMessage (contains sdk_session_id and slash_commands)
                if isinstance(msg, SystemMessage):
                    if hasattr(msg, 'subtype') and msg.subtype == 'init':
                        if hasattr(msg, 'data') and isinstance(msg.data, dict):
                            new_session_id = msg.data.get('session_id')
                            if new_session_id:
                                session.sdk_session_id = new_session_id
                                logger.info(f"[SessionManager] Captured SDK session_id: {new_session_id}")
                            
                            # Capture slash commands from init message
                            slash_cmds = msg.data.get('slash_commands', [])
                            if slash_cmds:
                                session.slash_commands = slash_cmds
                                logger.info(f"[SessionManager] Captured slash_commands: {slash_cmds}")
                            
                            yield StreamEvent(
                                type="system",
                                content={
                                    "sdk_session_id": new_session_id,
                                    "slash_commands": slash_cmds,
                                },
                                metadata={"subtype": "init"}
                            )
                
                # Handle AssistantMessage (text, tool_use, thinking)
                # NOTE: When include_partial_messages=True, TextBlock content is already
                # sent via SDKStreamEvent (content_block_delta). We ONLY process
                # ToolUseBlock and ThinkingBlock here to avoid duplication.
                elif isinstance(msg, AssistantMessage):
                    turn_count += 1
                    
                    # Check for error in AssistantMessage
                    if hasattr(msg, 'error') and msg.error:
                        yield StreamEvent(
                            type=StreamEventType.ERROR.value,
                            content=str(msg.error),
                            metadata={"turn": turn_count, "source": "assistant"}
                        )
                    
                    for block in msg.content:
                        # Skip TextBlock - already sent via streaming events
                        if isinstance(block, TextBlock):
                            # But if there's no streaming, we need to send the text
                            # Check if text looks like an error
                            if block.text and ('Error:' in block.text or 'error' in block.text.lower()[:50]):
                                yield StreamEvent(
                                    type=StreamEventType.TEXT.value,
                                    content=block.text,
                                    metadata={"turn": turn_count}
                                )
                            continue
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
                        elif isinstance(block, ThinkingBlock):
                            yield StreamEvent(
                                type=StreamEventType.THINKING.value,
                                content=block.thinking,
                                metadata={"turn": turn_count}
                            )
                
                # Handle UserMessage (tool results OR slash command responses)
                elif isinstance(msg, UserMessage):
                    # Check if content is a string (slash command response)
                    if isinstance(msg.content, str):
                        # Clean up slash command response - remove XML-like tags
                        import re
                        content = msg.content
                        is_error = False
                        
                        # Check for stderr (error)
                        stderr_match = re.search(r'<local-command-stderr>(.*?)</local-command-stderr>', content, re.DOTALL)
                        if stderr_match:
                            content = stderr_match.group(1).strip()
                            is_error = True
                        
                        # Check for stdout (success)
                        stdout_match = re.search(r'<local-command-stdout>(.*?)</local-command-stdout>', content, re.DOTALL)
                        if stdout_match:
                            content = stdout_match.group(1).strip()
                        
                        # Send cleaned response as text
                        yield StreamEvent(
                            type=StreamEventType.TEXT.value,
                            content=content,
                            metadata={"turn": turn_count, "source": "slash_command", "is_error": is_error}
                        )
                    else:
                        # Normal tool results
                        for block in msg.content:
                            if isinstance(block, ToolResultBlock):
                                yield StreamEvent(
                                    type=StreamEventType.TOOL_RESULT.value,
                                    content={
                                        "tool_use_id": block.tool_use_id,
                                        "content": block.content,
                                        "is_error": getattr(block, 'is_error', False),
                                    },
                                    metadata={"turn": turn_count}
                                )
                
                # Handle ResultMessage (end of turn)
                elif isinstance(msg, ResultMessage):
                    # Check if there was an error
                    if hasattr(msg, 'is_error') and msg.is_error:
                        error_msg = getattr(msg, 'result', 'Unknown error')
                        yield StreamEvent(
                            type=StreamEventType.ERROR.value,
                            content=error_msg,
                            metadata={"source": "result", "subtype": getattr(msg, 'subtype', '')}
                        )
                    break
            
            # Include usage and cost info in done event
            usage_info = {}
            if hasattr(msg, 'total_cost_usd'):
                usage_info["cost_usd"] = msg.total_cost_usd
            if hasattr(msg, 'usage') and msg.usage:
                usage_info["usage"] = msg.usage
            if hasattr(msg, 'duration_ms'):
                usage_info["duration_ms"] = msg.duration_ms
                
            yield StreamEvent(
                type=StreamEventType.DONE.value, 
                content={"total_turns": turn_count, **usage_info}
            )
        
        except Exception as e:
            logger.error(f"[SessionManager] Stream error: {e}", exc_info=True)
            yield StreamEvent(
                type=StreamEventType.ERROR.value,
                content=str(e),
                metadata={"error_type": type(e).__name__}
            )
    
    async def close_session(self, session_id: str):
        """Close and remove a session."""
        async with self._lock:
            await self._close_session_internal(session_id)
    
    async def _close_session_internal(self, session_id: str):
        """Internal close without lock (caller must hold lock)."""
        session = self._sessions.pop(session_id, None)
        if session and session.client:
            try:
                if session.is_started:
                    await session.client.__aexit__(None, None, None)
                logger.info(f"[SessionManager] Closed session: {session_id}")
            except Exception as e:
                logger.error(f"[SessionManager] Error closing session {session_id}: {e}")
    
    async def _cleanup_loop(self):
        """Background task to cleanup idle sessions."""
        while True:
            try:
                await asyncio.sleep(60)  # Check every minute
                await self._cleanup_idle_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[SessionManager] Cleanup error: {e}")
    
    async def _cleanup_idle_sessions(self, max_idle_seconds: float = 300):
        """Close sessions idle for more than max_idle_seconds."""
        # Import here to avoid circular import
        from core.task_runner import task_runner
        
        async with self._lock:
            idle_sessions = [
                sid for sid, session in self._sessions.items()
                if session.is_idle(max_idle_seconds)
            ]
            
            for session_id in idle_sessions:
                # Don't clean up sessions with running tasks
                if task_runner.is_running(session_id):
                    logger.debug(f"[SessionManager] Skipping cleanup for session {session_id}: task is running")
                    continue
                    
                logger.info(f"[SessionManager] Cleaning up idle session: {session_id}")
                await self._close_session_internal(session_id)
    
    def get_session(self, session_id: str) -> Optional[ManagedSession]:
        """Get a session by ID (without lock, for read-only access)."""
        return self._sessions.get(session_id)
    
    @property
    def active_count(self) -> int:
        """Number of active sessions."""
        return len(self._sessions)


# Global instance
session_manager = SessionManager()

