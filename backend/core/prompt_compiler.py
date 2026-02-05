"""
Prompt compiler for global + project system prompts.
Builds system_prompt object using Claude Code preset + append strategy.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Iterable, Tuple

from models.settings import AppSettings
from models.workspace import Workspace, WorkspaceConfig


@dataclass
class CompiledPrompt:
    system_prompt: dict
    append_text: str


def _format_time_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _format_time_local() -> str:
    local_dt = datetime.now().astimezone()
    # Include offset for clarity, e.g. 2026-02-05 10:23 UTC+08:00
    offset = local_dt.strftime("%z")
    if offset and len(offset) == 5:
        offset = f"{offset[:3]}:{offset[3:]}"
    tz_label = local_dt.tzname() or "local"
    return local_dt.strftime(f"%Y-%m-%d %H:%M {tz_label}{offset}")


def _replace_placeholders(text: str, cwd: str, project_root: str, project_name: str) -> str:
    return (
        text.replace("{{TIME_UTC}}", _format_time_utc())
        .replace("{{TIME_LOCAL}}", _format_time_local())
        .replace("{{CWD}}", cwd)
        .replace("{{PROJECT_ROOT}}", project_root)
        .replace("{{PROJECT_NAME}}", project_name)
    )


def _collect_parts(parts: Iterable[Optional[str]]) -> list[str]:
    output: list[str] = []
    for part in parts:
        if not part:
            continue
        cleaned = str(part).strip()
        if cleaned:
            output.append(cleaned)
    return output


def compile_system_prompt(
    settings: AppSettings,
    workspace: Optional[Workspace],
    workspace_config: Optional[WorkspaceConfig],
    cwd: Optional[str],
    extra_append: Optional[Iterable[str]] = None,
) -> CompiledPrompt:
    """
    Compile system prompt using Claude Code preset + append.

    Append order:
    1) global template
    2) project system prompt (if enabled)
    3) extra_append (e.g. worker policy)
    """
    base_preset = settings.prompt_base_preset or "claude_code"

    project_prompt = ""
    if workspace_config and workspace_config.project_system_prompt_enabled:
        project_prompt = workspace_config.project_system_prompt or ""

    append_parts = _collect_parts(
        [
            settings.prompt_global_template,
            project_prompt,
            *list(extra_append or []),
        ]
    )

    append_text = "\n\n".join(append_parts)

    effective_cwd = cwd or ""
    project_root = ""
    project_name = ""
    if workspace and workspace.path:
        project_root = workspace.path
        project_name = Path(workspace.path).name
    elif cwd:
        project_root = cwd
        project_name = Path(cwd).name

    if append_text:
        append_text = _replace_placeholders(
            append_text,
            effective_cwd,
            project_root,
            project_name,
        )

    system_prompt: dict
    if append_text:
        system_prompt = {
            "type": "preset",
            "preset": base_preset,
            "append": append_text,
        }
    else:
        system_prompt = {
            "type": "preset",
            "preset": base_preset,
        }

    return CompiledPrompt(system_prompt=system_prompt, append_text=append_text)
