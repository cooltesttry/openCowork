"""
FastAPI application entry point.
"""
import json
import logging
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import agent, config
from models.settings import AppSettings


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
                return AppSettings.model_validate(data)
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
    # Load settings on startup
    app.state.settings = load_settings()
    yield
    # Save settings on shutdown
    save_settings(app.state.settings)


# Create FastAPI app
app = FastAPI(
    title="Claude Agent Client",
    description="A client for Claude Agent SDK with Web UI",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(agent.router, prefix="/api", tags=["agent"])
app.include_router(config.router, prefix="/api/config", tags=["config"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
# Trigger reload
