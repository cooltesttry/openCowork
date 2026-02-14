#!/usr/bin/env python3
"""Standalone probe for Team Leader /context capture behavior.

Purpose:
- Reproduce Team's Leader persistent-session flow.
- Verify where `/context` text actually appears:
  1) Worker.run_async(...).text
  2) AssistantMessage TextBlock(s)
  3) ResultMessage.result

This helps decide the correct extraction method for phase-review context usage.
"""

from __future__ import annotations

import argparse
import asyncio
import glob
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from super_agent.models import WorkerConfig
from super_agent.worker import ClaudeSdkWorker

_CONTEXT_HEADER = "## Context Usage"
_CONTEXT_SECTION = "### Estimated usage by category"
_CONTEXT_TABLE_HEADER = "| Category | Tokens | Percentage |"


def _parse_compact_number(value: str) -> Optional[int]:
    if not value:
        return None
    raw = value.strip().lower().replace(",", "").replace(" ", "")
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)([km]?)$", raw)
    if not match:
        return None
    number = float(match.group(1))
    suffix = match.group(2)
    if suffix == "k":
        number *= 1000
    elif suffix == "m":
        number *= 1_000_000
    return int(round(number))


def _extract_context_usage_tokens(content: str) -> Optional[tuple[int, int]]:
    if not content or not content.startswith(_CONTEXT_HEADER):
        return None
    if _CONTEXT_SECTION not in content or _CONTEXT_TABLE_HEADER not in content:
        return None

    tokens_line = None
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if "tokens:" in stripped.lower():
            tokens_line = stripped.replace("**", "")
            break
    if not tokens_line:
        return None

    match = re.search(r"Tokens:\s*([^/]+)\s*/\s*([^\s(]+)", tokens_line, re.IGNORECASE)
    if not match:
        return None
    used = _parse_compact_number(match.group(1).strip())
    window = _parse_compact_number(match.group(2).strip())
    if used is None or window is None:
        return None
    return used, window


def _preview(text: str, size: int) -> str:
    clean = (text or "").replace("\n", "\\n")
    if len(clean) <= size:
        return clean
    return clean[:size] + "..."


def _load_latest_team_session(team_dir: Path) -> Path:
    candidates = sorted(
        glob.glob(str(team_dir / "team-*.json")),
        key=lambda p: os.path.getmtime(p),
    )
    if not candidates:
        raise FileNotFoundError(f"No team session file found under: {team_dir}")
    return Path(candidates[-1])


def _load_lead_config(session_file: Path) -> tuple[WorkerConfig, Optional[Path], str]:
    data = json.loads(session_file.read_text(encoding="utf-8"))
    lead = data.get("lead_config")
    if not isinstance(lead, dict):
        raise ValueError(f"Invalid lead_config in session file: {session_file}")
    cfg = WorkerConfig.from_dict(lead)
    project_dir = data.get("project_dir")
    workspace = Path(project_dir) if isinstance(project_dir, str) and project_dir else None
    session_id = str(data.get("session_id") or session_file.stem)
    return cfg, workspace, session_id


@dataclass
class ProbeResult:
    worker_text: str
    worker_error: Optional[str]
    raw_assistant_text: str
    raw_user_text: str
    raw_result_text: str
    raw_usage: Optional[dict[str, Any]]
    raw_message_types: list[str]
    available_commands: list[str]


def _normalize_local_command_output(text: str) -> str:
    content = (text or "").strip()
    content = re.sub(r"^<local-command-stdout>\s*", "", content)
    content = re.sub(r"\s*</local-command-stdout>$", "", content)
    return content.strip()


async def _probe_context_capture(
    lead_cfg: WorkerConfig,
    workspace: Optional[Path],
    seed_prompt: str,
) -> ProbeResult:
    from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ResultMessage, TextBlock, UserMessage

    # Path A: Team-equivalent behavior using Worker.run_async(...).text
    worker = ClaudeSdkWorker()
    await worker.connect(lead_cfg, workspace=workspace)
    try:
        if seed_prompt:
            await worker.run_async(config=lead_cfg, prompt=seed_prompt, event_callback=None)
        worker_context = await worker.run_async(config=lead_cfg, prompt="/context", event_callback=None)
    finally:
        await worker.disconnect()

    # Path B/C: Raw SDK capture to inspect AssistantMessage vs ResultMessage.result
    options = ClaudeSdkWorker._build_options(lead_cfg, workspace)
    raw_assistant_parts: list[str] = []
    raw_user_parts: list[str] = []
    raw_result_text = ""
    raw_usage = None
    raw_message_types: list[str] = []
    available_commands: list[str] = []

    client = ClaudeSDKClient(options=options)
    await client.__aenter__()
    try:
        info = await client.get_server_info()
        if isinstance(info, dict):
            commands = info.get("commands")
            if isinstance(commands, list):
                for cmd in commands:
                    if isinstance(cmd, str):
                        available_commands.append(cmd)
                    elif isinstance(cmd, dict):
                        name = cmd.get("name") or cmd.get("command")
                        if isinstance(name, str):
                            available_commands.append(name)

        if seed_prompt:
            await client.query(seed_prompt)
            async for _ in client.receive_response():
                pass

        await client.query("/context")
        async for msg in client.receive_response():
            raw_message_types.append(type(msg).__name__)
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        raw_assistant_parts.append(block.text)
            elif isinstance(msg, UserMessage):
                content = msg.content
                if isinstance(content, str):
                    raw_user_parts.append(content)
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, str):
                            raw_user_parts.append(item)
            elif isinstance(msg, ResultMessage):
                raw_usage = msg.usage
                raw_result_text = (msg.result or "").strip()
    finally:
        await client.disconnect()

    return ProbeResult(
        worker_text=(worker_context.text or "").strip(),
        worker_error=worker_context.error,
        raw_assistant_text="".join(raw_assistant_parts).strip(),
        raw_user_text="".join(raw_user_parts).strip(),
        raw_result_text=raw_result_text,
        raw_usage=raw_usage,
        raw_message_types=raw_message_types,
        available_commands=available_commands,
    )


def _recommendation(result: ProbeResult) -> str:
    worker_ok = _extract_context_usage_tokens(result.worker_text) is not None
    assistant_ok = _extract_context_usage_tokens(result.raw_assistant_text) is not None
    user_ok = _extract_context_usage_tokens(_normalize_local_command_output(result.raw_user_text)) is not None
    final_ok = _extract_context_usage_tokens(result.raw_result_text) is not None

    if worker_ok:
        return "Current Team extraction already works on this environment."
    if user_ok:
        return (
            "Capture /context from UserMessage.content (local-command stdout) and strip "
            "<local-command-stdout> tags before parsing tokens."
        )
    if final_ok and not assistant_ok:
        return (
            "Use ResultMessage.result as fallback for /context capture. "
            "In Team path, when LLMResult.text is empty, parse ResultMessage.result."
        )
    if assistant_ok:
        return (
            "Parse streamed AssistantMessage text for /context. "
            "Ensure phase-review /context call consumes text deltas or assistant text blocks."
        )
    return (
        "Neither AssistantMessage text nor ResultMessage.result matched /context format. "
        "Inspect raw message payloads and slash-command availability in this runtime."
    )


async def _main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe Team Leader /context capture path and identify reliable extraction source."
    )
    parser.add_argument(
        "--team-dir",
        default="/Users/huawang/Documents/best/.opencowork/team",
        help="Directory that contains team-*.json session files.",
    )
    parser.add_argument(
        "--session-file",
        default="",
        help="Optional explicit session json path. If omitted, auto-picks latest in --team-dir.",
    )
    parser.add_argument(
        "--seed-prompt",
        default="Reply with exactly: ACK",
        help="Prompt sent before /context to mimic an active Leader session.",
    )
    parser.add_argument(
        "--preview-chars",
        type=int,
        default=160,
        help="Preview length for printed text samples.",
    )
    parser.add_argument(
        "--force-include-partials",
        action="store_true",
        help="Override lead config: set include_partial_messages=True for probing.",
    )
    args = parser.parse_args()

    try:
        session_file = Path(args.session_file) if args.session_file else _load_latest_team_session(Path(args.team_dir))
        lead_cfg, workspace, session_id = _load_lead_config(session_file)
        if args.force_include_partials:
            lead_cfg.include_partial_messages = True
    except Exception as exc:
        print(f"[ERROR] Failed to load session config: {exc}", file=sys.stderr)
        return 2

    print(f"[Session] id={session_id}")
    print(f"[Session] file={session_file}")
    print(f"[Lead] id={lead_cfg.id} model={lead_cfg.model} provider={lead_cfg.provider}")
    print(f"[Lead] endpoint={lead_cfg.endpoint}")
    print(f"[Lead] include_partial_messages={lead_cfg.include_partial_messages}")
    print(f"[Lead] workspace={workspace}")
    print("")

    try:
        result = await _probe_context_capture(lead_cfg, workspace, args.seed_prompt)
    except Exception as exc:
        print(f"[ERROR] Probe failed: {exc}", file=sys.stderr)
        return 3

    worker_tokens = _extract_context_usage_tokens(result.worker_text)
    raw_assistant_tokens = _extract_context_usage_tokens(result.raw_assistant_text)
    raw_user_normalized = _normalize_local_command_output(result.raw_user_text)
    raw_user_tokens = _extract_context_usage_tokens(raw_user_normalized)
    raw_result_tokens = _extract_context_usage_tokens(result.raw_result_text)

    print("=== Path A: Team-equivalent Worker.run_async ===")
    print(f"worker_error: {result.worker_error}")
    print(f"worker_text_len: {len(result.worker_text)}")
    print(f"worker_tokens_parsed: {worker_tokens}")
    print(f"worker_text_preview: {_preview(result.worker_text, args.preview_chars)}")
    print("")

    print("=== Path B/C: Raw SDK message inspection ===")
    print(f"available_commands_count: {len(result.available_commands)}")
    print(f"has_context_command: {'context' in result.available_commands}")
    print(f"has_compact_command: {'compact' in result.available_commands}")
    print(f"raw_message_types: {result.raw_message_types}")
    print(f"assistant_text_len: {len(result.raw_assistant_text)}")
    print(f"assistant_tokens_parsed: {raw_assistant_tokens}")
    print(f"assistant_preview: {_preview(result.raw_assistant_text, args.preview_chars)}")
    print(f"user_text_len: {len(result.raw_user_text)}")
    print(f"user_tokens_parsed: {raw_user_tokens}")
    print(f"user_preview: {_preview(raw_user_normalized, args.preview_chars)}")
    print(f"result_text_len: {len(result.raw_result_text)}")
    print(f"result_tokens_parsed: {raw_result_tokens}")
    print(f"result_preview: {_preview(result.raw_result_text, args.preview_chars)}")
    print(f"result_usage: {result.raw_usage}")
    print("")

    print("=== Recommendation ===")
    print(_recommendation(result))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
