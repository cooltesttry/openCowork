from __future__ import annotations

import os
import sys
from pathlib import Path


VEC0_ENV = "OPENCOWORK_VEC0_PATH"
EMBED_SERVER_ENV = "OPENCOWORK_EMBEDDING_SERVER_URL"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_vec_extension_path() -> Path:
    env_path = os.getenv(VEC0_ENV)
    if env_path:
        return Path(env_path)

    # Use sqlite-vec pip package's bundled extension
    try:
        import sqlite_vec
        return Path(sqlite_vec.loadable_path())
    except (ImportError, AttributeError):
        pass

    # Fallback to storage/bin/
    if sys.platform == "darwin":
        ext = ".dylib"
    elif sys.platform.startswith("win"):
        ext = ".dll"
    else:
        ext = ".so"

    return repo_root() / "storage" / "bin" / f"vec0{ext}"


def default_embedding_server_url() -> str:
    env_url = os.getenv(EMBED_SERVER_ENV)
    if env_url:
        return env_url

    return "http://127.0.0.1:39289"


def index_root_for_workdir(workdir: str | Path) -> Path:
    return Path(workdir).resolve() / ".opencowork" / "search"
