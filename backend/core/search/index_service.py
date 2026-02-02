from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable

from core.search.indexer import SearchIndex
from core.search.extractors import _is_probably_binary, MARKITDOWN_EXTENSIONS

logger = logging.getLogger(__name__)


@dataclass
class IndexEvent:
    action: str
    path: str
    dest_path: str | None
    is_directory: bool
    workdir: str


class SearchIndexService:
    def __init__(self):
        self._pending: Dict[str, Dict[str, IndexEvent]] = {}
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._started = False
        self._event_debounce = 0.6
        self._modified_quiet_window = 60.0
        self._modified_tasks: Dict[tuple[str, str], asyncio.Task] = {}

        self._metadata_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self._embedding_queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
        self._metadata_task: asyncio.Task | None = None
        self._embedding_task: asyncio.Task | None = None

    async def start(self):
        if self._started:
            return
        self._started = True
        self._metadata_task = asyncio.create_task(self._metadata_worker())
        self._embedding_task = asyncio.create_task(self._embedding_worker())
        logger.info("[SearchIndexService] Started")

    async def stop(self):
        self._started = False
        if self._flush_task:
            self._flush_task.cancel()
            self._flush_task = None
        for task in list(self._modified_tasks.values()):
            task.cancel()
        self._modified_tasks.clear()
        if self._metadata_task:
            self._metadata_task.cancel()
            self._metadata_task = None
        if self._embedding_task:
            self._embedding_task.cancel()
            self._embedding_task = None
        logger.info("[SearchIndexService] Stopped")

    async def register_workspaces(self, workdirs: Iterable[str]) -> None:
        for workdir in workdirs:
            await self.register_workspace(workdir)

    async def register_workspace(self, workdir: str) -> None:
        path = Path(workdir).resolve()
        if not path.exists() or not path.is_dir():
            return
        indexer = SearchIndex(path)
        try:
            # Ensure schema exists
            conn = indexer._connect()
            vec_enabled = indexer._require_vec_extension(conn, "schema init")
            indexer._init_schema(conn, vec_enabled)
            conn.close()
        except Exception as exc:
            logger.warning("[SearchIndexService] Failed to init schema for %s: %s", path, exc)
            return

        # Kick off a lightweight catalog scan if empty
        await self._schedule_initial_catalog_scan(path)

    async def enqueue_event(self, event: IndexEvent) -> None:
        if event.action == "modified":
            await self._schedule_modified(event)
            return

        self._cancel_modified(event.workdir, event.path)
        if event.dest_path:
            self._cancel_modified(event.workdir, event.dest_path)

        await self._enqueue_pending(event)

    def _cancel_modified(self, workdir: str, path: str) -> None:
        task = self._modified_tasks.pop((workdir, path), None)
        if task:
            task.cancel()

    async def _schedule_modified(self, event: IndexEvent) -> None:
        key = (event.workdir, event.path)
        self._cancel_modified(event.workdir, event.path)

        async def delayed() -> None:
            try:
                await asyncio.sleep(self._modified_quiet_window)
                await self._enqueue_pending(event)
            except asyncio.CancelledError:
                return
            finally:
                self._modified_tasks.pop(key, None)

        self._modified_tasks[key] = asyncio.create_task(delayed())

    async def _enqueue_pending(self, event: IndexEvent) -> None:
        async with self._lock:
            bucket = self._pending.setdefault(event.workdir, {})
            bucket[event.path] = event
            if event.dest_path:
                bucket[event.dest_path] = IndexEvent(
                    action="created",
                    path=event.dest_path,
                    dest_path=None,
                    is_directory=event.is_directory,
                    workdir=event.workdir,
                )

            if not self._flush_task:
                self._flush_task = asyncio.create_task(self._flush_pending())

    async def _flush_pending(self):
        try:
            await asyncio.sleep(self._event_debounce)
            async with self._lock:
                pending = self._pending
                self._pending = {}
                self._flush_task = None
        except asyncio.CancelledError:
            return

        for workdir, events in pending.items():
            await self._process_events(workdir, list(events.values()))

    async def _process_events(self, workdir: str, events: list[IndexEvent]) -> None:
        if not events:
            return
        base = Path(workdir).resolve()
        indexer = SearchIndex(base)
        for event in events:
            if event.action == "moved":
                target = base / event.path
                await asyncio.to_thread(indexer.delete_file, target)
                continue

            if event.is_directory:
                target = base / event.path
                if event.action == "deleted":
                    await asyncio.to_thread(indexer.delete_file, target)
                else:
                    await asyncio.to_thread(indexer.update_file_catalog, target, False)
                continue
            rel_path = event.path
            target = base / rel_path
            if event.action == "deleted":
                await asyncio.to_thread(indexer.delete_file, target)
                continue

            if not target.exists() or not target.is_file():
                continue

            await asyncio.to_thread(indexer.update_file_catalog, target, False)
            await self._metadata_queue.put((workdir, rel_path))

            if self._should_index_text(target):
                await self._embedding_queue.put((workdir, rel_path))

    def _should_index_text(self, path: Path) -> bool:
        ext = path.suffix.lower()
        if ext in MARKITDOWN_EXTENSIONS:
            return True
        return not _is_probably_binary(path)

    async def _metadata_worker(self):
        while True:
            workdir, rel_path = await self._metadata_queue.get()
            try:
                base = Path(workdir).resolve()
                target = base / rel_path
                if target.exists() and target.is_file():
                    indexer = SearchIndex(base)
                    await asyncio.to_thread(indexer.update_file_catalog, target, True)
            except Exception as exc:
                logger.warning("[SearchIndexService] Metadata extraction failed for %s: %s", rel_path, exc)
            finally:
                await asyncio.sleep(0.2)

    async def _embedding_worker(self):
        while True:
            workdir, rel_path = await self._embedding_queue.get()
            try:
                base = Path(workdir).resolve()
                target = base / rel_path
                if target.exists() and target.is_file():
                    indexer = SearchIndex(base)
                    await asyncio.to_thread(indexer.index_text, target, False)
                    await asyncio.to_thread(indexer.embed_chunks_for_path, target)
            except Exception as exc:
                logger.warning("[SearchIndexService] Embedding failed for %s: %s", rel_path, exc)
            finally:
                await asyncio.sleep(0.5)

    async def _schedule_initial_catalog_scan(self, workdir: Path) -> None:
        def scan_and_queue():
            indexer = SearchIndex(workdir)
            conn = indexer._connect()
            vec_enabled = indexer._require_vec_extension(conn, "initial scan")
            indexer._init_schema(conn, vec_enabled)
            try:
                row = conn.execute("SELECT COUNT(*) FROM file_catalog").fetchone()
                if row and row[0] > 0:
                    return []
            finally:
                conn.close()

            return indexer._scan_workdir(include_dirs=True)

        paths = await asyncio.to_thread(scan_and_queue)
        if not paths:
            return
        for path in paths:
            rel = str(path.relative_to(workdir))
            await self.enqueue_event(
                IndexEvent(
                    action="created",
                    path=rel,
                    dest_path=None,
                    is_directory=path.is_dir(),
                    workdir=str(workdir),
                )
            )


search_index_service = SearchIndexService()
