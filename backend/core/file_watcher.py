"""
File Watcher Service - WebSocket-based file system monitoring.
Uses watchdog for efficient file system event detection.
"""
import asyncio
import logging
import time
from pathlib import Path
from typing import Set, Dict, Any, Iterable, Awaitable, Callable
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
    workdir: str
    dest_path: str | None = None
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "type": "file_change",
            "action": self.action,
            "path": self.path,
            "is_directory": self.is_directory,
            "timestamp": self.timestamp
        }
        if self.dest_path:
            payload["dest_path"] = self.dest_path
        return payload


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
        parts = path_obj.parts
        for idx, part in enumerate(parts[:-1]):
            if part == ".opencowork" and parts[idx + 1] == "search":
                return True
        
        # Check if any part of the path is in ignored dirs
        for part in parts:
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
    
    def _handle_event(self, event: FileSystemEvent, action: str, dest_path: str | None = None):
        """Common handler for all event types."""
        if self._should_ignore(event.src_path):
            return
        
        relative_path = self._get_relative_path(event.src_path)
        relative_dest = None
        if dest_path and not self._should_ignore(dest_path):
            relative_dest = self._get_relative_path(dest_path)
        
        change_event = FileChangeEvent(
            action=action,
            path=relative_path,
            is_directory=event.is_directory,
            workdir=str(self.workdir),
            dest_path=relative_dest,
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
        dest_path = getattr(event, "dest_path", None)
        self._handle_event(event, "moved", dest_path=dest_path)


class FileWatcherService:
    """
    Singleton service for file system monitoring.
    Manages watchdog observer and WebSocket clients.
    """
    
    def __init__(self):
        self.observer: Observer | None = None
        self.clients: Set[WebSocket] = set()
        self.workdirs: list[str] = []
        self.loop: asyncio.AbstractEventLoop | None = None
        self._started = False
        self._event_handlers: Set[Callable[[FileChangeEvent], Awaitable[None]]] = set()
        
        # Debounce settings
        self._event_queue: list[FileChangeEvent] = []
        self._debounce_task: asyncio.Task | None = None
        self._debounce_delay = 0.5  # 500ms debounce
    
    async def start(self, workdir: str | Iterable[str]):
        """Start monitoring one or more directories."""
        if self._started:
            logger.warning("[FileWatcher] Already started, stopping first")
            await self.stop()

        self.loop = asyncio.get_event_loop()

        workdirs = [workdir] if isinstance(workdir, (str, Path)) else list(workdir)
        resolved: list[str] = []
        for entry in workdirs:
            try:
                path = str(Path(entry).resolve())
            except Exception:
                logger.warning(f"[FileWatcher] Invalid workdir entry: {entry}")
                continue
            if not Path(path).exists():
                logger.error(f"[FileWatcher] Workdir does not exist: {path}")
                continue
            resolved.append(path)

        if not resolved:
            logger.error("[FileWatcher] No valid workdirs to monitor")
            return

        self.workdirs = resolved

        # Create watchdog observer
        self.observer = Observer()
        for root in self.workdirs:
            handler = FileChangeHandler(self, root)
            self.observer.schedule(handler, root, recursive=True)

        self.observer.start()
        self._started = True

        logger.info(f"[FileWatcher] Started monitoring {len(self.workdirs)} workspaces")
    
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
        self.workdirs = []
        
        logger.info("[FileWatcher] Stopped")
    
    async def register_client(self, ws: WebSocket):
        """Register a WebSocket client to receive file change events."""
        self.clients.add(ws)
        logger.info(f"[FileWatcher] Client registered. Total clients: {len(self.clients)}")
    
    async def unregister_client(self, ws: WebSocket):
        """Unregister a WebSocket client."""
        self.clients.discard(ws)
        logger.info(f"[FileWatcher] Client unregistered. Total clients: {len(self.clients)}")

    def register_handler(self, handler: Callable[[FileChangeEvent], Awaitable[None]]) -> None:
        """Register an async handler for file change events."""
        self._event_handlers.add(handler)

    def unregister_handler(self, handler: Callable[[FileChangeEvent], Awaitable[None]]) -> None:
        """Unregister an async handler."""
        self._event_handlers.discard(handler)
    
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
        
        # Deduplicate events with priority so created isn't overwritten by modified.
        # Priority: deleted > moved > created > modified
        priority = {"modified": 0, "created": 1, "moved": 2, "deleted": 3}
        seen_paths: Dict[str, FileChangeEvent] = {}
        for event in events:
            existing = seen_paths.get(event.path)
            if not existing:
                seen_paths[event.path] = event
                continue
            if priority.get(event.action, 0) > priority.get(existing.action, 0):
                seen_paths[event.path] = event
            else:
                # Same or lower priority: keep existing (e.g., keep created over modified)
                continue
        
        unique_events = list(seen_paths.values())
        
        await self._dispatch_handlers(unique_events)

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

    async def _dispatch_handlers(self, events: list[FileChangeEvent]) -> None:
        if not self._event_handlers or not events:
            return
        handlers = list(self._event_handlers)
        tasks = []
        for event in events:
            for handler in handlers:
                tasks.append(asyncio.create_task(handler(event)))
        if not tasks:
            return
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                logger.warning("[FileWatcher] Handler error: %s", result)
    
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
