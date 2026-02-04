"""Skill source search and installation helpers (Python port of skills CLI)."""
from __future__ import annotations

import hashlib
import html
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from core.skills_catalog import SKILLS_DIR, rebuild_catalog


SKILLS_SH_BASE = "https://skills.sh"
SKILLS_SH_SEARCH_API = f"{SKILLS_SH_BASE}/api/search"

SKILL_FILENAME = "SKILL.md"
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__"}


class SkillInstallError(RuntimeError):
    pass


@dataclass
class ParsedSource:
    type: str
    url: str
    ref: Optional[str] = None
    subpath: Optional[str] = None
    skill_filter: Optional[str] = None
    local_path: Optional[str] = None


async def _fetch_text(url: str, timeout: float = 30.0) -> str:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        return resp.text


async def _fetch_json(url: str, timeout: float = 30.0) -> Any:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        return resp.json()


async def _fetch_bytes(url: str, timeout: float = 60.0) -> bytes:
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        return resp.content


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _short_hash(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:8]


def sanitize_name(name: str) -> str:
    sanitized = (
        name.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace("\\", "-")
    )
    sanitized = re.sub(r"[^a-z0-9._-]+", "-", sanitized)
    sanitized = re.sub(r"^[.\-]+|[.\-]+$", "", sanitized)
    return sanitized[:255] or "unnamed-skill"


def _is_local_path(value: str) -> bool:
    return (
        os.path.isabs(value)
        or value.startswith("./")
        or value.startswith("../")
        or value in {".", ".."}
        or re.match(r"^[a-zA-Z]:[/\\\\]", value) is not None
    )


def _is_direct_skill_url(value: str) -> bool:
    if not (value.startswith("http://") or value.startswith("https://")):
        return False
    if not value.lower().endswith("/skill.md"):
        return False
    if "github.com/" in value and "raw.githubusercontent.com" not in value:
        if "/blob/" not in value and "/raw/" not in value:
            return False
    if "gitlab.com/" in value and "/-/raw/" not in value:
        return False
    return True


def _is_well_known_url(value: str) -> bool:
    if not (value.startswith("http://") or value.startswith("https://")):
        return False
    try:
        parsed = httpx.URL(value)
    except Exception:
        return False
    excluded_hosts = {"github.com", "gitlab.com", "huggingface.co", "raw.githubusercontent.com"}
    if parsed.host in excluded_hosts:
        return False
    if value.lower().endswith("/skill.md"):
        return False
    if value.endswith(".git"):
        return False
    return True


def parse_source(value: str) -> ParsedSource:
    if _is_local_path(value):
        resolved = str(Path(value).resolve())
        return ParsedSource(type="local", url=resolved, local_path=resolved)

    if _is_direct_skill_url(value):
        return ParsedSource(type="direct-url", url=value)

    github_tree_path = re.match(r"github\.com/([^/]+)/([^/]+)/tree/([^/]+)/(.+)", value)
    if github_tree_path:
        owner, repo, ref, subpath = github_tree_path.groups()
        return ParsedSource(
            type="github",
            url=f"https://github.com/{owner}/{repo}.git",
            ref=ref,
            subpath=subpath,
        )

    github_tree = re.match(r"github\.com/([^/]+)/([^/]+)/tree/([^/]+)$", value)
    if github_tree:
        owner, repo, ref = github_tree.groups()
        return ParsedSource(
            type="github",
            url=f"https://github.com/{owner}/{repo}.git",
            ref=ref,
        )

    github_repo = re.match(r"github\.com/([^/]+)/([^/]+)", value)
    if github_repo:
        owner, repo = github_repo.groups()
        repo = repo.replace(".git", "")
        return ParsedSource(type="github", url=f"https://github.com/{owner}/{repo}.git")

    gitlab_tree_path = re.match(r"^(https?)://([^/]+)/(.+?)/-/tree/([^/]+)/(.+)", value)
    if gitlab_tree_path:
        protocol, host, repo_path, ref, subpath = gitlab_tree_path.groups()
        if host != "github.com":
            repo_path = repo_path.replace(".git", "")
            return ParsedSource(
                type="gitlab",
                url=f"{protocol}://{host}/{repo_path}.git",
                ref=ref,
                subpath=subpath,
            )

    gitlab_tree = re.match(r"^(https?)://([^/]+)/(.+?)/-/tree/([^/]+)$", value)
    if gitlab_tree:
        protocol, host, repo_path, ref = gitlab_tree.groups()
        if host != "github.com":
            repo_path = repo_path.replace(".git", "")
            return ParsedSource(type="gitlab", url=f"{protocol}://{host}/{repo_path}.git", ref=ref)

    gitlab_repo = re.match(r"gitlab\.com/([^/]+)/([^/]+)", value)
    if gitlab_repo:
        owner, repo = gitlab_repo.groups()
        repo = repo.replace(".git", "")
        return ParsedSource(type="gitlab", url=f"https://gitlab.com/{owner}/{repo}.git")

    at_skill = re.match(r"^([^/]+)/([^/@]+)@(.+)$", value)
    if at_skill and ":" not in value and not value.startswith(".") and not value.startswith("/"):
        owner, repo, skill_filter = at_skill.groups()
        return ParsedSource(
            type="github",
            url=f"https://github.com/{owner}/{repo}.git",
            skill_filter=skill_filter,
        )

    shorthand = re.match(r"^([^/]+)/([^/]+)(?:/(.+))?$", value)
    if shorthand and ":" not in value and not value.startswith(".") and not value.startswith("/"):
        owner, repo, subpath = shorthand.groups()
        return ParsedSource(
            type="github",
            url=f"https://github.com/{owner}/{repo}.git",
            subpath=subpath,
        )

    if _is_well_known_url(value):
        return ParsedSource(type="well-known", url=value)

    return ParsedSource(type="git", url=value)


def _parse_frontmatter(text: str) -> Dict[str, str]:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    frontmatter = parts[1].strip("\n")
    data: Dict[str, str] = {}
    lines = frontmatter.splitlines()
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
            block: List[str] = []
            while idx < len(lines):
                block_line = lines[idx]
                if block_line.startswith(" ") or block_line.startswith("\t"):
                    block.append(block_line.lstrip())
                    idx += 1
                else:
                    break
            data[key] = "\n".join(block).strip()
        else:
            if value.startswith("\"") and value.endswith("\""):
                value = value[1:-1]
            if value.startswith("'") and value.endswith("'"):
                value = value[1:-1]
            data[key] = value
    return data


@dataclass
class SkillEntry:
    name: str
    description: str
    path: Path


def _has_skill_md(path: Path) -> bool:
    return (path / SKILL_FILENAME).is_file()


def _find_skill_dirs(base: Path, depth: int = 0, max_depth: int = 5) -> List[Path]:
    if depth > max_depth:
        return []
    if not base.exists():
        return []
    skill_dirs: List[Path] = []
    if _has_skill_md(base):
        skill_dirs.append(base)
    try:
        for entry in base.iterdir():
            if not entry.is_dir():
                continue
            if entry.name in SKIP_DIRS:
                continue
            skill_dirs.extend(_find_skill_dirs(entry, depth + 1, max_depth))
    except Exception:
        pass
    return skill_dirs


def _discover_skills(base_path: Path, subpath: Optional[str], full_depth: bool) -> List[SkillEntry]:
    skills: List[SkillEntry] = []
    seen = set()
    search_path = base_path / subpath if subpath else base_path

    if _has_skill_md(search_path):
        entry = _parse_skill_entry(search_path)
        if entry:
            skills.append(entry)
            seen.add(entry.name.lower())
            if not full_depth:
                return skills

    priority_dirs = [
        search_path,
        search_path / "skills",
        search_path / "skills/.curated",
        search_path / "skills/.experimental",
        search_path / "skills/.system",
        search_path / ".agent/skills",
        search_path / ".agents/skills",
        search_path / ".claude/skills",
        search_path / ".codex/skills",
    ]

    for dir_path in priority_dirs:
        try:
            for entry in dir_path.iterdir():
                if entry.is_dir() and _has_skill_md(entry):
                    skill = _parse_skill_entry(entry)
                    if skill and skill.name.lower() not in seen:
                        skills.append(skill)
                        seen.add(skill.name.lower())
        except Exception:
            continue

    if not skills:
        for skill_dir in _find_skill_dirs(search_path):
            skill = _parse_skill_entry(skill_dir)
            if skill and skill.name.lower() not in seen:
                skills.append(skill)
                seen.add(skill.name.lower())

    return skills


def _parse_skill_entry(skill_dir: Path) -> Optional[SkillEntry]:
    skill_md = skill_dir / SKILL_FILENAME
    try:
        text = skill_md.read_text(encoding="utf-8")
    except Exception:
        return None
    frontmatter = _parse_frontmatter(text)
    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not name or not description:
        return None
    return SkillEntry(name=name, description=description, path=skill_dir)


def _filter_skills(skills: List[SkillEntry], names: List[str]) -> List[SkillEntry]:
    if not names:
        return skills
    normalized = [n.lower() for n in names]
    filtered = []
    for skill in skills:
        name = skill.name.lower()
        display = skill.path.name.lower()
        if any(n == name or n == display for n in normalized):
            filtered.append(skill)
    return filtered


def _safe_extract_zip(zip_path: Path, dest_dir: Path) -> None:
    with zipfile.ZipFile(zip_path) as zip_file:
        for member in zip_file.infolist():
            member_path = dest_dir / member.filename
            resolved = member_path.resolve()
            if not str(resolved).startswith(str(dest_dir.resolve())):
                raise SkillInstallError("Unsafe zip contents detected.")
        zip_file.extractall(dest_dir)


def _clone_repo(url: str, ref: Optional[str]) -> Path:
    if shutil.which("git") is None:
        raise SkillInstallError("git is required to install from repository URLs")
    tmp_dir = Path(tempfile.mkdtemp(prefix="skills-git-"))
    cmd = ["git", "clone", "--depth", "1"]
    if ref:
        cmd.extend(["--branch", ref])
    cmd.extend([url, str(tmp_dir)])
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired as exc:
        raise SkillInstallError("git clone timed out after 60s") from exc
    except subprocess.CalledProcessError as exc:
        raise SkillInstallError(exc.stderr.strip() or "git clone failed") from exc
    return tmp_dir


async def _download_github_zip(url: str, ref: Optional[str]) -> Optional[Path]:
    match = re.search(r"github\.com/([^/]+)/([^/.]+)", url)
    if not match:
        return None
    owner, repo = match.groups()
    branches = [ref] if ref else []
    branches.extend(["main", "master"])
    tmp_dir = Path(tempfile.mkdtemp(prefix="skills-gh-"))
    for branch in branches:
        if not branch:
            continue
        zip_url = f"https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip"
        try:
            data = await _fetch_bytes(zip_url)
        except Exception:
            continue
        zip_path = tmp_dir / f"{repo}-{branch}.zip"
        zip_path.write_bytes(data)
        return zip_path
    return None


def _source_id_for(parsed: ParsedSource) -> str:
    if parsed.type == "github":
        match = re.search(r"github\.com/([^/]+)/([^/.]+)", parsed.url)
        if match:
            owner, repo = match.groups()
            return f"github/{owner}/{repo}"
    if parsed.type == "gitlab":
        parsed_url = httpx.URL(parsed.url)
        repo_path = parsed_url.path.lstrip("/").replace(".git", "")
        return f"gitlab/{parsed_url.host}/{repo_path}"
    if parsed.type == "git":
        host = "git"
        repo = "repo"
        url = parsed.url
        if url.startswith("git@"):
            # git@github.com:owner/repo.git
            try:
                host_part, path_part = url.split("@", 1)[1].split(":", 1)
                host = host_part or host
                repo = path_part.strip("/").replace(".git", "") or repo
            except Exception:
                pass
        else:
            try:
                parsed_url = httpx.URL(url)
                host = parsed_url.host or host
                repo = parsed_url.path.strip("/").replace(".git", "") or repo
            except Exception:
                repo = sanitize_name(url)
        return f"git/{host}/{sanitize_name(repo)}"
    if parsed.type == "local":
        base = Path(parsed.local_path or parsed.url).name
        return f"local/{sanitize_name(base)}"
    if parsed.type == "direct-url":
        parsed_url = httpx.URL(parsed.url)
        return f"direct/{parsed_url.host}/{_short_hash(parsed.url)}"
    if parsed.type == "well-known":
        parsed_url = httpx.URL(parsed.url)
        return f"wellknown/{parsed_url.host}"
    return f"unknown/{_short_hash(parsed.url)}"


def _install_skill_dir(skill_dir: Path, source_id: str, skill_name: str) -> Path:
    dest_dir = SKILLS_DIR / source_id / sanitize_name(skill_name)
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    dest_dir.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(skill_dir, dest_dir)
    return dest_dir


async def search_skills_sh(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    if not query:
        return []
    params = httpx.QueryParams({"q": query, "limit": str(limit)})
    url = f"{SKILLS_SH_SEARCH_API}?{params}"
    data = await _fetch_json(url)
    skills = data.get("skills", []) if isinstance(data, dict) else []
    if not isinstance(skills, list):
        return []
    results: List[Dict[str, Any]] = []
    for skill in skills:
        name = skill.get("name")
        slug = skill.get("id")
        source = skill.get("source") or ""
        installs = skill.get("installs")
        if not name or not slug:
            continue
        package = source or slug
        results.append(
            {
                "name": name,
                "slug": slug,
                "source": source,
                "package": package,
                "installs": installs,
                "detail_url": f"{SKILLS_SH_BASE}/{package}/{slug}",
            }
        )
    return results[:limit]


async def _install_from_direct_url(url: str) -> List[Path]:
    content = await _fetch_text(url)
    frontmatter = _parse_frontmatter(content)
    name = frontmatter.get("name")
    description = frontmatter.get("description")
    if not name or not description:
        raise SkillInstallError("SKILL.md missing name/description")

    tmp_dir = Path(tempfile.mkdtemp(prefix="skills-direct-"))
    skill_dir = tmp_dir / sanitize_name(name)
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / SKILL_FILENAME).write_text(content, encoding="utf-8")
    source_id = _source_id_for(ParsedSource(type="direct-url", url=url))
    dest_dir = _install_skill_dir(skill_dir, source_id, name)
    return [dest_dir]


async def _fetch_well_known_index(url: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    parsed = httpx.URL(url)
    base_path = parsed.path.rstrip("/")
    candidates = [
        (f"{parsed.scheme}://{parsed.host}{base_path}/.well-known/skills/index.json", f"{parsed.scheme}://{parsed.host}{base_path}"),
    ]
    if base_path:
        candidates.append(
            (
                f"{parsed.scheme}://{parsed.host}/.well-known/skills/index.json",
                f"{parsed.scheme}://{parsed.host}",
            )
        )
    for index_url, base_url in candidates:
        try:
            data = await _fetch_json(index_url)
        except Exception:
            continue
        if isinstance(data, dict) and isinstance(data.get("skills"), list):
            return data, base_url
    return None, None


async def _install_from_well_known(url: str, skill_name: Optional[str]) -> List[Path]:
    index, base_url = await _fetch_well_known_index(url)
    if not index or not base_url:
        raise SkillInstallError("Well-known skills index not found")

    entries = index.get("skills", [])
    if not entries:
        raise SkillInstallError("Well-known skills index is empty")

    if skill_name:
        entries = [entry for entry in entries if entry.get("name") == skill_name]
        if not entries:
            raise SkillInstallError(f"Skill not found in well-known index: {skill_name}")
    elif len(entries) > 1:
        names = ", ".join(entry.get("name") for entry in entries if entry.get("name"))
        raise SkillInstallError(f"Multiple skills available. Specify one: {names}")

    installed: List[Path] = []
    source_id = _source_id_for(ParsedSource(type="well-known", url=url))
    for entry in entries:
        name = entry.get("name")
        files = entry.get("files", [])
        if not name or not isinstance(files, list):
            continue
        skill_base = f"{base_url}/.well-known/skills/{name}"
        tmp_dir = Path(tempfile.mkdtemp(prefix="skills-wellknown-"))
        skill_dir = tmp_dir / sanitize_name(name)
        skill_dir.mkdir(parents=True, exist_ok=True)
        for file_path in files:
            if not isinstance(file_path, str):
                continue
            if file_path.startswith("/") or ".." in file_path:
                continue
            file_url = f"{skill_base}/{file_path}"
            try:
                content = await _fetch_text(file_url)
            except Exception:
                continue
            target_path = skill_dir / file_path
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding="utf-8")
        if not (skill_dir / SKILL_FILENAME).exists():
            continue
        dest_dir = _install_skill_dir(skill_dir, source_id, name)
        installed.append(dest_dir)
    if not installed:
        raise SkillInstallError("Failed to install skill from well-known source")
    return installed


async def install_from_package(
    package: str,
    skill: Optional[str] = None,
    full_depth: bool = False,
) -> Dict[str, Any]:
    parsed = parse_source(package)
    skill_names: List[str] = []
    if skill:
        skill_names = [skill]
    if parsed.skill_filter:
        skill_names.append(parsed.skill_filter)

    installed_paths: List[Path] = []
    temp_dir: Optional[Path] = None

    try:
        if parsed.type == "direct-url":
            installed_paths = await _install_from_direct_url(parsed.url)
        elif parsed.type == "well-known":
            installed_paths = await _install_from_well_known(parsed.url, skill_names[0] if skill_names else None)
        else:
            if parsed.type == "local":
                repo_path = Path(parsed.local_path or parsed.url)
            elif parsed.type == "github":
                zip_path = await _download_github_zip(parsed.url, parsed.ref)
                if zip_path:
                    temp_root = zip_path.parent
                    extract_dir = temp_root / "extract"
                    extract_dir.mkdir(exist_ok=True)
                    _safe_extract_zip(zip_path, extract_dir)
                    top_levels = [p for p in extract_dir.iterdir() if p.is_dir()]
                    repo_path = top_levels[0] if len(top_levels) == 1 else extract_dir
                    temp_dir = temp_root
                else:
                    temp_dir = _clone_repo(parsed.url, parsed.ref)
                    repo_path = temp_dir
            else:
                temp_dir = _clone_repo(parsed.url, parsed.ref)
                repo_path = temp_dir

            skills = _discover_skills(repo_path, parsed.subpath, full_depth)
            skills = _filter_skills(skills, skill_names)

            if not skills:
                raise SkillInstallError("No matching skills found in source")

            if len(skills) > 1 and not skill_names:
                names = ", ".join(skill.name for skill in skills)
                raise SkillInstallError(f"Multiple skills found. Specify one: {names}")

            source_id = _source_id_for(parsed)
            for skill_entry in skills:
                installed_paths.append(
                    _install_skill_dir(skill_entry.path, source_id, skill_entry.name)
                )
    finally:
        if temp_dir and temp_dir.exists():
            shutil.rmtree(temp_dir, ignore_errors=True)

    catalog = rebuild_catalog()
    return {
        "installed": [str(path) for path in installed_paths],
        "catalog": catalog,
    }


def remove_skill_from_library(skill_id: str) -> Dict[str, Any]:
    if not skill_id:
        raise SkillInstallError("skill_id is required")
    catalog = rebuild_catalog()
    entry = catalog.get("skills", {}).get(skill_id)
    if not entry:
        raise SkillInstallError(f"Skill not found: {skill_id}")
    source = entry.get("source", {})
    rel_path = source.get("path")
    if not rel_path:
        raise SkillInstallError("Skill path missing in catalog")
    target = (SKILLS_DIR / rel_path).resolve()
    if not str(target).startswith(str(SKILLS_DIR.resolve())):
        raise SkillInstallError("Invalid skill path")
    if target.exists():
        shutil.rmtree(target)
    catalog = rebuild_catalog()
    return catalog
