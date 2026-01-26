"""
Super Agent API Router.

Provides endpoints for starting, monitoring, and canceling Super Agent sessions.
Uses the AsyncOrchestrator from super_agent module.
"""
import asyncio
import logging
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect, Request

# Import from super_agent module
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from super_agent.orchestrator import AsyncOrchestrator
from super_agent.worker import ClaudeSdkWorker
# ReflectiveChecker no longer used - Checker uses Worker directly
from super_agent.models import TaskDefinition, WorkerConfig as SAWorkerConfig
from super_agent.persistence import SessionStore
from super_agent.events import (
    EventType,
    SessionEventManager,
    get_or_create_manager,
    remove_manager,
    get_manager_sync,
)

from routers.agents import load_agents

router = APIRouter()
logger = logging.getLogger(__name__)

# Global store for tracking running tasks
# Key: session_id, Value: asyncio.Task
_running_tasks: dict[str, asyncio.Task] = {}

# Base directory for Super Agent sessions
SUPER_AGENT_BASE_DIR = Path(__file__).parent.parent.parent / "super_agent" / "workspace"


# ============== Request/Response Models ==============

class RunRequest(BaseModel):
    """Request body for starting a new Super Agent run."""
    task_objective: str = Field(..., description="The task description")
    worker_id: str = Field(..., description="ID of the Worker template to use")
    max_cycles: int = Field(default=3, ge=1, le=10, description="Maximum iteration cycles")
    initial_input: dict = Field(default_factory=dict, description="Initial context for the Worker")


class RunResponse(BaseModel):
    """Response for a newly started run."""
    session_id: str


class CancelResponse(BaseModel):
    """Response for a cancelled session."""
    session_id: str
    status: str


# ============== Helper Functions ==============

def get_orchestrator(worker_config: SAWorkerConfig, checker_config: SAWorkerConfig = None) -> AsyncOrchestrator:
    """Create a new AsyncOrchestrator with Claude SDK worker and Worker-based checker."""
    SUPER_AGENT_BASE_DIR.mkdir(parents=True, exist_ok=True)
    return AsyncOrchestrator(
        base_dir=SUPER_AGENT_BASE_DIR,
        worker=ClaudeSdkWorker(),
        checker=None,  # No longer using ReflectiveChecker
        checker_config=checker_config,  # Worker-based checker config
        cycle_wait_seconds=1,
    )


def get_worker_config(worker_id: str, request=None) -> SAWorkerConfig:
    """Load worker config from agents.json and convert to super_agent.models.WorkerConfig.
    
    Handles MCP inheritance:
    - If mcp_inherit_system=True: load all MCP servers from system settings
    - Else: filter system MCP servers by mcp_selected list
    
    Always blocks WebSearch and WebFetch tools for Agent Sessions.
    """
    data = load_agents()
    
    for worker in data.get("workers", []):
        if worker.get("id") == worker_id:
            # Get MCP servers based on inheritance settings
            mcp_inherit_system = worker.get("mcp_inherit_system", True)
            mcp_selected = worker.get("mcp_selected", [])
            
            # Load system MCP servers if we have access to app state
            mcp_servers = []
            search_config = None
            if request and hasattr(request, 'app') and hasattr(request.app, 'state'):
                system_mcp = getattr(request.app.state.settings, 'mcp_servers', [])
                search_config = getattr(request.app.state.settings, 'search', None)
                
                if mcp_inherit_system:
                    # Use all system MCP servers
                    mcp_servers = [{"name": s.name, "command": s.command, "args": s.args, "env": s.env} 
                                   for s in system_mcp]
                else:
                    # Filter by selected names
                    mcp_servers = [{"name": s.name, "command": s.command, "args": s.args, "env": s.env} 
                                   for s in system_mcp if s.name in mcp_selected]
                
                # Check if search-tools is selected and configured
                if "search-tools" in mcp_selected or mcp_inherit_system:
                    if search_config and search_config.enabled and search_config.api_key:
                        import sys
                        import os
                        server_script = os.path.join(
                            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
                            "core", "run_search_server.py"
                        )
                        mcp_servers.append({
                            "name": "search-tools",
                            "command": sys.executable,
                            "args": [server_script],
                            "env": {
                                **os.environ,
                                "PYTHONUNBUFFERED": "1"
                            }
                        })
            else:
                # Fallback to worker's own mcp_servers if no request context
                mcp_servers = worker.get("mcp_servers", [])
            
            # Always block WebSearch and WebFetch for Agent Sessions
            tools_block = list(worker.get("tools_block", []))
            for tool in ["WebSearch", "WebFetch"]:
                if tool not in tools_block:
                    tools_block.append(tool)
            
            # Convert to super_agent WorkerConfig
            return SAWorkerConfig(
                id=worker.get("id", "unknown"),
                name=worker.get("name", worker.get("id", "unknown")),
                model=worker.get("model", "claude-3-5-sonnet-20241022"),
                provider=worker.get("provider"),
                api_key=worker.get("api_key"),
                endpoint=worker.get("endpoint"),
                mcp_servers=mcp_servers,
                prompt=worker.get("prompt", {}),
                tools_allow=worker.get("tools_allow", []),
                tools_block=tools_block,
                env=worker.get("env", {}),
                cwd=worker.get("cwd"),
                max_turns=worker.get("max_turns", 10),
                max_tokens=worker.get("max_tokens", 8000),
                max_thinking_tokens=worker.get("max_thinking_tokens", 0),
                setting_sources=worker.get("setting_sources", ["project"]),
                permission_mode=worker.get("permission_mode", "bypassPermissions"),
                include_partial_messages=worker.get("include_partial_messages", False),
                output_format=worker.get("output_format"),
            )
    
    raise HTTPException(status_code=404, detail=f"Worker '{worker_id}' not found")


async def run_session_async(orchestrator: AsyncOrchestrator, session_id: str, event_manager: SessionEventManager):
    """Background task to run a Super Agent session."""
    try:
        logger.info(f"[SuperAgent] Starting session: {session_id}")
        
        # Load session to get config for event
        session = orchestrator.store.load_session(session_id)
        config = session.worker_config if session else None
        
        await event_manager.emit(EventType.SESSION_START, {
            "session_id": session_id,
            "model": config.model if config else None,
            "provider": config.provider if config else None,
            "endpoint": config.endpoint if config else None,
            "mcp_servers": [s.get("name", s) if isinstance(s, dict) else s for s in config.mcp_servers] if config and config.mcp_servers else [],
            "max_turns": config.max_turns if config else None,
            "tools_allow": config.tools_allow if config else None,
            "prompt": config.prompt if config else None,
            "objective": session.task.objective if session and session.task else None,
        })
        
        # Inject event manager into orchestrator
        orchestrator.event_manager = event_manager
        
        await orchestrator.run_async(session_id)
        
        await event_manager.emit(EventType.SESSION_COMPLETE, {"session_id": session_id})
        logger.info(f"[SuperAgent] Session completed: {session_id}")
    except Exception as e:
        logger.error(f"[SuperAgent] Session failed: {session_id}, error: {e}")
        await event_manager.emit(EventType.SESSION_ERROR, {"session_id": session_id, "error": str(e)})
    finally:
        # Cleanup running task reference
        _running_tasks.pop(session_id, None)
        # Keep event manager alive for a bit so clients can see final state
        await asyncio.sleep(5)
        await remove_manager(session_id)


# ============== API Endpoints ==============

@router.post("/run", response_model=RunResponse, status_code=201)
async def start_run(run_request: RunRequest, request: Request):
    """
    Start a new Super Agent run.
    
    The run executes asynchronously in the background.
    Use GET /session/{session_id} to poll for status.
    """
    # Load worker config with MCP settings from system
    worker_config = get_worker_config(run_request.worker_id, request)
    
    # Create task definition
    import uuid
    task_id = str(uuid.uuid4())[:8]
    task = TaskDefinition(
        task_id=task_id,
        name=f"Task {task_id}",
        objective=run_request.task_objective,
        inputs=run_request.initial_input,
        expected_output={},  # Will be defined by output protocol
    )
    
    # Create orchestrator and session
    # Load checker worker config (worker ID 'checker')
    try:
        checker_config = get_worker_config("checker", request)
    except KeyError:
        logger.warning("[SuperAgent] 'checker' worker not found, using main worker for checker")
        checker_config = worker_config
    
    orchestrator = get_orchestrator(worker_config, checker_config)
    session = orchestrator.create_session(
        task=task,
        worker_config=worker_config,
        input_payload=run_request.initial_input,
        max_cycles=run_request.max_cycles,
    )
    
    # Create event manager for this session
    event_manager = await get_or_create_manager(session.session_id)
    
    # Start background task with event manager
    task_handle = asyncio.create_task(run_session_async(orchestrator, session.session_id, event_manager))
    _running_tasks[session.session_id] = task_handle
    
    logger.info(f"[SuperAgent] Created session: {session.session_id} for worker: {run_request.worker_id}")
    
    return RunResponse(session_id=session.session_id)


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """
    Get the current state of a Super Agent session.
    
    This is the polling endpoint. Frontend should call this every 1000ms until
    status is 'completed', 'failed', or 'cancelled'.
    """
    store = SessionStore(SUPER_AGENT_BASE_DIR)
    session = store.load_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    
    # Convert to JSON-serializable dict
    return {
        "session_id": session.session_id,
        "status": session.status,
        "cycle_count": session.cycle_count,
        "max_cycles": session.max_cycles,
        "last_error": session.last_error,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "history": [
            {
                "cycle_index": cycle.cycle_index,
                "started_at": cycle.started_at,
                "ended_at": cycle.ended_at,
                "result": {
                    "text": cycle.llm_result.text,
                    "tool_calls": cycle.llm_result.tool_calls,
                    "tool_results": cycle.llm_result.tool_results,
                    "error": cycle.llm_result.error,
                },
                "summary": cycle.summary,
                "artifacts": cycle.artifacts,
                "passed": cycle.passed,
                "checker_reason": cycle.checker_reason,
            }
            for cycle in session.history
        ],
    }


@router.post("/session/{session_id}/cancel", response_model=CancelResponse)
async def cancel_session(session_id: str):
    """
    Cancel a running Super Agent session.
    
    If the session is still running, the background task is cancelled.
    The session status is updated to 'cancelled'.
    """
    store = SessionStore(SUPER_AGENT_BASE_DIR)
    session = store.load_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    
    # Cancel the running task if it exists
    task = _running_tasks.get(session_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        _running_tasks.pop(session_id, None)
    
    # Update session status
    if session.status not in ("completed", "failed"):
        session.status = "cancelled"
        session.last_error = "Cancelled by user"
        store.save_session(session)
    
    return CancelResponse(session_id=session_id, status=session.status)


@router.get("/sessions")
async def list_sessions():
    """
    List all Super Agent sessions.
    
    Returns a summary of all sessions (id, status, created_at).
    """
    store = SessionStore(SUPER_AGENT_BASE_DIR)
    sessions = store.list_sessions()
    
    return {
        "sessions": [
            {
                "session_id": s.session_id,
                "status": s.status,
                "cycle_count": s.cycle_count,
                "created_at": s.created_at,
            }
            for s in sessions
        ]
    }


@router.websocket("/ws/{session_id}")
async def websocket_session_events(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time session events.
    
    Connect to receive live updates as the session progresses:
    - cycle_start, cycle_end
    - worker_start, worker_tool_call, worker_complete
    - checker_start, checker_complete
    - session_complete, session_error
    """
    # Get or create event manager
    event_manager = await get_or_create_manager(session_id)
    
    # Connect this WebSocket
    await event_manager.connect(websocket)
    
    logger.info(f"[SuperAgent] WebSocket connected for session: {session_id}")
    
    try:
        # Keep connection alive and listen for client messages (if any)
        while True:
            try:
                # We don't expect client messages, but this keeps the connection alive
                data = await websocket.receive_text()
                # Could handle ping/pong or commands here
                if data == "ping":
                    await websocket.send_text('{"type": "pong"}')
            except WebSocketDisconnect:
                logger.info(f"[SuperAgent] WebSocket disconnected for session: {session_id}")
                break
    finally:
        await event_manager.disconnect(websocket)

