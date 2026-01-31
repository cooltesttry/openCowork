from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from core.search.indexer import SearchIndex, SearchIndexError
from models.search import (
    FileSearchResponse,
    IndexRequest,
    IndexResponse,
    SearchRequest,
    SearchResponse,
    StatusResponse,
)


router = APIRouter()


def resolve_workdir(request: Request, workdir: str | None) -> Path:
    settings = request.app.state.settings
    effective = workdir or settings.default_workdir
    if not effective:
        raise HTTPException(status_code=400, detail="No workdir provided")
    path = Path(effective).resolve()
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Invalid workdir: {path}")
    return path


@router.post("/search/index", response_model=IndexResponse)
async def index_workspace(request: Request, body: IndexRequest):
    workdir = resolve_workdir(request, body.workdir)
    indexer = SearchIndex(workdir)
    try:
        stats = indexer.index(paths=body.paths, rebuild=body.rebuild)
        return IndexResponse(indexed=stats.indexed, skipped=stats.skipped, failed=stats.failed)
    except SearchIndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/search/query", response_model=SearchResponse | FileSearchResponse)
async def query_workspace(request: Request, body: SearchRequest):
    workdir = resolve_workdir(request, body.workdir)
    indexer = SearchIndex(workdir)
    try:
        path_prefix = body.path_prefix
        if path_prefix and not Path(path_prefix).is_absolute():
            path_prefix = str((workdir / path_prefix).resolve())

        # Convert relative include/exclude paths to absolute
        include_paths = None
        if body.include_paths:
            include_paths = []
            for p in body.include_paths:
                if not Path(p).is_absolute():
                    include_paths.append(str((workdir / p).resolve()))
                else:
                    include_paths.append(p)

        exclude_paths = None
        if body.exclude_paths:
            exclude_paths = []
            for p in body.exclude_paths:
                if not Path(p).is_absolute():
                    exclude_paths.append(str((workdir / p).resolve()))
                else:
                    exclude_paths.append(p)

        if body.mode == "files":
            results = indexer.search_files(
                body.query,
                limit=body.limit,
                vector_k=body.vector_k,
                use_vector=body.use_vector,
                use_fts=body.use_fts,
                path_prefix=path_prefix,
                include_paths=include_paths,
                exclude_paths=exclude_paths,
                filename_query=body.filename_query,
                rerank=body.rerank,
                alpha=body.alpha,
            )
            # Add file metadata (size, modified_at)
            for result in results:
                try:
                    file_path = Path(result["path"])
                    if file_path.exists():
                        stat = file_path.stat()
                        result["size"] = stat.st_size
                        result["modified_at"] = stat.st_mtime
                except Exception:
                    pass
            return FileSearchResponse(results=results)

        results = indexer.search(
            body.query,
            limit=body.limit,
            vector_k=body.vector_k,
            use_vector=body.use_vector,
            use_fts=body.use_fts,
            path_prefix=path_prefix,
            include_paths=include_paths,
            exclude_paths=exclude_paths,
            rerank=body.rerank,
            alpha=body.alpha,
        )
        return SearchResponse(results=results)
    except SearchIndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/search/status", response_model=StatusResponse)
async def status_workspace(request: Request, workdir: str | None = None):
    target = resolve_workdir(request, workdir)
    indexer = SearchIndex(target)
    try:
        return StatusResponse(**indexer.status())
    except SearchIndexError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
