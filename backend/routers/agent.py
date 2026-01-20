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
            tool_blocks: dict[str, dict] = {}
            thinking_blocks: list[dict] = []
            
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
                    
                    # Accumulate text content
                    if event_type == "text":
                        assistant_content += str(event_dict.get("content", ""))
                    
                    # Handle tool_use: create new block
                    elif event_type == "tool_use":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("id", f"tool-{event_count}")
                        tool_blocks[tool_use_id] = {
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
                    
                    # Handle tool_result: merge into existing tool_use block
                    elif event_type == "tool_result":
                        block_content = event_dict.get("content", {})
                        tool_use_id = block_content.get("tool_use_id", "")
                        if tool_use_id in tool_blocks:
                            tool_blocks[tool_use_id]["content"]["result"] = block_content.get("content", "")
                            tool_blocks[tool_use_id]["content"]["is_error"] = block_content.get("is_error", False)
                            tool_blocks[tool_use_id]["status"] = "error" if block_content.get("is_error") else "success"
                        else:
                            tool_blocks[tool_use_id] = {
                                "id": tool_use_id,
                                "type": "tool_use",
                                "content": {"result": block_content.get("content", "")},
                                "status": "success",
                                "metadata": {"toolCallId": tool_use_id},
                            }
                    
                    # Handle thinking blocks
                    elif event_type == "thinking":
                        thinking_blocks.append({
                            "id": f"thinking-{event_count}",
                            "type": "thinking",
                            "content": event_dict.get("content", ""),
                            "status": "success",
                            "metadata": {},
                        })
                    
                    # Add session_id to metadata and send to client
                    event_dict["metadata"]["session_id"] = storage_session.id
                    await websocket.send_json(event_dict)
                
                # Build final blocks list: thinking first, then tools
                assistant_blocks = thinking_blocks + list(tool_blocks.values())
                
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


