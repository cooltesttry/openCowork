"""
Agent WebSocket router for real-time streaming.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request
from pydantic import BaseModel

from core.agent_client import stream_agent_response, AgentSession, StreamEvent
from core.session_manager import session_manager
from core.task_runner import task_runner
from core.user_input_handler import user_input_handler
from core import session_storage
from models.settings import AppSettings
from models.session import SessionMessage


# Set up logging (configured centrally in main.py)
logger = logging.getLogger(__name__)

router = APIRouter()


class ChatMessage(BaseModel):
    """Chat message from client."""
    content: str
    cwd: Optional[str] = None
    session_id: Optional[str] = None  # Session ID for multi-turn context
    endpoint_name: Optional[str] = None  # Override endpoint for this query
    model_name: Optional[str] = None  # Override model for this query
    security_mode: Optional[str] = "bypassPermissions"  # Permission mode: default, plan, acceptEdits, bypassPermissions


class UserResponse(BaseModel):
    """User response to AskUserQuestion."""
    type: str = "user_response"
    request_id: str
    answers: dict


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """
    WebSocket endpoint for real-time agent chat.
    
    Protocol:
    - Client sends JSON: {"content": "user message", "cwd": "/optional/path", "session_id": "uuid"}
    - Server streams JSON events: {"type": "...", "content": "...", "metadata": {...}}
    """
    await websocket.accept()
    logger.info("WebSocket connection accepted")
    
    # Get settings from app state
    settings: AppSettings = websocket.app.state.settings
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            logger.info(f"Received message from client: {data[:200]}...")
            
            try:
                message = ChatMessage.model_validate_json(data)
            except Exception as e:
                logger.error(f"Failed to parse message: {e}")
                await websocket.send_json({
                    "type": "error",
                    "content": f"Invalid message format: {e}",
                    "metadata": {}
                })
                continue
            
            # Handle session - create or get existing
            session = None
            if message.session_id:
                session = session_storage.get_session(message.session_id)
                if not session:
                    logger.warning(f"Session not found: {message.session_id}, creating new")
                    session = session_storage.create_session()
            else:
                # No session_id provided - create a new session
                session = session_storage.create_session()
            
            # Save user message to session
            user_msg = SessionMessage.create(
                role="user",
                content=message.content,
            )
            session.add_message(user_msg)
            session_storage.save_session(session)
            
            # Stream agent response
            event_count = 0
            assistant_content = ""  # Accumulate assistant response content
            assistant_blocks = []  # Accumulate blocks for structured rendering
            
            logger.info(f"Starting agent stream for prompt: {message.content[:100]}... (session: {session.id})")
            
            try:
                async for event in stream_agent_response(
                    prompt=message.content,
                    settings=settings,
                    cwd=message.cwd,
                ):
                    event_count += 1
                    event_dict = event.to_dict()
                    event_type = event_dict.get("type", "unknown")
                    
                    # Accumulate text content for saving
                    if event_type == "text":
                        assistant_content += str(event_dict.get("content", ""))
                    
                    # Accumulate blocks with proper format for frontend
                    if event_type in ["tool_use", "tool_result", "thinking"]:
                        block_content = event_dict.get("content", {})
                        block_id = event_dict.get("id") or (
                            block_content.get("id") if isinstance(block_content, dict) else None
                        ) or f"{event_type}-{event_count}"
                        
                        assistant_blocks.append({
                            "id": block_id,
                            "type": event_type,
                            "content": block_content,
                            "status": "success",
                            "metadata": event_dict.get("metadata", {}),
                        })
                    
                    # Add session_id to event metadata for frontend
                    event_dict["metadata"]["session_id"] = session.id
                    
                    # Log each event (abbreviated for large content)
                    content_preview = str(event_dict.get("content", ""))[:100]
                    logger.debug(f"Event #{event_count}: type={event_type}, content={content_preview}...")
                    
                    # Log important events at INFO level
                    if event_type in ["tool_use", "tool_result", "done", "error"]:
                        logger.info(f"Event #{event_count}: type={event_type}")
                    
                    await websocket.send_json(event_dict)
                
                # Save assistant response to session
                if assistant_content or assistant_blocks:
                    assistant_msg = SessionMessage.create(
                        role="assistant",
                        content=assistant_content,
                        blocks=assistant_blocks if assistant_blocks else None,
                    )
                    session.add_message(assistant_msg)
                    session_storage.save_session(session)
                
                logger.info(f"Agent stream completed. Total events sent: {event_count}")
                
            except Exception as stream_error:
                logger.error(f"Error during agent streaming: {stream_error}", exc_info=True)
                await websocket.send_json({
                    "type": "error",
                    "content": f"Stream error: {stream_error}",
                    "metadata": {"error_type": type(stream_error).__name__, "session_id": session.id}
                })
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected by client")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "content": str(e),
                "metadata": {"error_type": type(e).__name__}
            })
        except:
            pass


@router.post("/chat")
async def post_chat(request: Request, message: ChatMessage):
    """
    REST endpoint for single-turn chat (non-streaming).
    Returns accumulated response.
    """
    settings: AppSettings = request.app.state.settings
    
    events = []
    async for event in stream_agent_response(
        prompt=message.content,
        settings=settings,
        cwd=message.cwd,
    ):
        events.append(event.to_dict())
    
    # Extract final text content
    text_content = ""
    tool_calls = []
    
    for event in events:
        if event["type"] == "text":
            text_content += event["content"]
        elif event["type"] == "tool_use":
            tool_calls.append(event["content"])
    
    return {
        "content": text_content,
        "tool_calls": tool_calls,
        "events": events,
    }


class WarmupRequest(BaseModel):
    """Request for session warmup."""
    session_id: Optional[str] = None
    endpoint_name: Optional[str] = None
    model_name: Optional[str] = None
    cwd: Optional[str] = None


@router.post("/session/warmup")
async def session_warmup(request: Request, warmup_req: WarmupRequest):
    """
    Warmup endpoint - returns available skills/agents from filesystem scan.
    
    This is a lightweight alternative to full SDK connection, providing
    immediate access to skills/agents data without starting the CLI.
    The actual SDK connection happens on first message.
    """
    import os
    import glob
    
    settings: AppSettings = request.app.state.settings
    workdir = warmup_req.cwd or settings.default_workdir or os.getcwd()
    
    skills = []
    agents = []
    
    # Paths to scan
    scan_paths = [
        (os.path.expanduser("~/.claude"), "user"),
        (os.path.join(workdir, ".claude"), "project"),
    ]
    
    for base_path, source in scan_paths:
        # Scan skills
        skills_dir = os.path.join(base_path, "skills")
        if os.path.isdir(skills_dir):
            for item in os.listdir(skills_dir):
                skill_path = os.path.join(skills_dir, item)
                skill_md = os.path.join(skill_path, "SKILL.md")
                if os.path.isdir(skill_path) and os.path.isfile(skill_md):
                    skills.append({
                        "name": item,
                        "path": skill_md,
                        "source": source
                    })
        
        # Scan agents
        agents_dir = os.path.join(base_path, "agents")
        if os.path.isdir(agents_dir):
            for f in glob.glob(os.path.join(agents_dir, "*.md")):
                agent_name = os.path.basename(f).replace(".md", "")
                agents.append({
                    "name": agent_name,
                    "path": f,
                    "source": source,
                    "is_builtin": False
                })
    
    
    logger.info(f"[Warmup] Filesystem scan complete: {len(skills)} skills, {len(agents)} agents")
    
    return {
        "status": "success",
        "session_id": warmup_req.session_id,  # Pass through if provided
        "skills": skills,
        "agents": agents,
        "tools": [],  # Will be populated on first message via init event
        "slash_commands": [],  # Will be populated on first message
        "workdir": workdir,
    }



@router.websocket("/ws/session")
async def websocket_session(websocket: WebSocket):
    """
    WebSocket endpoint for multi-turn agent session (stateful).
    Uses SessionManager with ClaudeSDKClient for persistent sessions.
    
    Protocol:
    - Client sends JSON: {"content": "user message", "cwd": "/optional/path", "session_id": "uuid"}
    - Client can send: {"type": "user_response", "request_id": "...", "answers": {...}}
    - Server streams JSON events: {"type": "...", "content": "...", "metadata": {...}}
    
    Features:
    - Session persistence: ClaudeSDKClient reused across messages
    - Model switching: Session recreated when model/endpoint changes
    - AskUserQuestion support via can_use_tool callback
    - Message persistence: All messages saved for UI display
    """
    await websocket.accept()
    logger.info("Multi-turn session WebSocket connection accepted")
    
    # Get settings from app state
    settings: AppSettings = websocket.app.state.settings
    current_session_id: Optional[str] = None
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            logger.info(f"[Session] Received message: {data[:200]}...")
            
            try:
                parsed = json.loads(data)
                
                # Check if this is a user_response (for AskUserQuestion)
                if parsed.get("type") == "user_response":
                    request_id = parsed.get("request_id")
                    answers = parsed.get("answers", {})
                    logger.info(f"[Session] Received user_response for: {request_id}")
                    await user_input_handler.receive_user_response(request_id, answers)
                    continue
                
                message = ChatMessage.model_validate(parsed)
            except Exception as e:
                logger.error(f"Failed to parse message: {e}")
                await websocket.send_json({
                    "type": "error",
                    "content": f"Invalid message format: {e}",
                    "metadata": {}
                })
                continue
            
            # Handle storage session for persistence
            storage_session = None
            resume_sdk_session_id = None
            
            if message.session_id:
                storage_session = session_storage.get_session(message.session_id)
                if storage_session:
                    # Use stored SDK session_id for resumption
                    resume_sdk_session_id = storage_session.sdk_session_id
                    if resume_sdk_session_id:
                        logger.info(f"[Session] Will resume SDK session: {resume_sdk_session_id}")
                else:
                    logger.warning(f"Session not found: {message.session_id}, creating new")
                    storage_session = session_storage.create_session()
            else:
                storage_session = session_storage.create_session()
            
            current_session_id = storage_session.id
            
            # Save user message to storage
            user_msg = SessionMessage.create(
                role="user",
                content=message.content,
            )
            storage_session.add_message(user_msg)
            storage_session.last_security_mode = message.security_mode  # Persist security mode
            session_storage.save_session(storage_session)
            
            # Determine effective endpoint and model
            effective_endpoint = message.endpoint_name or settings.model.selected_endpoint
            effective_model = message.model_name or settings.model.model_name
            
            # Validate endpoint exists
            if effective_endpoint:
                endpoint_exists = any(ep.name == effective_endpoint for ep in settings.model.endpoints)
                if not endpoint_exists:
                    logger.warning(f"Endpoint '{effective_endpoint}' not found, using default")
                    effective_endpoint = settings.model.selected_endpoint
            
            logger.info(f"[Session] Starting query (storage: {storage_session.id}, resume: {resume_sdk_session_id}, endpoint: {effective_endpoint}, model: {effective_model}, security: {message.security_mode})")
            
            # Get or create managed session via SessionManager
            managed_session = await session_manager.get_or_create(
                session_id=storage_session.id,
                settings=settings,
                endpoint_name=effective_endpoint,
                model_name=effective_model,
                websocket=websocket,
                resume_sdk_session_id=resume_sdk_session_id,
                cwd=message.cwd,
                security_mode=message.security_mode,
            )
            
            # Stream response using SessionManager (ClaudeSDKClient-based)
            event_count = 0
            assistant_content = ""
            # Use a single ordered list to preserve event sequence
            all_blocks: list[dict] = []
            # Map tool_use_id to index in all_blocks for updating with results
            tool_block_indices: dict[str, int] = {}
            
            # Queue to receive messages from background listener
            message_queue: asyncio.Queue = asyncio.Queue()
            listener_task: Optional[asyncio.Task] = None
            
            async def websocket_listener():
                """Background task to listen for user_response during streaming."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        try:
                            parsed = json.loads(data)
                            if parsed.get("type") == "user_response":
                                request_id = parsed.get("request_id")
                                answers = parsed.get("answers", {})
                                logger.info(f"[Session] Background received user_response for: {request_id}")
                                await user_input_handler.receive_user_response(request_id, answers)
                            elif parsed.get("type") == "permission_response":
                                request_id = parsed.get("request_id")
                                approved = parsed.get("approved", False)
                                logger.info(f"[Session] Background received permission_response for: {request_id}, approved={approved}")
                                await user_input_handler.receive_permission_response(request_id, approved)
                            else:
                                # Put regular messages in queue for later
                                await message_queue.put(data)
                        except Exception as e:
                            logger.error(f"[Session] Error in background listener: {e}")
                except WebSocketDisconnect:
                    logger.info("[Session] Background listener: WebSocket disconnected")
                except Exception as e:
                    logger.debug(f"[Session] Background listener stopped: {e}")
            
            # Start background listener for user_response during streaming
            listener_task = asyncio.create_task(websocket_listener())
            
            try:
                async for event in session_manager.stream_message(managed_session, message.content, security_mode=message.security_mode):
                    event_count += 1
                    event_dict = event.to_dict()
                    event_type = event_dict.get("type", "unknown")
                    
                    # Handle system events (contains sdk_session_id and slash_commands)
                    if event_type == "system":
                        content = event_dict.get("content", {})
                        if isinstance(content, dict) and "sdk_session_id" in content:
                            new_sdk_session_id = content["sdk_session_id"]
                            # Update storage with new SDK session_id
                            storage_session.sdk_session_id = new_sdk_session_id
                            session_storage.save_session(storage_session)
                            logger.info(f"[Session] Updated sdk_session_id: {new_sdk_session_id}")
                        # Send system event to client (for slash_commands, etc.)
                        event_dict["metadata"]["session_id"] = storage_session.id
                        await websocket.send_json(event_dict)
                        continue
                    
                    # Accumulate text content and add as block
                    if event_type == "text":
                        text_content = str(event_dict.get("content", ""))
                        assistant_content += text_content
                        all_blocks.append({
                            "id": f"text-{event_count}",
                            "type": "text",
                            "content": text_content,
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Handle tool_use: create new block and append to ordered list
                    elif event_type == "tool_use":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("id", f"tool-{event_count}")
                        tool_block = {
                            "id": tool_use_id,
                            "type": "tool_use",
                            "content": {
                                "name": block_content.get("name", ""),
                                "input": block_content.get("input", {}),
                            },
                            "status": "running",
                            "metadata": {
                                "toolName": block_content.get("name", ""),
                                "toolCallId": tool_use_id,
                            },
                        }
                        tool_block_indices[tool_use_id] = len(all_blocks)
                        all_blocks.append(tool_block)
                    
                    # Handle tool_result: merge into existing tool_use block in all_blocks
                    elif event_type == "tool_result":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("tool_use_id", "")
                        if tool_use_id in tool_block_indices:
                            idx = tool_block_indices[tool_use_id]
                            all_blocks[idx]["content"]["result"] = block_content.get("content", "")
                            all_blocks[idx]["content"]["is_error"] = block_content.get("is_error", False)
                            all_blocks[idx]["status"] = "error" if block_content.get("is_error") else "success"
                        else:
                            # Orphan result - append as new block
                            all_blocks.append({
                                "id": tool_use_id,
                                "type": "tool_use",
                                "content": {"result": block_content.get("content", "")},
                                "status": "success",
                                "metadata": {"toolCallId": tool_use_id},
                            })
                    
                    # Handle thinking blocks - append to ordered list
                    elif event_type == "thinking":
                        all_blocks.append({
                            "id": f"thinking-{event_count}",
                            "type": "thinking",
                            "content": event_dict.get("content", ""),
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Handle todos (plan) blocks
                    elif event_type == "todos":
                        all_blocks.append({
                            "id": f"todos-{event_count}",
                            "type": "plan",
                            "content": event_dict.get("content", {}),
                            "status": "success",
                            "metadata": {
                                "todos": event_dict.get("content", {}).get("todos", []),
                            },
                        })
                    
                    # Handle ask_user blocks
                    elif event_type == "ask_user":
                        content = event_dict.get("content", {})
                        all_blocks.append({
                            "id": f"ask-user-{content.get('request_id', event_count)}",
                            "type": "ask_user",
                            "content": {
                                "input": {
                                    "questions": content.get("questions", []),
                                    "timeout": content.get("timeout", 60),
                                },
                            },
                            "status": "success",  # Will be updated when response received
                            "metadata": {
                                "requestId": content.get("request_id", ""),
                            },
                        })
                    
                    # Add session_id to metadata and send to client
                    event_dict["metadata"]["session_id"] = storage_session.id
                    await websocket.send_json(event_dict)
                
                # Use the ordered blocks list directly (already in event sequence)
                assistant_blocks = all_blocks
                
                # Save assistant response to storage
                if assistant_content or assistant_blocks:
                    assistant_msg = SessionMessage.create(
                        role="assistant",
                        content=assistant_content,
                        blocks=assistant_blocks if assistant_blocks else None,
                    )
                    storage_session.add_message(assistant_msg)
                    
                    # Track the model and endpoint used for this response
                    storage_session.last_model_name = effective_model
                    storage_session.last_endpoint_name = effective_endpoint or "(legacy)"
                    
                    session_storage.save_session(storage_session)
                
                logger.info(f"[Session] Query completed. Events: {event_count}, Blocks: {len(assistant_blocks)}")
                
            except Exception as stream_error:
                logger.error(f"[Session] Error during streaming: {stream_error}", exc_info=True)
                await websocket.send_json({
                    "type": "error",
                    "content": f"Stream error: {stream_error}",
                    "metadata": {"error_type": type(stream_error).__name__, "session_id": storage_session.id}
                })
            finally:
                # Cancel background listener task
                if listener_task and not listener_task.done():
                    listener_task.cancel()
                    try:
                        await listener_task
                    except asyncio.CancelledError:
                        pass
    
    except WebSocketDisconnect:
        logger.info("Multi-turn session WebSocket disconnected by client")
    except Exception as e:
        logger.error(f"[Session] WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "content": str(e),
                "metadata": {"error_type": type(e).__name__}
            })
        except:
            pass
    finally:
        # Note: We don't close the managed session here, it stays for reuse
        # SessionManager will clean it up after idle timeout
        logger.info("Session WebSocket closed")


@router.websocket("/ws/multiplexed")
async def websocket_multiplexed(websocket: WebSocket):
    """
    Multiplexed WebSocket endpoint supporting concurrent background tasks.
    
    Features:
    - Multiple sessions can execute concurrently
    - Tasks run in background, independent of WebSocket connection
    - Supports reconnect/replay via cached events
    - Session status tracking (running, completed, unread)
    
    Protocol:
    - Client sends: {"type": "query", "session_id": "uuid", "content": "message", ...}
    - Client sends: {"type": "subscribe", "session_id": "uuid"} - Subscribe to session events
    - Client sends: {"type": "unsubscribe", "session_id": "uuid"} - Unsubscribe from session
    - Client sends: {"type": "user_response", "request_id": "...", "answers": {...}}
    - Client sends: {"type": "permission_response", "request_id": "...", "approved": bool}
    - Server sends: {"type": "...", "metadata": {"session_id": "..."}, ...}
    """
    await websocket.accept()
    logger.info("[Multiplexed] WebSocket connection accepted")
    
    settings: AppSettings = websocket.app.state.settings
    
    # Track active subscriptions for this connection
    subscriptions: dict[str, asyncio.Task] = {}
    
    async def subscribe_to_session(session_id: str):
        """Subscribe to events from a session and forward to WebSocket."""
        try:
            async for event in task_runner.subscribe(session_id):
                event["metadata"] = event.get("metadata", {})
                event["metadata"]["session_id"] = session_id
                try:
                    await websocket.send_json(event)
                except Exception as e:
                    logger.error(f"[Multiplexed] Failed to send event: {e}")
                    break
        except Exception as e:
            logger.error(f"[Multiplexed] Subscription error for {session_id}: {e}")
        finally:
            subscriptions.pop(session_id, None)
    
    async def start_task_for_session(session_id: str, message: ChatMessage):
        """Start a background task for a session."""
        # Get or create storage session
        storage_session = session_storage.get_session(session_id)
        if not storage_session:
            storage_session = session_storage.create_session()
            session_id = storage_session.id
        
        # Save user message
        user_msg = SessionMessage.create(role="user", content=message.content)
        storage_session.add_message(user_msg)
        session_storage.save_session(storage_session)
        
        # Determine effective settings
        effective_endpoint = message.endpoint_name or settings.model.selected_endpoint
        effective_model = message.model_name or settings.model.model_name
        resume_sdk_session_id = storage_session.sdk_session_id
        
        # Create the task coroutine
        async def task_coroutine():
            """Generator that yields events from session_manager.stream_message."""
            # Get or create managed session
            managed_session = await session_manager.get_or_create(
                session_id=storage_session.id,
                settings=settings,
                endpoint_name=effective_endpoint,
                model_name=effective_model,
                websocket=websocket,  # For can_use_tool callbacks
                resume_sdk_session_id=resume_sdk_session_id,
                cwd=message.cwd,
                security_mode=message.security_mode,
            )
            
            # Accumulate response for saving
            assistant_content = ""
            all_blocks = []
            tool_block_indices = {}
            event_count = 0
            
            try:
                async for event in session_manager.stream_message(
                    managed_session, message.content, security_mode=message.security_mode
                ):
                    event_count += 1
                    event_dict = event.to_dict()
                    event_type = event_dict.get("type", "unknown")
                    
                    # Handle system events (SDK session ID)
                    if event_type == "system":
                        content = event_dict.get("content", {})
                        if isinstance(content, dict) and "sdk_session_id" in content:
                            storage_session.sdk_session_id = content["sdk_session_id"]
                            session_storage.save_session(storage_session)
                    
                    # Accumulate text
                    if event_type == "text":
                        assistant_content += str(event_dict.get("content", ""))
                        all_blocks.append({
                            "id": f"text-{event_count}",
                            "type": "text",
                            "content": event_dict.get("content", ""),
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Handle tool_use
                    elif event_type == "tool_use":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("id", f"tool-{event_count}")
                        tool_block = {
                            "id": tool_use_id,
                            "type": "tool_use",
                            "content": {
                                "name": block_content.get("name", ""),
                                "input": block_content.get("input", {}),
                            },
                            "status": "running",
                            "metadata": {"toolName": block_content.get("name", "")},
                        }
                        tool_block_indices[tool_use_id] = len(all_blocks)
                        all_blocks.append(tool_block)
                    
                    # Handle tool_result
                    elif event_type == "tool_result":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("tool_use_id", "")
                        if tool_use_id in tool_block_indices:
                            idx = tool_block_indices[tool_use_id]
                            all_blocks[idx]["content"]["result"] = block_content.get("content", "")
                            all_blocks[idx]["content"]["is_error"] = block_content.get("is_error", False)
                            all_blocks[idx]["status"] = "error" if block_content.get("is_error") else "success"
                    
                    # Handle thinking
                    elif event_type == "thinking":
                        all_blocks.append({
                            "id": f"thinking-{event_count}",
                            "type": "thinking",
                            "content": event_dict.get("content", ""),
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Handle todos/plan
                    elif event_type == "todos":
                        all_blocks.append({
                            "id": f"todos-{event_count}",
                            "type": "plan",
                            "content": event_dict.get("content", {}),
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Handle ask_user
                    elif event_type == "ask_user":
                        content = event_dict.get("content", {})
                        all_blocks.append({
                            "id": f"ask-user-{content.get('request_id', event_count)}",
                            "type": "ask_user",
                            "content": {"input": content},
                            "status": "success",
                            "metadata": {"requestId": content.get("request_id", "")},
                        })
                    
                    yield event_dict
                
                # Save assistant response after completion
                if assistant_content or all_blocks:
                    assistant_msg = SessionMessage.create(
                        role="assistant",
                        content=assistant_content,
                        blocks=all_blocks if all_blocks else None,
                    )
                    storage_session.add_message(assistant_msg)
                    storage_session.last_model_name = effective_model
                    storage_session.last_endpoint_name = effective_endpoint or "(legacy)"
                    session_storage.save_session(storage_session)
                
                logger.info(f"[Multiplexed] Task completed for session {session_id}")
                
            except Exception as e:
                logger.error(f"[Multiplexed] Task error for session {session_id}: {e}", exc_info=True)
                yield {"type": "error", "content": str(e), "metadata": {"error_type": type(e).__name__}}
        
        # Start the background task
        task_id = await task_runner.start_task(
            session_id=storage_session.id,
            prompt=message.content,
            task_coroutine=task_coroutine,
        )
        
        return storage_session.id, task_id
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                parsed = json.loads(data)
                msg_type = parsed.get("type", "query")
                
                # Handle user_response for AskUserQuestion
                if msg_type == "user_response":
                    request_id = parsed.get("request_id")
                    answers = parsed.get("answers", {})
                    logger.info(f"[Multiplexed] Received user_response for: {request_id}")
                    await user_input_handler.receive_user_response(request_id, answers)
                    continue
                
                # Handle permission_response
                if msg_type == "permission_response":
                    request_id = parsed.get("request_id")
                    approved = parsed.get("approved", False)
                    logger.info(f"[Multiplexed] Received permission_response for: {request_id}")
                    await user_input_handler.receive_permission_response(request_id, approved)
                    continue
                
                # Handle subscribe request
                if msg_type == "subscribe":
                    session_id = parsed.get("session_id")
                    if session_id and session_id not in subscriptions:
                        task = asyncio.create_task(subscribe_to_session(session_id))
                        subscriptions[session_id] = task
                        logger.info(f"[Multiplexed] Subscribed to session: {session_id}")
                        
                        # Mark as viewed when subscribing
                        task_runner.mark_viewed(session_id)
                    continue
                
                # Handle unsubscribe request
                if msg_type == "unsubscribe":
                    session_id = parsed.get("session_id")
                    if session_id and session_id in subscriptions:
                        subscriptions[session_id].cancel()
                        subscriptions.pop(session_id, None)
                        logger.info(f"[Multiplexed] Unsubscribed from session: {session_id}")
                    continue
                
                # Handle query (start new task)
                if msg_type == "query":
                    message = ChatMessage.model_validate(parsed)
                    session_id = message.session_id
                    
                    # Check if session already has a running task
                    if session_id and task_runner.is_running(session_id):
                        await websocket.send_json({
                            "type": "error",
                            "content": "Session already has a running task",
                            "metadata": {"session_id": session_id}
                        })
                        continue
                    
                    try:
                        actual_session_id, task_id = await start_task_for_session(
                            session_id or "", message
                        )
                        
                        # Auto-subscribe to the new task
                        if actual_session_id not in subscriptions:
                            task = asyncio.create_task(subscribe_to_session(actual_session_id))
                            subscriptions[actual_session_id] = task
                        
                        # Send task started confirmation
                        await websocket.send_json({
                            "type": "task_started",
                            "content": {"task_id": task_id},
                            "metadata": {"session_id": actual_session_id}
                        })
                        
                    except Exception as e:
                        logger.error(f"[Multiplexed] Failed to start task: {e}", exc_info=True)
                        await websocket.send_json({
                            "type": "error",
                            "content": str(e),
                            "metadata": {"session_id": session_id, "error_type": type(e).__name__}
                        })
                    continue
                
            except json.JSONDecodeError as e:
                logger.error(f"[Multiplexed] Invalid JSON: {e}")
                await websocket.send_json({
                    "type": "error",
                    "content": f"Invalid JSON: {e}",
                    "metadata": {}
                })
            except Exception as e:
                logger.error(f"[Multiplexed] Error processing message: {e}", exc_info=True)
                await websocket.send_json({
                    "type": "error",
                    "content": str(e),
                    "metadata": {"error_type": type(e).__name__}
                })
    
    except WebSocketDisconnect:
        logger.info("[Multiplexed] WebSocket disconnected by client")
    except Exception as e:
        logger.error(f"[Multiplexed] WebSocket error: {e}", exc_info=True)
    finally:
        # Cancel all active subscriptions
        for session_id, task in subscriptions.items():
            task.cancel()
        logger.info("[Multiplexed] WebSocket closed, subscriptions cancelled")



