"""
FastAPI application entry point.
"""
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import agent, config, sessions, files, terminal, agents, super_agent, workspace, search, imagegen, skills, cliproxy, team
from models.settings import AppSettings
from core.session_manager import session_manager
from core.task_runner import task_runner
from core.workspace_storage import WorkspaceManager
from core.mcp_registry import (
    ensure_global_mcp_ids,
    migrate_all_workspace_mcp_configs,
    seed_workspace_mcp_defaults,
)


# Configure logging with file and console output
LOG_DIR = Path(__file__).parent
LOG_FILE = LOG_DIR / "debug.log"

def setup_logging():
    """Configure logging with file and console handlers."""
    # Create root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Log format
    log_format = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # File handler with rotation (max 10MB, keep 5 backups)
    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(log_format)
    root_logger.addHandler(file_handler)
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(log_format)
    root_logger.addHandler(console_handler)
    
    logging.info(f"Logging initialized. Log file: {LOG_FILE}")

# Initialize logging on module load
setup_logging()


# Storage path for configuration
STORAGE_DIR = Path(__file__).parent.parent / "storage"
CONFIG_FILE = STORAGE_DIR / "config.json"


def load_settings() -> AppSettings:
    """Load settings from config file or return defaults."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
                settings = AppSettings.model_validate(data)
                # Persist defaults if new fields were missing
                expected_keys = set(AppSettings().model_dump().keys())
                if any(key not in data for key in expected_keys):
                    save_settings(settings)
                return settings
        except Exception:
            pass
    return AppSettings()


def save_settings(settings: AppSettings) -> None:
    """Save settings to config file."""
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(settings.model_dump(), f, indent=2)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Import file watcher service
    from core.file_watcher import file_watcher_service, FileChangeEvent
    from core.search.index_service import search_index_service, IndexEvent
    from core.workspace_storage import WorkspaceManager

    logging.info(f"[Lifespan] Startup begin (pid={os.getpid()})")

    # Load settings on startup
    app.state.settings = load_settings()

    # Initialize workspace manager
    app.state.workspace_manager = WorkspaceManager(CONFIG_FILE)

    # Ensure global MCP servers have stable IDs
    global_changed = ensure_global_mcp_ids(app.state.settings)

    # Restore default_workdir from current workspace (if any)
    current_ws = app.state.workspace_manager.get_current_workspace()
    if current_ws:
        app.state.settings.default_workdir = current_ws.path
        logging.info(f"[Lifespan] Restored workdir from current workspace: {current_ws.path}")

    # Ensure default workspace exists and migrate legacy sessions
    default_path = app.state.settings.default_workdir
    default_storage = None
    if default_path:
        default_storage = app.state.workspace_manager.get_storage(default_path)
        default_config_exists = default_storage.config_file.exists()
    else:
        default_config_exists = False

    default_ws = app.state.workspace_manager.ensure_default_workspace(default_path)
    if default_ws:
        logging.info(f"[Lifespan] Default workspace: {default_ws.name} ({default_ws.path})")
        # Seed defaults only when workspace config did not exist before creation
        if default_storage and not default_config_exists:
            seeded = seed_workspace_mcp_defaults(default_storage, app.state.settings)
            if seeded:
                logging.info("[Lifespan] Seeded default workspace MCP list from global settings")

    # Migrate workspace MCP configs to ID-based enable lists
    ws_changed, ws_global_changed = migrate_all_workspace_mcp_configs(
        app.state.workspace_manager,
        app.state.settings,
    )

    if global_changed or ws_global_changed:
        save_settings(app.state.settings)

    # Start session manager for ClaudeSDKClient lifecycle management
    await session_manager.start()

    # Start task runner for background task execution
    await task_runner.start()

    disable_file_watcher = os.getenv("OPENCOWORK_DISABLE_FILE_WATCHER", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )

    async def handle_file_change(event: FileChangeEvent) -> None:
        await search_index_service.enqueue_event(
            IndexEvent(
                action=event.action,
                path=event.path,
                dest_path=event.dest_path,
                is_directory=event.is_directory,
                workdir=event.workdir,
            )
        )

    # Start file watchers for all known workspaces
    config_path = Path(__file__).parent.parent / "storage" / "config.json"
    manager = WorkspaceManager(config_path)
    app.state.workspace_manager = manager

    workdirs = [ws.get("path") for ws in manager.get_recent_workspaces() if ws.get("path")]
    if app.state.settings.default_workdir and app.state.settings.default_workdir not in workdirs:
        workdirs.append(app.state.settings.default_workdir)

    if disable_file_watcher:
        logging.info("[Lifespan] File watcher disabled via OPENCOWORK_DISABLE_FILE_WATCHER")
    else:
        if workdirs:
            file_watcher_service.register_handler(handle_file_change)
            await file_watcher_service.start(workdirs)
            logging.info(f"[Lifespan] File watcher started for {len(workdirs)} workspaces")
        else:
            logging.info("[Lifespan] No workspaces found for file watcher")

    await search_index_service.start()
    if workdirs:
        await search_index_service.register_workspaces(workdirs)

    # Start CLIProxyAPI sidecar unless disabled
    disable_cliproxy = os.getenv("OPENCOWORK_DISABLE_CLIPROXY", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if disable_cliproxy:
        logging.info("[Lifespan] CLIProxyAPI sidecar disabled via OPENCOWORK_DISABLE_CLIPROXY")
    else:
        try:
            from core import cliproxy_service
            await cliproxy_service.ensure_started_async()
            logging.info("[Lifespan] CLIProxyAPI sidecar started")
        except Exception as exc:
            logging.warning(f"[Lifespan] Failed to start CLIProxyAPI sidecar: {exc}")
    
    yield

    logging.info(f"[Lifespan] Shutdown begin (pid={os.getpid()})")

    # Cleanup on shutdown
    if not disable_file_watcher:
        file_watcher_service.unregister_handler(handle_file_change)
        await file_watcher_service.stop()
    await search_index_service.stop()
    await task_runner.stop()
    await session_manager.stop()
    try:
        from core import cliproxy_service
        await cliproxy_service.stop_async()
        logging.info("[Lifespan] CLIProxyAPI sidecar stopped")
    except Exception as exc:
        logging.warning(f"[Lifespan] Failed to stop CLIProxyAPI sidecar: {exc}")
    # Note: Settings are NOT auto-saved on shutdown.
    # Only explicit user saves should persist to config.json.

    logging.info(f"[Lifespan] Shutdown complete (pid={os.getpid()})")


# Create FastAPI app
app = FastAPI(
    title="Claude Agent Client",
    description="A client for Claude Agent SDK with Web UI",
    version="0.1.0",
    lifespan=lifespan,
)

# Include routers
app.include_router(agent.router, prefix="/api", tags=["agent"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(sessions.router, prefix="/api", tags=["sessions"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(terminal.router)
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(super_agent.router, prefix="/api/super-agent", tags=["super-agent"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(imagegen.router, prefix="/api/imagegen", tags=["imagegen"])
app.include_router(skills.router, prefix="/api", tags=["skills"])
app.include_router(cliproxy.router, prefix="/api", tags=["cliproxy"])
app.include_router(team.router, prefix="/api/team", tags=["team"])

# Configure CORS - must be after include_router to work correctly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
# Trigger reload
