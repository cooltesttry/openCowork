#!/usr/bin/env python3
"""
Resume an existing Claude SDK session ID once and send a prompt.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
)


DEFAULT_MODEL = "gemini-claude-sonnet-4-5-thinking"
DEFAULT_BASE_URL = "http://localhost:8317"
DEFAULT_API_KEY = "aa"
DEFAULT_PROMPT = "请用一句话确认你已经恢复了这个会话。"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resume one existing SDK session and send a single prompt."
    )
    parser.add_argument(
        "--session-id",
        required=True,
        help="SDK session ID to resume.",
    )
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Prompt to send after resume.",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="Model name.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("ANTHROPIC_BASE_URL", DEFAULT_BASE_URL),
        help="Anthropic-compatible base URL.",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("ANTHROPIC_API_KEY", DEFAULT_API_KEY),
        help="API key for endpoint.",
    )
    parser.add_argument(
        "--cwd",
        default=os.getcwd(),
        help="Working directory passed to SDK client options.",
    )
    parser.add_argument(
        "--include-partial",
        dest="include_partial",
        action="store_true",
        default=True,
        help="Enable include_partial_messages (default: enabled).",
    )
    parser.add_argument(
        "--no-include-partial",
        dest="include_partial",
        action="store_false",
        help="Disable include_partial_messages.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero when resume fails or returns empty assistant text.",
    )
    return parser.parse_args()


def build_options(args: argparse.Namespace) -> ClaudeAgentOptions:
    options = ClaudeAgentOptions(
        model=args.model,
        max_turns=20,
        include_partial_messages=args.include_partial,
        permission_mode="bypassPermissions",
    )
    options.env = {
        "ANTHROPIC_BASE_URL": args.base_url,
        "ANTHROPIC_API_KEY": args.api_key,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": args.model,
        "ANTHROPIC_SMALL_FAST_MODEL": args.model,
    }
    options.resume = args.session_id
    options.system_prompt = None
    if args.cwd:
        options.cwd = args.cwd
    return options


async def run_once(args: argparse.Namespace) -> dict[str, Any]:
    started_at = time.time()
    assistant_text: list[str] = []
    resume_init_session_id = None
    message_types: list[str] = []
    result_error = None

    options = build_options(args)
    async with ClaudeSDKClient(options=options) as client:
        await client.query(args.prompt)

        async for msg in client.receive_messages():
            message_types.append(type(msg).__name__)

            if isinstance(msg, SystemMessage):
                if (
                    getattr(msg, "subtype", None) == "init"
                    and isinstance(getattr(msg, "data", None), dict)
                ):
                    sid = msg.data.get("session_id")
                    if sid:
                        resume_init_session_id = sid

            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        assistant_text.append(block.text)

            elif isinstance(msg, ResultMessage):
                if getattr(msg, "is_error", False):
                    result_error = {
                        "subtype": getattr(msg, "subtype", None),
                        "result": getattr(msg, "result", None),
                    }
                break

    text = "".join(assistant_text).strip()
    resume_success = bool(text) and not bool(result_error)

    return {
        "input_session_id": args.session_id,
        "resume_init_session_id": resume_init_session_id,
        "model": args.model,
        "base_url": args.base_url,
        "cwd": args.cwd,
        "include_partial_messages": args.include_partial,
        "prompt": args.prompt,
        "assistant_text": text,
        "result_error": result_error,
        "message_types": message_types,
        "resume_success": resume_success,
        "elapsed_seconds": round(time.time() - started_at, 2),
    }


def main() -> int:
    args = parse_args()
    result = asyncio.run(run_once(args))
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.strict and not result["resume_success"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
