"""
User Input Handler for AskUserQuestion tool support.

This module manages the bidirectional communication between the Claude Agent SDK
and the frontend when Claude needs to ask clarifying questions.
"""
import asyncio
import logging
from typing import Optional, Any
from dataclasses import dataclass
from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class UserInputRequest:
    """Represents a pending user input request."""
    request_id: str
    questions: list[dict]
    future: asyncio.Future
    websocket: WebSocket
    session_id: str = ""  # For result event caching


class UserInputHandler:
    """
    Manages user input requests from the Claude Agent SDK.
    
    When Claude uses the AskUserQuestion tool, this handler:
    1. Sends the questions to the frontend via WebSocket
    2. Waits for the user's response (with timeout)
    3. Returns the response to the SDK
    """
    
    def __init__(self):
        self._pending_requests: dict[str, UserInputRequest] = {}
        self._lock = asyncio.Lock()
    
    async def request_user_input(
        self, 
        request_id: str, 
        questions: list[dict], 
        websocket: WebSocket,
        session_id: str = "",
        timeout: float = 55.0  # Leave 5 seconds buffer for SDK's 60s timeout
    ) -> Optional[dict]:
        """
        Send questions to frontend and wait for user response.
        
        Args:
            request_id: Unique identifier for this request
            questions: List of questions from Claude
            websocket: WebSocket connection to send the request
            session_id: Session ID for event routing
            timeout: Maximum seconds to wait for response
            
        Returns:
            User's answers dict, or None if timeout/cancelled
        """
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        
        # Store pending request
        async with self._lock:
            self._pending_requests[request_id] = UserInputRequest(
                request_id=request_id,
                questions=questions,
                future=future,
                websocket=websocket,
                session_id=session_id,
            )
        
        try:
            # Build the ask_user event
            ask_user_event = {
                "type": "ask_user",
                "content": {
                    "request_id": request_id,
                    "questions": questions,
                    "timeout": timeout,
                },
                "metadata": {
                    "session_id": session_id,
                }
            }
            
            # Save to task_runner event cache - this also notifies subscribers
            # Only send directly via websocket if NOT using task_runner
            if session_id:
                from core.task_runner import task_runner
                task_runner._append_event(session_id, ask_user_event)
                # task_runner._append_event notifies subscribers, so no need to send again
            else:
                # Fallback: send directly if no session_id
                await websocket.send_json(ask_user_event)
            logger.info(f"[UserInput] Sent ask_user request: {request_id} (session: {session_id})")
            
            # Wait for response with timeout
            try:
                answers = await asyncio.wait_for(future, timeout=timeout)
                logger.info(f"[UserInput] Received response for: {request_id}")
                
                # Save response result event to cache
                if session_id and answers:
                    from core.task_runner import task_runner
                    result_event = {
                        "type": "ask_user_result",
                        "content": {
                            "request_id": request_id,
                            "status": "answered",
                            "answers": answers,
                        },
                        "metadata": {
                            "session_id": session_id,
                        }
                    }
                    task_runner._append_event(session_id, result_event)
                
                return answers
            except asyncio.TimeoutError:
                logger.warning(f"[UserInput] Request timed out: {request_id}")
                
                # Save timeout result event to cache
                if session_id:
                    from core.task_runner import task_runner
                    timeout_event = {
                        "type": "ask_user_result",
                        "content": {
                            "request_id": request_id,
                            "status": "timeout",
                        },
                        "metadata": {
                            "session_id": session_id,
                        }
                    }
                    task_runner._append_event(session_id, timeout_event)
                
                return None
                
        finally:
            # Clean up pending request
            async with self._lock:
                self._pending_requests.pop(request_id, None)
    
    async def receive_user_response(self, request_id: str, answers: dict) -> bool:
        """
        Receive user's response from frontend.
        
        Args:
            request_id: The request ID this response is for
            answers: User's answers dict
            
        Returns:
            True if response was received, False if request not found
        """
        async with self._lock:
            request = self._pending_requests.get(request_id)
            
        if not request:
            logger.warning(f"[UserInput] No pending request for: {request_id}")
            return False
        
        if not request.future.done():
            request.future.set_result(answers)
            logger.info(f"[UserInput] Resolved request: {request_id}")
            return True
        else:
            logger.warning(f"[UserInput] Request already resolved: {request_id}")
            return False
    
    async def cancel_request(self, request_id: str) -> bool:
        """Cancel a pending request (e.g., user clicked skip)."""
        async with self._lock:
            request = self._pending_requests.get(request_id)
            
        if not request:
            return False
        
        if not request.future.done():
            # Save skip result event to cache
            if request.session_id:
                from core.task_runner import task_runner
                skip_event = {
                    "type": "ask_user_result",
                    "content": {
                        "request_id": request_id,
                        "status": "skipped",
                    },
                    "metadata": {
                        "session_id": request.session_id,
                    }
                }
                task_runner._append_event(request.session_id, skip_event)
            
            request.future.set_result(None)
            logger.info(f"[UserInput] Cancelled request: {request_id}")
            return True
        return False
    
    async def request_permission(
        self,
        request_id: str,
        websocket: WebSocket,
        tool_name: str,
        timeout: float = 120.0,
    ) -> bool:
        """
        Wait for user to approve/deny a tool permission request.
        
        The permission_request event should already be sent by the caller.
        This just waits for the response.
        
        Args:
            request_id: Unique identifier for this permission request
            websocket: WebSocket connection
            tool_name: Name of the tool requesting permission
            timeout: Maximum seconds to wait for response
            
        Returns:
            True if approved, False if denied or timeout
        """
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        
        # Store pending request (reuse UserInputRequest structure)
        async with self._lock:
            self._pending_requests[request_id] = UserInputRequest(
                request_id=request_id,
                questions=[{"type": "permission", "tool_name": tool_name}],
                future=future,
                websocket=websocket,
            )
        
        try:
            # Wait for response with timeout
            try:
                result = await asyncio.wait_for(future, timeout=timeout)
                # Result is True for approved, False/None for denied
                approved = bool(result) if result is not None else False
                logger.info(f"[Permission] Received response for: {request_id}, approved={approved}")
                return approved
            except asyncio.TimeoutError:
                logger.warning(f"[Permission] Request timed out: {request_id}")
                return False
                
        finally:
            # Clean up pending request
            async with self._lock:
                self._pending_requests.pop(request_id, None)
    
    async def receive_permission_response(self, request_id: str, approved: bool) -> bool:
        """
        Receive user's permission response from frontend.
        
        Args:
            request_id: The request ID this response is for
            approved: Whether user approved the tool
            
        Returns:
            True if response was received, False if request not found
        """
        async with self._lock:
            request = self._pending_requests.get(request_id)
            
        if not request:
            logger.warning(f"[Permission] No pending request for: {request_id}")
            return False
        
        if not request.future.done():
            request.future.set_result(approved)
            logger.info(f"[Permission] Resolved request: {request_id}, approved={approved}")
            return True
        else:
            logger.warning(f"[Permission] Request already resolved: {request_id}")
            return False


# Global instance for the application
user_input_handler = UserInputHandler()
