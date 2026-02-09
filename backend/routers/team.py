"""Agent Team API Router.

Provides endpoints for starting, monitoring, and canceling Team Agent sessions.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from super_agent.team.team_orchestrator import TeamOrchestrator
from super_agent.worker import ClaudeSdkWorker
from super_agent.models import WorkerConfig as SAWorkerConfig
from super_agent.events import (
    EventType,
    get_or_create_manager,
    remove_manager,
)

from routers.agents import load_agents
from routers.super_agent import get_worker_config

router = APIRouter()
logger = logging.getLogger(__name__)

# Running tasks registry
_running_tasks: dict[str, asyncio.Task] = {}

# Base directory for team sessions
TEAM_BASE_DIR = Path(__file__).parent.parent.parent / "storage" / "super_agent"


# ============== Request/Response Models ==============

class TeamRunRequest(BaseModel):
    objective: str = Field(..., description="The task/objective for the team")
    lead_worker_id: str = Field(..., description="Worker ID for the Lead Agent")


class TeamRunResponse(BaseModel):
    session_id: str


class TeamCancelResponse(BaseModel):
    session_id: str
    status: str


# ============== Helper Functions ==============

def _get_worker_types_info() -> list[dict]:
    """Get summary info of all worker types for the planning prompt."""
    data = load_agents()
    types = []
    for w in data.get("workers", []):
        description = w.get("prompt", {}).get("system", "")[:500]
        user_prompt = w.get("prompt", {}).get("user", "")
        if user_prompt:
            description += f"\nDefault user prompt: {user_prompt[:200]}"
        types.append({
            "id": w.get("id", ""),
            "name": w.get("name", ""),
            "model": w.get("model", ""),
            "tools_allow": w.get("tools_allow", []),
            "description": description,
        })
    return types


def _get_available_worker_configs(request: Request) -> dict[str, SAWorkerConfig]:
    """Load all worker configs as a map of id -> WorkerConfig."""
    data = load_agents()
    configs = {}
    for w in data.get("workers", []):
        worker_id = w.get("id", "")
        if worker_id:
            try:
                configs[worker_id] = get_worker_config(worker_id, request)
            except HTTPException:
                logger.warning(f"[Team] Failed to load worker config: {worker_id}")
    return configs


async def _run_team_session(
    orchestrator: TeamOrchestrator,
    session_id: str,
    available_worker_configs: dict[str, SAWorkerConfig],
    worker_types_info: list[dict],
):
    """Background task to run a Team session."""
    event_manager = await get_or_create_manager(session_id)
    orchestrator.event_manager = event_manager

    try:
        logger.info(f"[Team] Starting session: {session_id}")
        await event_manager.emit(EventType.TEAM_SESSION_START, {
            "session_id": session_id,
        })

        await orchestrator.run_async(
            session_id=session_id,
            available_worker_configs=available_worker_configs,
            worker_types_info=worker_types_info,
        )

        logger.info(f"[Team] Session completed: {session_id}")
    except Exception as e:
        logger.error(f"[Team] Session failed: {session_id}, error: {e}")
        await event_manager.emit(EventType.TEAM_SESSION_ERROR, {
            "session_id": session_id,
            "error": str(e),
        })
    finally:
        _running_tasks.pop(session_id, None)
        await asyncio.sleep(5)
        await remove_manager(session_id)


# ============== API Endpoints ==============

@router.post("/run", response_model=TeamRunResponse, status_code=201)
async def start_team_run(req: TeamRunRequest, request: Request):
    """Start a new Team Agent session."""
    lead_config = get_worker_config(req.lead_worker_id, request)
    available_configs = _get_available_worker_configs(request)
    worker_types_info = _get_worker_types_info()

    TEAM_BASE_DIR.mkdir(parents=True, exist_ok=True)
    orchestrator = TeamOrchestrator(
        base_dir=TEAM_BASE_DIR,
        worker_factory=lambda: ClaudeSdkWorker(),
    )

    session = orchestrator.create_session(
        objective=req.objective,
        lead_config=lead_config,
    )

    task_handle = asyncio.create_task(
        _run_team_session(orchestrator, session.session_id, available_configs, worker_types_info)
    )
    _running_tasks[session.session_id] = task_handle

    logger.info(f"[Team] Created session: {session.session_id}")
    return TeamRunResponse(session_id=session.session_id)


@router.get("/session/{session_id}")
async def get_team_session(session_id: str):
    """Get the full state of a Team session."""
    from super_agent.team.persistence import TeamSessionStore
    store = TeamSessionStore(TEAM_BASE_DIR)
    session = store.load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    return session.to_dict()


@router.post("/session/{session_id}/cancel", response_model=TeamCancelResponse)
async def cancel_team_session(session_id: str):
    """Cancel a running Team session."""
    from super_agent.team.persistence import TeamSessionStore
    store = TeamSessionStore(TEAM_BASE_DIR)
    session = store.load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    # Cancel the asyncio task
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
        session.error = "Cancelled by user"
        store.save_session(session)

    return TeamCancelResponse(session_id=session_id, status=session.status)


@router.get("/sessions")
async def list_team_sessions():
    """List all Team sessions."""
    from super_agent.team.persistence import TeamSessionStore
    store = TeamSessionStore(TEAM_BASE_DIR)
    return {"sessions": store.list_sessions()}


@router.websocket("/ws/{session_id}")
async def websocket_team_events(websocket: WebSocket, session_id: str):
    """WebSocket for real-time Team session events."""
    event_manager = await get_or_create_manager(session_id)
    await event_manager.connect(websocket)

    logger.info(f"[Team] WebSocket connected for session: {session_id}")

    try:
        while True:
            try:
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text('{"type": "pong"}')
            except WebSocketDisconnect:
                logger.info(f"[Team] WebSocket disconnected for session: {session_id}")
                break
    finally:
        await event_manager.disconnect(websocket)


@router.get("/worker-types")
async def get_worker_types():
    """Get all available worker types for the planning UI."""
    return {"worker_types": _get_worker_types_info()}
