from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class IndexRequest(BaseModel):
    workdir: Optional[str] = None
    paths: Optional[list[str]] = None
    rebuild: bool = False


class IndexResponse(BaseModel):
    indexed: int
    skipped: int
    failed: int


class SearchRequest(BaseModel):
    workdir: Optional[str] = None
    query: str
    limit: int = Field(default=20, ge=1, le=200)
    vector_k: int = Field(default=20, ge=1, le=200)
    use_vector: bool = True
    use_fts: bool = True
    path_prefix: Optional[str] = None
    include_paths: Optional[list[str]] = None  # Only search in these paths
    exclude_paths: Optional[list[str]] = None  # Exclude these paths from search
    filename_query: Optional[str] = None
    rerank: str = Field(default="rrf", pattern="^(rrf|bm25|alpha)$")
    alpha: float = Field(default=0.75, ge=0.0, le=1.0)
    mode: str = Field(default="chunks", pattern="^(chunks|files)$")


class SearchResult(BaseModel):
    chunk_id: int
    path: str
    text: str
    snippet: str
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    bm25: Optional[float] = None
    distance: Optional[float] = None
    rrf: float


class SearchResponse(BaseModel):
    results: list[SearchResult]


class FileSearchResult(BaseModel):
    path: str
    snippet: str
    start_line: Optional[int] = None
    end_line: Optional[int] = None
    score: float
    bm25: Optional[float] = None
    distance: Optional[float] = None
    size: Optional[int] = None  # File size in bytes
    modified_at: Optional[float] = None  # Unix timestamp


class FileSearchResponse(BaseModel):
    results: list[FileSearchResult]


class StatusRequest(BaseModel):
    workdir: Optional[str] = None


class StatusResponse(BaseModel):
    documents: int
    chunks: int
