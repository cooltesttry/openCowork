"""
File Watcher Service - WebSocket-based file system monitoring.
Uses watchdog for efficient file system event detection.
"""
import asyncio
import logging
import time
from pathlib import Path
from typing import Set, Dict, Any
from dataclasses import dataclass, field

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent
from fastapi import WebSocket

logger = logging.getLogger(__name__)


# Directories and patterns to ignore
IGNORED_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', '.next', '.DS_Store'}
IGNORED_EXTENSIONS = {'.pyc', '.pyo', '.swp', '.swo', '.tmp'}


@dataclass
class FileChangeEvent:
    """Represents a file change event."""
    action: str  # created, deleted, modified, moved
    path: str  # relative path
    is_directory: bool
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": "file_change",
            "action": self.action,
            "path": self.path,
            "is_directory": self.is_directory,
            "timestamp": self.timestamp
        }


class FileChangeHandler(FileSystemEventHandler):
    """
    Watchdog event handler that forwards events to the FileWatcherService.
    """
    
    def __init__(self, service: 'FileWatcherService', workdir: str):
        self.service = service
        self.workdir = Path(workdir).resolve()
        super().__init__()
    
    def _should_ignore(self, path: str) -> bool:
        """Check if the path should be ignored."""
        path_obj = Path(path)
        
        # Check if any part of the path is in ignored dirs
        for part in path_obj.parts:
            if part in IGNORED_DIRS:
                return True
        
        # Check extension
        if path_obj.suffix in IGNORED_EXTENSIONS:
            return True
        
        return False
    
    def _get_relative_path(self, path: str) -> str:
        """Convert absolute path to relative path from workdir."""
        try:
            return str(Path(path).relative_to(self.workdir))
        except ValueError:
            return path
    
    def _handle_event(self, event: FileSystemEvent, action: str):
        """Common handler for all event types."""
        if self._should_ignore(event.src_path):
            return
        
        relative_path = self._get_relative_path(event.src_path)
        
        change_event = FileChangeEvent(
            action=action,
            path=relative_path,
            is_directory=event.is_directory
        )
        
        # Schedule the async broadcast
        asyncio.run_coroutine_threadsafe(
            self.service.queue_event(change_event),
            self.service.loop
        )
    
    def on_created(self, event: FileSystemEvent):
        self._handle_event(event, "created")
    
    def on_deleted(self, event: FileSystemEvent):
        self._handle_event(event, "deleted")
    
    def on_modified(self, event: FileSystemEvent):
        # Skip directory modification events (too noisy)
        if event.is_directory:
            return
        self._handle_event(event, "modified")
    
    def on_moved(self, event: FileSystemEvent):
        self._handle_event(event, "moved")


class FileWatcherService:
    """
    Singleton service for file system monitoring.
    Manages watchdog observer and WebSocket clients.
    """
    
    def __init__(self):
        self.observer: Observer | None = None
        self.clients: Set[WebSocket] = set()
        self.workdir: str | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._started = False
        
        # Debounce settings
        self._event_queue: list[FileChangeEvent] = []
        self._debounce_task: asyncio.Task | None = None
        self._debounce_delay = 0.5  # 500ms debounce
    
    async def start(self, workdir: str):
        """Start monitoring the specified directory."""
        if self._started:
            logger.warning("[FileWatcher] Already started, stopping first")
            await self.stop()
        
        self.workdir = str(Path(workdir).resolve())
        self.loop = asyncio.get_event_loop()
        
        if not Path(self.workdir).exists():
            logger.error(f"[FileWatcher] Workdir does not exist: {self.workdir}")
            return
        
        # Create watchdog observer
        self.observer = Observer()
        handler = FileChangeHandler(self, self.workdir)
        
        self.observer.schedule(handler, self.workdir, recursive=True)
        self.observer.start()
        self._started = True
        
        logger.info(f"[FileWatcher] Started monitoring: {self.workdir}")
    
    async def stop(self):
        """Stop monitoring."""
        if self.observer:
            self.observer.stop()
            self.observer.join(timeout=2)
            self.observer = None
        
        if self._debounce_task:
            self._debounce_task.cancel()
            self._debounce_task = None
        
        self._started = False
        self._event_queue.clear()
        
        logger.info("[FileWatcher] Stopped")
    
    async def register_client(self, ws: WebSocket):
        """Register a WebSocket client to receive file change events."""
        self.clients.add(ws)
        logger.info(f"[FileWatcher] Client registered. Total clients: {len(self.clients)}")
    
    async def unregister_client(self, ws: WebSocket):
        """Unregister a WebSocket client."""
        self.clients.discard(ws)
        logger.info(f"[FileWatcher] Client unregistered. Total clients: {len(self.clients)}")
    
    async def queue_event(self, event: FileChangeEvent):
        """Queue an event for debounced broadcast."""
        self._event_queue.append(event)
        
        # Cancel existing debounce task
        if self._debounce_task:
            self._debounce_task.cancel()
        
        # Schedule new debounce
        self._debounce_task = asyncio.create_task(self._debounced_broadcast())
    
    async def _debounced_broadcast(self):
        """Wait for debounce delay then broadcast all queued events."""
        await asyncio.sleep(self._debounce_delay)
        
        if not self._event_queue:
            return
        
        # Collect all events
        events = self._event_queue.copy()
        self._event_queue.clear()
        
        # Deduplicate events (keep last event for each path)
        seen_paths: Dict[str, FileChangeEvent] = {}
        for event in events:
            seen_paths[event.path] = event
        
        unique_events = list(seen_paths.values())
        
        if len(unique_events) == 1:
            # Single event - send as file_change
            await self.broadcast(unique_events[0].to_dict())
        else:
            # Multiple events - send as files_changed batch
            await self.broadcast({
                "type": "files_changed",
                "changes": [e.to_dict() for e in unique_events],
                "timestamp": time.time()
            })
    
    async def broadcast(self, data: Dict[str, Any]):
        """Broadcast event to all connected clients."""
        if not self.clients:
            return
        
        logger.debug(f"[FileWatcher] Broadcasting to {len(self.clients)} clients: {data.get('type')}")
        
        disconnected = set()
        for ws in self.clients:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.warning(f"[FileWatcher] Failed to send to client: {e}")
                disconnected.add(ws)
        
        # Clean up disconnected clients
        for ws in disconnected:
            self.clients.discard(ws)


# Singleton instance
file_watcher_service = FileWatcherService()
