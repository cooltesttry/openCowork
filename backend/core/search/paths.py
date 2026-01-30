from __future__ import annotations

import os
import sys
from pathlib import Path


VEC0_ENV = "OPENCOWORK_VEC0_PATH"
MODEL_ENV = "OPENCOWORK_EMBEDDING_MODEL_PATH"
EMBED_SERVER_ENV = "OPENCOWORK_EMBEDDING_SERVER_URL"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_vec_extension_path() -> Path:
    env_path = os.getenv(VEC0_ENV)
    if env_path:
        return Path(env_path)

    if sys.platform == "darwin":
        ext = ".dylib"
    elif sys.platform.startswith("win"):
        ext = ".dll"
    else:
        ext = ".so"

    return repo_root() / "storage" / "bin" / f"vec0{ext}"


def default_model_path() -> Path:
    env_path = os.getenv(MODEL_ENV)
    if env_path:
        return Path(env_path)

    return repo_root() / "storage" / "models" / "embeddinggemma-q8_0.gguf"


def default_embedding_server_url() -> str:
    env_url = os.getenv(EMBED_SERVER_ENV)
    if env_url:
        return env_url

    return "http://127.0.0.1:39289"


def index_root_for_workdir(workdir: str | Path) -> Path:
    return Path(workdir).resolve() / ".opencowork" / "search"
