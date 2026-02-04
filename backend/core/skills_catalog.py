"""Skill catalog builder for storage/skills.

Scans storage/skills for SKILL.md directories and writes catalog.json with
structured metadata. Dependency hints are informational only and never executed.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


REPO_ROOT = Path(__file__).parent.parent.parent
STORAGE_DIR = REPO_ROOT / "storage"
SKILLS_DIR = STORAGE_DIR / "skills"
CATALOG_PATH = SKILLS_DIR / "catalog.json"

SKILL_FILENAME = "SKILL.md"

IGNORED_DIR_NAMES = {
    ".git",
    ".cache",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    "dist",
    "build",
}

DEPENDENCY_FILES = {
    "requirements.txt",
    "pyproject.toml",
    "package.json",
    "go.mod",
    "Cargo.toml",
}

SCRIPT_FILES = {
    "install.sh",
    "setup.sh",
}

DEPENDENCY_COMMAND_PATTERNS = [
    re.compile(r"\bpip3?\s+install\b", re.IGNORECASE),
    re.compile(r"\bpoetry\s+install\b", re.IGNORECASE),
    re.compile(r"\bnpm\s+install\b", re.IGNORECASE),
    re.compile(r"\byarn\s+install\b", re.IGNORECASE),
    re.compile(r"\bpnpm\s+install\b", re.IGNORECASE),
    re.compile(r"\bbrew\s+install\b", re.IGNORECASE),
    re.compile(r"\bapt(-get)?\s+install\b", re.IGNORECASE),
    re.compile(r"\bchoco\s+install\b", re.IGNORECASE),
]


def ensure_skills_dir() -> None:
    """Ensure storage/skills exists."""
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_ignored(path: Path) -> bool:
    return any(part in IGNORED_DIR_NAMES for part in path.parts)


def _iter_files(base_dir: Path) -> Iterable[Path]:
    for path in base_dir.rglob("*"):
        if _is_ignored(path):
            continue
        if path.is_file():
            yield path


def _hash_directory(base_dir: Path) -> Tuple[str, int, int]:
    """Compute hash and file stats for a directory."""
    hasher = hashlib.sha256()
    file_count = 0
    size_bytes = 0

    for path in sorted(_iter_files(base_dir)):
        rel = path.relative_to(base_dir).as_posix()
        try:
            data = path.read_bytes()
        except Exception:
            data = b""
        hasher.update(rel.encode("utf-8"))
        hasher.update(b"\n")
        hasher.update(data)
        hasher.update(b"\n")
        file_count += 1
        size_bytes += len(data)

    return f"sha256:{hasher.hexdigest()}", file_count, size_bytes


def _parse_frontmatter(skill_md: Path) -> Dict[str, str]:
    """Parse minimal YAML frontmatter for name/description.

    This is intentionally minimal to avoid external dependencies.
    """
    try:
        text = skill_md.read_text(encoding="utf-8")
    except Exception:
        return {}

    if not text.startswith("---"):
        return {}

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}

    frontmatter = parts[1].strip("\n")
    lines = frontmatter.splitlines()

    data: Dict[str, str] = {}
    idx = 0
    while idx < len(lines):
        line = lines[idx].rstrip()
        idx += 1
        if not line or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value in {"|", ">", "|-", ">-"}:
            block_lines: List[str] = []
            while idx < len(lines):
                block_line = lines[idx]
                if block_line.startswith(" ") or block_line.startswith("\t"):
                    block_lines.append(block_line.lstrip())
                    idx += 1
                else:
                    break
            data[key] = "\n".join(block_lines).strip()
        else:
            if value.startswith("\"") and value.endswith("\""):
                value = value[1:-1]
            if value.startswith("'") and value.endswith("'"):
                value = value[1:-1]
            data[key] = value

    return data


def _detect_dependency_hints(skill_dir: Path) -> Dict[str, Any]:
    signals: List[Dict[str, str]] = []

    for path in _iter_files(skill_dir):
        rel = path.relative_to(skill_dir).as_posix()
        if path.name in DEPENDENCY_FILES:
            signals.append({"kind": "file", "value": rel, "confidence": "high"})
        if path.name in SCRIPT_FILES or path.suffix == ".sh":
            signals.append({"kind": "file", "value": rel, "confidence": "medium"})

    skill_md = skill_dir / SKILL_FILENAME
    try:
        text = skill_md.read_text(encoding="utf-8")
    except Exception:
        text = ""

    for pattern in DEPENDENCY_COMMAND_PATTERNS:
        if pattern.search(text):
            signals.append({"kind": "command", "value": pattern.pattern, "confidence": "low"})

    if not signals:
        return {"summary": "", "signals": []}

    summary = "Potential dependencies or setup steps detected."
    return {"summary": summary, "signals": signals}


def _detect_risk_signals(skill_dir: Path) -> List[str]:
    signals: List[str] = []
    if (skill_dir / "scripts").is_dir():
        signals.append("scripts/ present")
    for path in _iter_files(skill_dir):
        if path.name in SCRIPT_FILES or path.suffix == ".sh":
            signals.append(f"script file: {path.relative_to(skill_dir).as_posix()}")
            break
    return signals


def _classify_source(source_id: str) -> str:
    if source_id == "local":
        return "local"
    head = source_id.split("/", 1)[0]
    if head in {"agent-skills", "skills.sh", "git"}:
        return head
    if head in {"skills", "skills-sh"}:
        return "skills.sh"
    if source_id.startswith("git:"):
        return "git"
    return "local"


def _source_from_path(skill_dir: Path) -> Tuple[str, Dict[str, Any]]:
    rel_parts = skill_dir.relative_to(SKILLS_DIR).parts
    if len(rel_parts) >= 2:
        source_id = "/".join(rel_parts[:-1])
    else:
        source_id = "local"

    source_type = _classify_source(source_id)
    source = {
        "type": source_type,
        "id": source_id,
        "repo_url": None,
        "path": "/".join(rel_parts),
        "ref": None,
        "fetched_at": _now_iso(),
    }
    return source_id, source


def _discover_skill_dirs() -> List[Path]:
    if not SKILLS_DIR.exists():
        return []
    skill_dirs: List[Path] = []
    for path in SKILLS_DIR.rglob(SKILL_FILENAME):
        if _is_ignored(path):
            continue
        skill_dirs.append(path.parent)
    return sorted(set(skill_dirs))


def build_catalog() -> Dict[str, Any]:
    """Build catalog data from storage/skills."""
    ensure_skills_dir()
    existing = load_catalog()
    existing_skills = existing.get("skills", {}) if isinstance(existing, dict) else {}

    now = _now_iso()
    skills: Dict[str, Any] = {}

    # Map existing entries by source.path for stable IDs when possible.
    existing_by_path: Dict[str, str] = {}
    for existing_id, entry in existing_skills.items():
        if not isinstance(entry, dict):
            continue
        source = entry.get("source", {})
        if isinstance(source, dict):
            path = source.get("path")
            if path:
                existing_by_path[path] = existing_id

    for skill_dir in _discover_skill_dirs():
        skill_md = skill_dir / SKILL_FILENAME
        frontmatter = _parse_frontmatter(skill_md)
        name = frontmatter.get("name") or skill_dir.name
        description = frontmatter.get("description") or ""

        source_id, source = _source_from_path(skill_dir)
        base_skill_id = f"{source_id}/{name}"
        source_path = source.get("path")
        skill_id = existing_by_path.get(source_path, base_skill_id)
        if skill_id in skills:
            rel_path = skill_dir.relative_to(SKILLS_DIR).as_posix()
            suffix = hashlib.sha1(rel_path.encode("utf-8")).hexdigest()[:8]
            skill_id = f"{base_skill_id}@{suffix}"

        content_hash, file_count, size_bytes = _hash_directory(skill_dir)
        dependency_hints = _detect_dependency_hints(skill_dir)
        risk_signals = _detect_risk_signals(skill_dir)

        previous = existing_skills.get(skill_id, {})
        imported_at = previous.get("timestamps", {}).get("imported_at", now)
        previous_hash = previous.get("content", {}).get("hash")
        if previous_hash == content_hash:
            updated_at = previous.get("timestamps", {}).get("updated_at", now)
        else:
            updated_at = now

        local_meta = previous.get("local") if isinstance(previous, dict) else None
        risk_level = "unknown"
        if local_meta and local_meta.get("risk_override"):
            risk_level = local_meta["risk_override"]

        status = previous.get("status", {"state": "active"})
        if status.get("state") == "removed":
            status = {"state": "active"}

        skill_entry: Dict[str, Any] = {
            "skill_id": skill_id,
            "name": name,
            "description": description,
            "source": source,
            "content": {
                "hash": content_hash,
                "file_count": file_count,
                "size_bytes": size_bytes,
            },
            "risk": {
                "level": risk_level,
                "signals": risk_signals,
            },
            "dependency_hints": dependency_hints,
            "status": status,
            "timestamps": {
                "imported_at": imported_at,
                "updated_at": updated_at,
            },
        }

        if local_meta:
            skill_entry["local"] = local_meta

        skills[skill_id] = skill_entry

    # Mark removed skills
    for skill_id, previous in existing_skills.items():
        if skill_id in skills:
            continue
        if not isinstance(previous, dict):
            continue
        previous_status = previous.get("status", {})
        if previous_status.get("state") != "removed":
            previous["status"] = {"state": "removed", "reason": "missing on disk"}
            previous.setdefault("timestamps", {})["updated_at"] = now
        skills[skill_id] = previous

    sources_summary: Dict[str, int] = {}
    for skill_id in skills.keys():
        source_id = skill_id.split("/", 1)[0]
        sources_summary[source_id] = sources_summary.get(source_id, 0) + 1

    return {
        "schema_version": 1,
        "generated_at": now,
        "skills": skills,
        "sources": sources_summary,
    }


def load_catalog() -> Dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {}
    try:
        return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_catalog(catalog: Dict[str, Any]) -> None:
    ensure_skills_dir()
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")


def rebuild_catalog() -> Dict[str, Any]:
    catalog = build_catalog()
    save_catalog(catalog)
    return catalog
