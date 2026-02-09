from __future__ import annotations

import json
import logging
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from core.search.embeddings import EmbeddingProvider
from core.search.extractors import ExtractionError, extract_text
from core.search.metadata import classify_kind, extract_metadata
from core.search.paths import (
    default_embedding_server_url,
    default_vec_extension_path,
    index_root_for_workdir,
)
from core.search.tokenizer import tokenize_for_fts, tokenize_query, is_cjk_char


logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_DIM = 768
DEFAULT_MAX_CHARS = 1500
DEFAULT_OVERLAP_CHARS = 250
EMBEDDING_MAX_CHARS = DEFAULT_MAX_CHARS

IGNORE_DIRS: set[str] = set()


@dataclass
class IndexStats:
    indexed: int = 0
    skipped: int = 0
    failed: int = 0


class SearchIndexError(RuntimeError):
    pass


class SearchIndex:
    def __init__(self, workdir: str | Path):
        self.workdir = Path(workdir).resolve()
        self.index_root = index_root_for_workdir(self.workdir)
        self.db_path = self.index_root / "search.sqlite"
        self.vec_extension_path = default_vec_extension_path()
        self.embedding_server_url = default_embedding_server_url()

    def _connect(self) -> sqlite3.Connection:
        if not self.workdir.exists():
            raise SearchIndexError(f"Workdir does not exist: {self.workdir}")
        if not self.workdir.is_dir():
            raise SearchIndexError(f"Workdir is not a directory: {self.workdir}")

        try:
            self.index_root.mkdir(parents=True, exist_ok=True)
        except PermissionError as exc:
            raise SearchIndexError(
                f"Cannot create index directory: {self.index_root}"
            ) from exc
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def _load_vec_extension(self, conn: sqlite3.Connection) -> bool:
        try:
            conn.enable_load_extension(True)
            conn.execute("SELECT load_extension(?)", (str(self.vec_extension_path),))
            return True
        except sqlite3.Error as exc:
            logger.warning("Failed to load sqlite-vec extension (%s): %s", self.vec_extension_path, exc)
            return False

    def _require_vec_extension(self, conn: sqlite3.Connection, action: str) -> bool:
        if self._load_vec_extension(conn):
            return True
        raise SearchIndexError(
            f"sqlite-vec extension not available for {action}: {self.vec_extension_path}"
        )

    def _init_schema(self, conn: sqlite3.Connection, vec_enabled: bool) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS file_catalog (
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE,
                filename TEXT,
                ext TEXT,
                kind TEXT,
                is_directory INTEGER DEFAULT 0,
                size INTEGER,
                mtime REAL,
                metadata_json TEXT
            )
            """
        )
        try:
            conn.execute("SELECT is_directory FROM file_catalog LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE file_catalog ADD COLUMN is_directory INTEGER DEFAULT 0")
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS file_catalog_fts
            USING fts5(filename, path, tokenize='unicode61')
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE,
                filename TEXT,
                mtime REAL,
                size INTEGER,
                type TEXT,
                language TEXT
            )
            """
        )
        self._ensure_filename_column(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY,
                doc_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                start_line INTEGER,
                end_line INTEGER,
                FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(text, tokenize='unicode61')
            """
        )
        if vec_enabled:
            conn.execute(
                f"""
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks
                USING vec0(
                    chunk_id INTEGER PRIMARY KEY,
                    embedding FLOAT[{DEFAULT_EMBEDDING_DIM}] distance_metric=cosine,
                    doc_id INTEGER
                )
                """
            )

    def _ensure_filename_column(self, conn: sqlite3.Connection) -> None:
        try:
            conn.execute("SELECT filename FROM documents LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE documents ADD COLUMN filename TEXT")

        rows = conn.execute(
            "SELECT id, path FROM documents WHERE filename IS NULL OR filename = ''"
        ).fetchall()
        if rows:
            for row in rows:
                conn.execute(
                    "UPDATE documents SET filename = ? WHERE id = ?",
                    (Path(row["path"]).name, row["id"]),
                )
            conn.commit()

    def _table_exists(self, conn: sqlite3.Connection, name: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
            (name,),
        ).fetchone()
        return row is not None

    def _upsert_file_catalog(
        self,
        conn: sqlite3.Connection,
        path: Path,
        stat: os.stat_result,
        metadata: dict | None = None,
        is_directory: bool | None = None,
    ) -> int:
        file_path = str(path)
        filename = path.name
        if is_directory is None:
            is_directory = path.is_dir()
        ext = "" if is_directory else path.suffix.lower().lstrip(".")
        kind = "directory" if is_directory else classify_kind(path)
        metadata_json = json.dumps(metadata) if metadata else None

        row = conn.execute(
            "SELECT id FROM file_catalog WHERE path = ?",
            (file_path,),
        ).fetchone()
        if row:
            file_id = row["id"]
            conn.execute(
                """
                UPDATE file_catalog
                SET filename = ?, ext = ?, kind = ?, is_directory = ?, size = ?, mtime = ?, metadata_json = ?
                WHERE id = ?
                """,
                (filename, ext, kind, int(bool(is_directory)), stat.st_size, stat.st_mtime, metadata_json, file_id),
            )
        else:
            cursor = conn.execute(
                """
                INSERT INTO file_catalog(path, filename, ext, kind, is_directory, size, mtime, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (file_path, filename, ext, kind, int(bool(is_directory)), stat.st_size, stat.st_mtime, metadata_json),
            )
            file_id = cursor.lastrowid

        conn.execute("DELETE FROM file_catalog_fts WHERE rowid = ?", (file_id,))
        conn.execute(
            "INSERT INTO file_catalog_fts(rowid, filename, path) VALUES (?, ?, ?)",
            (file_id, filename, file_path),
        )
        return int(file_id)

    def _delete_file_catalog(self, conn: sqlite3.Connection, path: Path) -> None:
        file_path = str(path)
        row = conn.execute(
            "SELECT id FROM file_catalog WHERE path = ?",
            (file_path,),
        ).fetchone()
        if not row:
            return
        file_id = row["id"]
        conn.execute("DELETE FROM file_catalog_fts WHERE rowid = ?", (file_id,))
        conn.execute("DELETE FROM file_catalog WHERE id = ?", (file_id,))

    def delete_file(self, path: Path) -> None:
        if self._is_index_internal_path(path):
            return
        conn = self._connect()
        vec_enabled = self._require_vec_extension(conn, "delete")
        self._init_schema(conn, vec_enabled)
        try:
            self._delete_file_catalog(conn, path)
            row = conn.execute(
                "SELECT id FROM documents WHERE path = ?",
                (str(path),),
            ).fetchone()
            if row:
                self._delete_doc(conn, row["id"])
            conn.commit()
        finally:
            conn.close()

    def update_file_catalog(self, path: Path, with_metadata: bool = False) -> None:
        if self._is_index_internal_path(path):
            return
        if not path.exists():
            return
        stat = path.stat()
        is_directory = path.is_dir()
        metadata = None
        if with_metadata and not is_directory:
            metadata = extract_metadata(path, stat.st_size)

        conn = self._connect()
        vec_enabled = self._require_vec_extension(conn, "file catalog update")
        self._init_schema(conn, vec_enabled)
        try:
            self._upsert_file_catalog(conn, path, stat, metadata, is_directory=is_directory)
            conn.commit()
        finally:
            conn.close()

    def embed_chunks_for_path(self, path: Path) -> None:
        if self._is_index_internal_path(path):
            return
        conn = self._connect()
        vec_enabled = self._require_vec_extension(conn, "embedding")
        self._init_schema(conn, vec_enabled)

        embedder = EmbeddingProvider(self.embedding_server_url)
        vector_available = embedder.is_available() and self._table_exists(conn, "vec_chunks")
        if not vector_available:
            conn.close()
            return

        try:
            row = conn.execute(
                "SELECT id FROM documents WHERE path = ?",
                (str(path),),
            ).fetchone()
            if not row:
                return
            doc_id = row["id"]
            chunk_rows = conn.execute(
                "SELECT id, text FROM chunks WHERE doc_id = ? ORDER BY id",
                (doc_id,),
            ).fetchall()
            if not chunk_rows:
                return

            conn.execute("DELETE FROM vec_chunks WHERE doc_id = ?", (doc_id,))

            chunk_ids: list[int] = []
            embed_texts: list[str] = []
            for chunk in chunk_rows:
                chunk_ids.append(chunk["id"])
                embed_texts.append(
                    embedder.format_document(
                        chunk["text"][:EMBEDDING_MAX_CHARS],
                        title=path.name,
                    )
                )

            embeddings = embedder.embed_texts(embed_texts)
            for chunk_id, embedding in zip(chunk_ids, embeddings, strict=False):
                conn.execute(
                    "INSERT INTO vec_chunks(chunk_id, embedding, doc_id) VALUES (?, ?, ?)",
                    (chunk_id, json.dumps(embedding), doc_id),
                )

            conn.commit()
        finally:
            conn.close()

    def index_text(self, path: Path, embed: bool = False) -> bool:
        if not path.exists() or not path.is_file():
            return False
        if self._is_index_internal_path(path):
            return False

        conn = self._connect()
        vec_enabled = self._require_vec_extension(conn, "index_text")
        self._init_schema(conn, vec_enabled)
        embedder = EmbeddingProvider(self.embedding_server_url) if vec_enabled else None
        vector_available = (
            vec_enabled
            and embedder is not None
            and embedder.is_available()
            and self._table_exists(conn, "vec_chunks")
        )

        try:
            stat = path.stat()
            self._upsert_file_catalog(conn, path, stat, None)
            row = conn.execute(
                "SELECT id, mtime, size FROM documents WHERE path = ?",
                (str(path),),
            ).fetchone()
            if row and row["mtime"] == stat.st_mtime and row["size"] == stat.st_size:
                conn.commit()
                return False

            if row:
                self._delete_doc(conn, row["id"])

            text = extract_text(path)
            if not text.strip():
                conn.commit()
                return False

            language = self._detect_language(text)
            doc_type = path.suffix.lower().lstrip(".")
            cursor = conn.execute(
                "INSERT INTO documents(path, filename, mtime, size, type, language) VALUES (?, ?, ?, ?, ?, ?)",
                (str(path), path.name, stat.st_mtime, stat.st_size, doc_type, language),
            )
            doc_id = cursor.lastrowid

            chunks = self._chunk_text(text)
            chunk_ids: list[int] = []
            chunk_texts: list[str] = []
            embed_texts: list[str] = []
            for chunk_text, start_line, end_line in chunks:
                cur = conn.execute(
                    "INSERT INTO chunks(doc_id, text, start_line, end_line) VALUES (?, ?, ?, ?)",
                    (doc_id, chunk_text, start_line, end_line),
                )
                chunk_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)",
                    (chunk_id, tokenize_for_fts(chunk_text)),
                )
                if vector_available and embed:
                    chunk_ids.append(chunk_id)
                    chunk_texts.append(chunk_text)
                    embed_texts.append(
                        embedder.format_document(
                            chunk_text[:EMBEDDING_MAX_CHARS],
                            title=path.name,
                        )
                    )

            if vector_available and embed and chunk_texts:
                try:
                    embeddings = embedder.embed_texts(embed_texts)
                except Exception as exc:
                    logger.warning("Embedding failed for %s: %s", path, exc)
                    embeddings = []

                for chunk_id, embedding in zip(chunk_ids, embeddings, strict=False):
                    conn.execute(
                        "INSERT INTO vec_chunks(chunk_id, embedding, doc_id) VALUES (?, ?, ?)",
                        (chunk_id, json.dumps(embedding), doc_id),
                    )

            conn.commit()
            return True
        except ExtractionError as exc:
            logger.warning("Skipping %s: %s", path, exc)
            conn.commit()
            return False
        finally:
            conn.close()

    def _build_path_filter(
        self,
        path_prefix: str | None,
        include_paths: list[str] | None,
        exclude_paths: list[str] | None,
    ) -> tuple[str, list[object]]:
        """Build SQL WHERE clause and params for path filtering.

        Returns (where_clause, params) where where_clause starts with " AND ..."
        """
        clauses: list[str] = []
        params: list[object] = []

        # Path prefix filter
        if path_prefix:
            clauses.append("d.path LIKE ? ESCAPE '\\'")
            params.append(self._escape_like(path_prefix) + "%")

        # Include paths: file must start with one of these prefixes
        if include_paths:
            include_clauses = []
            for p in include_paths:
                include_clauses.append("d.path LIKE ? ESCAPE '\\'")
                params.append(self._escape_like(p) + "%")
            clauses.append(f"({' OR '.join(include_clauses)})")

        # Exclude paths: file must NOT start with any of these prefixes
        if exclude_paths:
            for p in exclude_paths:
                clauses.append("d.path NOT LIKE ? ESCAPE '\\'")
                params.append(self._escape_like(p) + "%")

        if clauses:
            return " AND " + " AND ".join(clauses), params
        return "", []

    def _resolve_paths(self, paths: Optional[Iterable[str]]) -> list[Path]:
        if not paths:
            return self._scan_workdir()
        resolved: list[Path] = []
        for raw in paths:
            path = Path(raw)
            if not path.is_absolute():
                path = self.workdir / path
            if self._is_index_internal_path(path):
                continue
            if path.exists() and path.is_file():
                resolved.append(path)
        return resolved

    def _scan_workdir(self, include_dirs: bool = False) -> list[Path]:
        entries: list[Path] = []
        for root, dirs, filenames in os.walk(self.workdir):
            root_path = Path(root)
            if self._is_index_internal_path(root_path):
                dirs[:] = []
                continue
            # Exclude hidden directories except .opencowork
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and (not d.startswith(".") or d == ".opencowork")]
            if include_dirs:
                for name in dirs:
                    entries.append(Path(root) / name)
            for name in filenames:
                entries.append(Path(root) / name)
        return entries

    def _is_hidden_path(self, path: Path) -> bool:
        # Allow .opencowork directory, skip other hidden paths
        return any(part.startswith(".") and part != ".opencowork" for part in path.parts)

    def _is_index_internal_path(self, path: Path) -> bool:
        try:
            path.resolve().relative_to(self.index_root)
            return True
        except ValueError:
            return False

    def _detect_language(self, text: str) -> str:
        for ch in text:
            if is_cjk_char(ch):
                return "cjk"
        return "en"

    def _escape_like(self, value: str) -> str:
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def _chunk_text(self, text: str) -> list[tuple[str, int, int]]:
        if not text:
            return []

        # Precompute line break positions for fast line number lookup.
        line_breaks = [idx for idx, ch in enumerate(text) if ch == "\n"]

        def line_number(pos: int) -> int:
            # Line numbers are 1-based.
            lo, hi = 0, len(line_breaks)
            while lo < hi:
                mid = (lo + hi) // 2
                if line_breaks[mid] < pos:
                    lo = mid + 1
                else:
                    hi = mid
            return lo + 1

        chunks: list[tuple[str, int, int]] = []
        start = 0
        length = len(text)
        while start < length:
            end = min(start + DEFAULT_MAX_CHARS, length)
            chunk_text = text[start:end]
            start_line = line_number(start)
            end_line = line_number(end)
            chunks.append((chunk_text, start_line, end_line))

            if end >= length:
                break
            next_start = max(end - DEFAULT_OVERLAP_CHARS, start + 1)
            start = next_start

        return chunks

    def _delete_doc(self, conn: sqlite3.Connection, doc_id: int) -> None:
        rows = conn.execute("SELECT id FROM chunks WHERE doc_id = ?", (doc_id,)).fetchall()
        chunk_ids = [row[0] for row in rows]
        if chunk_ids:
            placeholders = ",".join(["?"] * len(chunk_ids))
            conn.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({placeholders})", chunk_ids)
            if self._table_exists(conn, "vec_chunks"):
                conn.execute(f"DELETE FROM vec_chunks WHERE chunk_id IN ({placeholders})", chunk_ids)
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))

    def index(self, paths: Optional[Iterable[str]] = None, rebuild: bool = False) -> IndexStats:
        stats = IndexStats()
        if rebuild and self.db_path.exists():
            self.db_path.unlink()

        conn = self._connect()
        vec_enabled = self._require_vec_extension(conn, "indexing")
        self._init_schema(conn, vec_enabled)

        embedder = EmbeddingProvider(self.embedding_server_url) if vec_enabled else None
        vector_available = vec_enabled and embedder is not None and embedder.is_available()

        try:
            if paths is None:
                for entry in self._scan_workdir(include_dirs=True):
                    if not entry.exists() or not entry.is_dir():
                        continue
                    if self._is_hidden_path(entry):
                        continue
                    try:
                        stat = entry.stat()
                        self._upsert_file_catalog(conn, entry, stat, None, is_directory=True)
                    except OSError:
                        continue
                conn.commit()

            for path in self._resolve_paths(paths):
                if not path.exists() or not path.is_file():
                    stats.skipped += 1
                    continue
                if self._is_index_internal_path(path):
                    stats.skipped += 1
                    continue
                if self._is_hidden_path(path):
                    stats.skipped += 1
                    continue

                try:
                    stat = path.stat()
                    # Always upsert file catalog entry (metadata can be added later)
                    self._upsert_file_catalog(conn, path, stat, None)
                    row = conn.execute(
                        "SELECT id, mtime, size FROM documents WHERE path = ?", (str(path),)
                    ).fetchone()
                    if row and row["mtime"] == stat.st_mtime and row["size"] == stat.st_size:
                        conn.commit()
                        stats.skipped += 1
                        continue

                    if row:
                        self._delete_doc(conn, row["id"])

                    text = extract_text(path)
                    if not text.strip():
                        conn.commit()
                        stats.skipped += 1
                        continue

                    language = self._detect_language(text)
                    doc_type = path.suffix.lower().lstrip(".")
                    cursor = conn.execute(
                        "INSERT INTO documents(path, filename, mtime, size, type, language) VALUES (?, ?, ?, ?, ?, ?)",
                        (str(path), path.name, stat.st_mtime, stat.st_size, doc_type, language),
                    )
                    doc_id = cursor.lastrowid

                    chunks = self._chunk_text(text)
                    chunk_ids: list[int] = []
                    chunk_texts: list[str] = []
                    embed_texts: list[str] = []
                    for chunk_text, start_line, end_line in chunks:
                        cur = conn.execute(
                            "INSERT INTO chunks(doc_id, text, start_line, end_line) VALUES (?, ?, ?, ?)",
                            (doc_id, chunk_text, start_line, end_line),
                        )
                        chunk_id = cur.lastrowid
                        conn.execute(
                            "INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)",
                            (chunk_id, tokenize_for_fts(chunk_text)),
                        )
                        if vector_available:
                            chunk_ids.append(chunk_id)
                            chunk_texts.append(chunk_text)
                            embed_texts.append(
                                embedder.format_document(
                                    chunk_text[:EMBEDDING_MAX_CHARS],
                                    title=path.name,
                                )
                            )

                    if vector_available and chunk_texts:
                        try:
                            embeddings = embedder.embed_texts(embed_texts)
                        except Exception as exc:
                            logger.warning("Embedding failed for %s: %s", path, exc)
                            embeddings = []

                        for chunk_id, embedding in zip(chunk_ids, embeddings, strict=False):
                            conn.execute(
                                "INSERT INTO vec_chunks(chunk_id, embedding, doc_id) VALUES (?, ?, ?)",
                                (chunk_id, json.dumps(embedding), doc_id),
                            )

                    conn.commit()
                    stats.indexed += 1
                except ExtractionError as exc:
                    logger.warning("Skipping %s: %s", path, exc)
                    conn.commit()
                    stats.skipped += 1
                except Exception as exc:
                    logger.exception("Indexing failed for %s: %s", path, exc)
                    stats.failed += 1
        finally:
            conn.close()

        return stats

    def search(
        self,
        query: str,
        limit: int = 20,
        vector_k: int = 20,
        use_vector: bool = True,
        use_fts: bool = True,
        path_prefix: str | None = None,
        include_paths: list[str] | None = None,
        exclude_paths: list[str] | None = None,
        rerank: str = "rrf",
        alpha: float = 0.75,
    ) -> list[dict]:
        conn = self._connect()
        vec_enabled = False
        if use_vector:
            vec_enabled = self._load_vec_extension(conn)
        self._init_schema(conn, vec_enabled)
        embedder = EmbeddingProvider(self.embedding_server_url) if vec_enabled else None
        vector_available = (
            vec_enabled
            and embedder is not None
            and embedder.is_available()
            and self._table_exists(conn, "vec_chunks")
        )

        results: dict[int, dict] = {}
        try:
            # Build path filter clause
            path_filter, path_params = self._build_path_filter(
                path_prefix, include_paths, exclude_paths
            )

            fts_query = tokenize_query(query) if use_fts else ""
            if fts_query:
                params: list[object] = [fts_query]
                params.extend(path_params)
                params.append(limit)

                rows = conn.execute(
                    f"""
                    SELECT c.id AS chunk_id, d.path, c.text, c.start_line, c.end_line,
                           bm25(chunks_fts) AS bm25
                    FROM chunks_fts
                    JOIN chunks c ON c.id = chunks_fts.rowid
                    JOIN documents d ON d.id = c.doc_id
                    WHERE chunks_fts MATCH ?{path_filter}
                    ORDER BY bm25(chunks_fts)
                    LIMIT ?
                    """,
                    params,
                ).fetchall()

                for rank, row in enumerate(rows, start=1):
                    chunk_id = row["chunk_id"]
                    entry = results.setdefault(
                        chunk_id,
                        {
                            "chunk_id": chunk_id,
                            "path": row["path"],
                            "text": row["text"],
                            "start_line": row["start_line"],
                            "end_line": row["end_line"],
                            "bm25": row["bm25"],
                            "distance": None,
                            "rrf": 0.0,
                            "fts_rank_score": 0.0,
                            "vec_rank_score": 0.0,
                        },
                    )
                    rank_score = 1.0 / (60 + rank)
                    entry["fts_rank_score"] = rank_score
                    entry["rrf"] += rank_score

            if vector_available and query.strip():
                try:
                    embedding = embedder.embed_texts([embedder.format_query(query)])
                except Exception as exc:
                    logger.warning("Vector query embedding failed: %s", exc)
                    embedding = []

                if embedding:
                    vec_query = json.dumps(embedding[0])
                    params = [vec_query, vector_k]
                    params.extend(path_params)

                    rows = conn.execute(
                        f"""
                        SELECT v.chunk_id, v.distance, d.path, c.text, c.start_line, c.end_line
                        FROM vec_chunks v
                        JOIN chunks c ON c.id = v.chunk_id
                        JOIN documents d ON d.id = c.doc_id
                        WHERE v.embedding MATCH ? AND k = ?{path_filter}
                        ORDER BY v.distance
                        """,
                        params,
                    ).fetchall()

                    for rank, row in enumerate(rows, start=1):
                        chunk_id = row["chunk_id"]
                        entry = results.setdefault(
                            chunk_id,
                            {
                                "chunk_id": chunk_id,
                                "path": row["path"],
                                "text": row["text"],
                                "start_line": row["start_line"],
                                "end_line": row["end_line"],
                                "bm25": None,
                                "distance": row["distance"],
                                "rrf": 0.0,
                                "fts_rank_score": 0.0,
                                "vec_rank_score": 0.0,
                            },
                        )
                        entry["distance"] = row["distance"]
                        rank_score = 1.0 / (60 + rank)
                        entry["vec_rank_score"] = rank_score
                        entry["rrf"] += rank_score
        finally:
            conn.close()

        if rerank == "alpha":
            for item in results.values():
                item["score"] = (1.0 - alpha) * item.get("fts_rank_score", 0.0) + alpha * item.get(
                    "vec_rank_score", 0.0
                )
            ranked = sorted(results.values(), key=lambda item: item.get("score", 0.0), reverse=True)
        elif rerank == "bm25":
            def sort_key(item: dict) -> tuple:
                bm25 = item["bm25"]
                has_bm25 = bm25 is not None
                return (0 if has_bm25 else 1, bm25 if has_bm25 else 0.0, -item["rrf"])

            ranked = sorted(results.values(), key=sort_key)
        else:
            ranked = sorted(results.values(), key=lambda item: item["rrf"], reverse=True)
        for item in ranked:
            item["snippet"] = item["text"][:300]
        return ranked[:limit]

    def search_files(
        self,
        query: str,
        limit: int = 20,
        vector_k: int = 20,
        use_vector: bool = True,
        use_fts: bool = True,
        path_prefix: str | None = None,
        include_paths: list[str] | None = None,
        exclude_paths: list[str] | None = None,
        filename_query: str | None = None,
        rerank: str = "rrf",
        alpha: float = 0.75,
    ) -> list[dict]:
        chunk_limit = min(max(limit * 5, limit), 200)
        effective_vector_k = min(max(vector_k, chunk_limit), 200)
        chunk_results = self.search(
            query,
            limit=chunk_limit,
            vector_k=effective_vector_k,
            use_vector=use_vector,
            use_fts=use_fts,
            path_prefix=path_prefix,
            include_paths=include_paths,
            exclude_paths=exclude_paths,
            rerank=rerank,
            alpha=alpha,
        )

        grouped: dict[str, dict] = {}
        for item in chunk_results:
            path = item["path"]
            if rerank == "alpha":
                chunk_score = item.get("score", 0.0)
            elif rerank == "rrf":
                chunk_score = item.get("rrf", 0.0)
            else:
                chunk_score = 0.0
            entry = grouped.get(path)
            if entry is None:
                entry = {
                    "path": path,
                    "snippet": item["snippet"],
                    "start_line": item["start_line"],
                    "end_line": item["end_line"],
                    "score": chunk_score,
                    "bm25": item["bm25"],
                    "distance": item["distance"],
                    "_best_bm25": item["bm25"],
                }
                grouped[path] = entry

            if rerank in ("rrf", "alpha") and chunk_score > entry["score"]:
                entry["score"] = chunk_score
                entry["snippet"] = item["snippet"]
                entry["start_line"] = item["start_line"]
                entry["end_line"] = item["end_line"]
                entry["bm25"] = item["bm25"]
                entry["distance"] = item["distance"]
            if item["bm25"] is not None and (
                entry["_best_bm25"] is None or item["bm25"] < entry["_best_bm25"]
            ):
                entry["_best_bm25"] = item["bm25"]
                if rerank == "bm25":
                    entry["snippet"] = item["snippet"]
                    entry["start_line"] = item["start_line"]
                    entry["end_line"] = item["end_line"]
                    entry["bm25"] = item["bm25"]
                    entry["distance"] = item["distance"]
                    entry["score"] = -float(item["bm25"])

        results = list(grouped.values())
        for entry in results:
            entry.pop("_best_bm25", None)

        def sort_file_results(items: list[dict]) -> None:
            if rerank == "bm25":
                def file_sort(item: dict) -> tuple:
                    bm25 = item["bm25"]
                    has_bm25 = bm25 is not None
                    return (0 if has_bm25 else 1, bm25 if has_bm25 else 0.0, -item["score"])

                items.sort(key=file_sort)
            else:
                items.sort(key=lambda item: item["score"], reverse=True)

        sort_file_results(results)
        if not filename_query:
            return results[:limit]

        conn = self._connect()
        try:
            if not self._table_exists(conn, "documents"):
                return results[:limit]
            self._ensure_filename_column(conn)
            like = f"%{self._escape_like(filename_query)}%"
            filename_limit = min(max(limit * 5, limit), 200)

            # Build path filter for filename search
            path_filter, path_params = self._build_path_filter(
                path_prefix, include_paths, exclude_paths
            )

            params: list[object] = [like]
            params.extend(path_params)
            params.append(filename_limit)

            rows = conn.execute(
                f"""
                SELECT d.path, d.filename
                FROM documents d
                WHERE LOWER(d.filename) LIKE LOWER(?) ESCAPE '\\'{path_filter}
                ORDER BY LENGTH(d.filename) ASC, d.filename ASC
                LIMIT ?
                """,
                params,
            ).fetchall()

            for rank, row in enumerate(rows, start=1):
                path = row["path"]
                score = 1.0 / (60 + rank)
                entry = grouped.get(path)
                if entry is None:
                    entry = {
                        "path": path,
                        "snippet": "",
                        "start_line": None,
                        "end_line": None,
                        "score": 0.0,
                        "bm25": None,
                        "distance": None,
                    }
                    grouped[path] = entry
                entry["score"] += score

                if not entry["snippet"]:
                    snippet_row = conn.execute(
                        """
                        SELECT c.text, c.start_line, c.end_line
                        FROM chunks c
                        JOIN documents d ON d.id = c.doc_id
                        WHERE d.path = ?
                        ORDER BY c.id
                        LIMIT 1
                        """,
                        (path,),
                    ).fetchone()
                    if snippet_row:
                        entry["snippet"] = snippet_row["text"][:300]
                        entry["start_line"] = snippet_row["start_line"]
                        entry["end_line"] = snippet_row["end_line"]
        finally:
            conn.close()

        results = list(grouped.values())
        sort_file_results(results)
        return results[:limit]

    def status(self) -> dict:
        if not self.db_path.exists():
            return {"documents": 0, "chunks": 0}
        conn = self._connect()
        try:
            doc_count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            chunk_count = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            return {"documents": doc_count, "chunks": chunk_count}
        finally:
            conn.close()
