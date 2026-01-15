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
from models.settings import AppSettings


# Set up logging (configured centrally in main.py)
logger = logging.getLogger(__name__)

router = APIRouter()


class ChatMessage(BaseModel):
    """Chat message from client."""
    content: str
    cwd: Optional[str] = None


@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """
    WebSocket endpoint for real-time agent chat.
    
    Protocol:
    - Client sends JSON: {"content": "user message", "cwd": "/optional/path"}
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
            
            # Stream agent response
            event_count = 0
            logger.info(f"Starting agent stream for prompt: {message.content[:100]}...")
            
            try:
                async for event in stream_agent_response(
                    prompt=message.content,
                    settings=settings,
                    cwd=message.cwd,
                ):
                    event_count += 1
                    event_dict = event.to_dict()
                    event_type = event_dict.get("type", "unknown")
                    
                    # Log each event (abbreviated for large content)
                    content_preview = str(event_dict.get("content", ""))[:100]
                    logger.debug(f"Event #{event_count}: type={event_type}, content={content_preview}...")
                    
                    # Log important events at INFO level
                    if event_type in ["tool_use", "tool_result", "done", "error"]:
                        logger.info(f"Event #{event_count}: type={event_type}")
                    
                    await websocket.send_json(event_dict)
                
                logger.info(f"Agent stream completed. Total events sent: {event_count}")
                
            except Exception as stream_error:
                logger.error(f"Error during agent streaming: {stream_error}", exc_info=True)
                await websocket.send_json({
                    "type": "error",
                    "content": f"Stream error: {stream_error}",
                    "metadata": {"error_type": type(stream_error).__name__}
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
