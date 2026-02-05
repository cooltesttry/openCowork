"""
CLIProxyAPI sidecar management: download, configure, start/stop, and proxy helpers.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import platform
import secrets
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import yaml

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
STORAGE_DIR = REPO_ROOT / "storage" / "cliproxyapi"
AUTH_DIR = STORAGE_DIR / "auths"
BIN_DIR = STORAGE_DIR / "bin"
CONFIG_PATH = STORAGE_DIR / "config.yaml"
PID_FILE = STORAGE_DIR / "cliproxyapi.pid"
LOG_FILE = STORAGE_DIR / "cliproxyapi.log"
MGMT_KEY_FILE = STORAGE_DIR / "management_key"
CURRENT_FILE = BIN_DIR / "current.json"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8317

GITHUB_API_LATEST = "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest"


@dataclass
class ReleaseAsset:
    name: str
    url: str


def _ensure_dirs() -> None:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    BIN_DIR.mkdir(parents=True, exist_ok=True)


def _write_secret(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")
    try:
        path.chmod(0o600)
    except Exception:
        # Best effort on non-POSIX systems.
        pass


def _is_bcrypt_hash(value: str) -> bool:
    return value.startswith("$2a$") or value.startswith("$2b$") or value.startswith("$2y$")


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
            if isinstance(data, dict):
                return data
    except Exception as exc:
        logger.warning("Failed to read CLIProxyAPI config: %s", exc)
    return {}


def ensure_config() -> None:
    _ensure_dirs()
    if CONFIG_PATH.exists():
        if not MGMT_KEY_FILE.exists():
            from_cfg = _read_management_key_from_config()
            if from_cfg:
                _write_secret(MGMT_KEY_FILE, from_cfg)
        return

    api_key = secrets.token_urlsafe(32)
    management_key = secrets.token_urlsafe(32)
    config = {
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "auth-dir": str(AUTH_DIR),
        "api-keys": [api_key],
        "remote-management": {
            "allow-remote": False,
            "secret-key": management_key,
            "disable-control-panel": False,
        },
    }
    CONFIG_PATH.write_text(
        yaml.safe_dump(config, sort_keys=False),
        encoding="utf-8",
    )
    _write_secret(MGMT_KEY_FILE, management_key)


def _read_management_key_from_config() -> str | None:
    cfg = load_config()
    secret = None
    if isinstance(cfg, dict):
        rm = cfg.get("remote-management") or {}
        if isinstance(rm, dict):
            secret = rm.get("secret-key")
    if isinstance(secret, str) and secret and not _is_bcrypt_hash(secret):
        return secret
    return None


def get_management_key() -> str | None:
    env_key = os.getenv("CLIPROXY_MANAGEMENT_KEY")
    if env_key:
        return env_key.strip()
    if MGMT_KEY_FILE.exists():
        value = MGMT_KEY_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    from_cfg = _read_management_key_from_config()
    if from_cfg:
        _write_secret(MGMT_KEY_FILE, from_cfg)
        return from_cfg
    return None


def get_client_api_keys() -> list[str]:
    cfg = load_config()
    keys = cfg.get("api-keys") if isinstance(cfg, dict) else None
    if isinstance(keys, list):
        return [k for k in keys if isinstance(k, str)]
    return []


def get_base_url() -> str:
    cfg = load_config()
    host = DEFAULT_HOST
    port = DEFAULT_PORT
    tls = False
    if isinstance(cfg, dict):
        raw_host = cfg.get("host")
        if isinstance(raw_host, str) and raw_host.strip():
            host = raw_host.strip()
        raw_port = cfg.get("port")
        if isinstance(raw_port, int) and raw_port > 0:
            port = raw_port
        raw_tls = cfg.get("tls") or {}
        if isinstance(raw_tls, dict):
            tls = bool(raw_tls.get("enable"))
    scheme = "https" if tls else "http"
    return f"{scheme}://{host or DEFAULT_HOST}:{port}"


def management_base_url() -> str:
    return f"{get_base_url().rstrip('/')}/v0/management"


def _current_binary_path() -> Path | None:
    if CURRENT_FILE.exists():
        try:
            data = json.loads(CURRENT_FILE.read_text(encoding="utf-8"))
            path = data.get("path")
            if path and Path(path).exists():
                return Path(path)
        except Exception:
            pass
    exe_name = "cliproxyapi.exe" if os.name == "nt" else "cliproxyapi"
    candidate = BIN_DIR / exe_name
    if candidate.exists():
        return candidate
    return None


def _current_version() -> str | None:
    if CURRENT_FILE.exists():
        try:
            data = json.loads(CURRENT_FILE.read_text(encoding="utf-8"))
            version = data.get("version")
            if isinstance(version, str) and version.strip():
                return version.strip()
        except Exception:
            pass
    path = _current_binary_path()
    if path:
        name = path.name
        if "cliproxyapi-" in name:
            suffix = name.split("cliproxyapi-", 1)[-1]
            if suffix.endswith(".exe"):
                suffix = suffix[:-4]
            return suffix
    return None


def _write_current(version: str, binary_path: Path) -> None:
    payload = {"version": version, "path": str(binary_path)}
    CURRENT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    exe_name = "cliproxyapi.exe" if os.name == "nt" else "cliproxyapi"
    link_path = BIN_DIR / exe_name
    if link_path.exists() or link_path.is_symlink():
        try:
            link_path.unlink()
        except Exception:
            pass
    try:
        link_path.symlink_to(binary_path)
    except Exception:
        shutil.copy2(binary_path, link_path)


def _platform_tokens() -> tuple[list[str], list[str]]:
    system = platform.system().lower()
    machine = platform.machine().lower()

    if system.startswith("darwin") or system.startswith("mac"):
        os_tokens = ["darwin", "macos", "mac", "osx"]
    elif system.startswith("win"):
        os_tokens = ["windows", "win"]
    else:
        os_tokens = ["linux"]

    arch_tokens: list[str] = []
    if machine in ("x86_64", "amd64"):
        arch_tokens = ["amd64", "x86_64", "x64"]
    elif machine in ("arm64", "aarch64"):
        arch_tokens = ["arm64", "aarch64"]
    elif machine in ("armv7l", "armv7"):
        arch_tokens = ["armv7", "armv7l"]
    elif machine in ("armv6l", "armv6"):
        arch_tokens = ["armv6", "armv6l"]
    elif machine in ("i386", "i686", "x86"):
        arch_tokens = ["386", "x86", "i386", "i686"]
    else:
        arch_tokens = [machine]

    return os_tokens, arch_tokens


def _score_asset(name: str, os_tokens: list[str], arch_tokens: list[str]) -> int:
    lower = name.lower()
    if any(t in lower for t in ("sha256", "checksum", "checksums", "sig", "source")):
        return -100
    score = 0
    if "cliproxyapi" in lower or "cli-proxy" in lower or "cli_proxy" in lower:
        score += 4
    if any(tok in lower for tok in os_tokens):
        score += 3
    if any(tok in lower for tok in arch_tokens):
        score += 3
    if lower.endswith((".zip", ".tar.gz", ".tgz", ".gz", ".exe")):
        score += 1
    if "debug" in lower or "dev" in lower:
        score -= 1
    return score


def _select_asset(assets: list[dict[str, Any]]) -> ReleaseAsset | None:
    os_tokens, arch_tokens = _platform_tokens()
    best_score = -1
    best_asset: ReleaseAsset | None = None
    for asset in assets:
        name = asset.get("name")
        url = asset.get("browser_download_url")
        if not isinstance(name, str) or not isinstance(url, str):
            continue
        score = _score_asset(name, os_tokens, arch_tokens)
        if score > best_score:
            best_score = score
            best_asset = ReleaseAsset(name=name, url=url)
    return best_asset


def _download_file(url: str, dest: Path) -> None:
    headers = {"User-Agent": "OpenCowork-CLIProxyAPI"}
    with httpx.stream("GET", url, headers=headers, timeout=60.0, follow_redirects=True) as resp:
        resp.raise_for_status()
        with dest.open("wb") as f:
            for chunk in resp.iter_bytes():
                f.write(chunk)


def _find_binary(extract_dir: Path) -> Path | None:
    candidates: list[Path] = []
    known_names = {
        "cliproxyapi",
        "cliproxyapi.exe",
        "cli-proxy-api",
        "cli-proxy-api.exe",
        "cli_proxy_api",
        "cli_proxy_api.exe",
    }
    skip_ext = (".md", ".txt", ".yaml", ".yml", ".json", ".toml", ".ini", ".cfg")

    for path in extract_dir.rglob("*"):
        if not path.is_file():
            continue
        lower = path.name.lower()
        if lower.endswith(skip_ext):
            continue
        if lower in known_names or "cliproxyapi" in lower or "cli-proxy-api" in lower or "cli_proxy_api" in lower:
            candidates.append(path)

    if not candidates:
        return None

    # Prefer exact name matches first.
    for name in ("cliproxyapi.exe", "cliproxyapi", "cli-proxy-api.exe", "cli-proxy-api", "cli_proxy_api.exe", "cli_proxy_api"):
        for candidate in candidates:
            if candidate.name.lower() == name:
                return candidate

    # Prefer executable files, then shallow paths.
    executable = [c for c in candidates if os.access(c, os.X_OK)]
    if executable:
        executable.sort(key=lambda p: len(p.parts))
        return executable[0]

    candidates.sort(key=lambda p: len(p.parts))
    return candidates[0]


def _extract_archive(archive_path: Path, dest_binary: Path) -> None:
    suffix = archive_path.name.lower()
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_root = Path(tmpdir)
        if suffix.endswith(".zip"):
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(tmp_root)
        elif suffix.endswith(".tar.gz") or suffix.endswith(".tgz"):
            with tarfile.open(archive_path, "r:gz") as tf:
                tf.extractall(tmp_root)
        elif suffix.endswith(".gz"):
            # Single gzip file
            with gzip.open(archive_path, "rb") as gz, dest_binary.open("wb") as out:
                shutil.copyfileobj(gz, out)
            return
        else:
            shutil.copy2(archive_path, dest_binary)
            return

        bin_path = _find_binary(tmp_root)
        if not bin_path:
            raise RuntimeError("Failed to locate CLIProxyAPI binary in archive")
        shutil.copy2(bin_path, dest_binary)


def _ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def fetch_latest_release() -> tuple[str, list[dict[str, Any]]]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "OpenCowork-CLIProxyAPI"}
    resp = httpx.get(GITHUB_API_LATEST, headers=headers, timeout=15.0)
    resp.raise_for_status()
    data = resp.json()
    tag = data.get("tag_name") or data.get("name") or ""
    assets = data.get("assets") or []
    if not isinstance(tag, str) or not tag:
        raise RuntimeError("Missing release version from GitHub API")
    if not isinstance(assets, list):
        assets = []
    return tag, assets


def download_latest_binary() -> tuple[str, Path]:
    ensure_config()
    tag, assets = fetch_latest_release()
    asset = _select_asset(assets)
    if not asset:
        raise RuntimeError("No matching CLIProxyAPI release asset found")

    is_windows = os.name == "nt"
    binary_name = f"cliproxyapi-{tag}"
    if is_windows:
        binary_name += ".exe"
    dest_binary = BIN_DIR / binary_name
    if dest_binary.exists():
        _write_current(tag, dest_binary)
        return tag, dest_binary

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir) / asset.name
        _download_file(asset.url, tmp_path)
        _extract_archive(tmp_path, dest_binary)
        _ensure_executable(dest_binary)
        _write_current(tag, dest_binary)
        return tag, dest_binary


def _pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def is_running() -> bool:
    if not PID_FILE.exists():
        return False
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        return False
    return _pid_running(pid)


def start() -> None:
    ensure_config()
    binary = _current_binary_path()
    if not binary:
        download_latest_binary()
        binary = _current_binary_path()
    if not binary:
        raise RuntimeError("CLIProxyAPI binary not available")
    if is_running():
        return

    _ensure_dirs()
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log_handle = LOG_FILE.open("ab")
    proc = subprocess.Popen(
        [str(binary), "-config", str(CONFIG_PATH)],
        stdout=log_handle,
        stderr=log_handle,
        cwd=str(STORAGE_DIR),
    )
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")


def stop() -> None:
    if not PID_FILE.exists():
        return
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        pid = None
    if pid and _pid_running(pid):
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False)
        else:
            try:
                os.kill(pid, 15)
            except Exception:
                pass
            deadline = time.time() + 5
            while time.time() < deadline:
                if not _pid_running(pid):
                    break
                time.sleep(0.2)
            if _pid_running(pid):
                try:
                    os.kill(pid, 9)
                except Exception:
                    pass
    try:
        PID_FILE.unlink()
    except Exception:
        pass


def restart() -> None:
    stop()
    start()


def health_check() -> tuple[bool, dict[str, str]]:
    key = get_management_key()
    if not key:
        return False, {}
    url = f"{management_base_url().rstrip('/')}/get-auth-status"
    try:
        resp = httpx.get(
            url,
            headers={"Authorization": f"Bearer {key}"},
            timeout=5.0,
        )
        if resp.status_code >= 400:
            return False, {}
        headers = {
            "version": resp.headers.get("X-CPA-VERSION", ""),
            "commit": resp.headers.get("X-CPA-COMMIT", ""),
            "build_date": resp.headers.get("X-CPA-BUILD-DATE", ""),
        }
        return True, headers
    except Exception:
        return False, {}


def get_latest_version_via_management() -> str | None:
    key = get_management_key()
    if not key:
        return None
    url = f"{management_base_url().rstrip('/')}/latest-version"
    try:
        resp = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=8.0)
        if resp.status_code >= 400:
            return None
        data = resp.json()
        version = data.get("latest-version")
        if isinstance(version, str):
            return version.strip()
    except Exception:
        return None
    return None


def status() -> dict[str, Any]:
    running = is_running()
    base_url = get_base_url()
    current_version = _current_version()
    latest_version = None
    version_headers: dict[str, str] = {}
    healthy = False
    if running:
        healthy, version_headers = health_check()
        latest_version = get_latest_version_via_management()
    if not latest_version:
        try:
            latest_version, _ = fetch_latest_release()
        except Exception:
            latest_version = None

    upgrade_available = False
    if current_version and latest_version:
        upgrade_available = current_version != latest_version

    return {
        "running": running,
        "healthy": healthy,
        "base_url": base_url,
        "config_path": str(CONFIG_PATH),
        "pid": PID_FILE.read_text(encoding="utf-8").strip() if PID_FILE.exists() else "",
        "version": version_headers.get("version") or current_version,
        "latest_version": latest_version or "",
        "upgrade_available": upgrade_available,
        "management_ui": f"{base_url.rstrip('/')}/management.html",
    }


def upgrade() -> None:
    download_latest_binary()
    if is_running():
        restart()


async def ensure_started_async() -> None:
    await asyncio.to_thread(ensure_started)


def ensure_started() -> None:
    ensure_config()
    if not _current_binary_path():
        download_latest_binary()
    if not is_running():
        start()
    # Best-effort readiness wait
    for _ in range(12):
        healthy, _ = health_check()
        if healthy:
            break
        time.sleep(0.5)


async def stop_async() -> None:
    await asyncio.to_thread(stop)
