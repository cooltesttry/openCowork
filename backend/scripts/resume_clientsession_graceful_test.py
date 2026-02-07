#!/usr/bin/env python3
"""
ClaudeSDKClient resume test with graceful session shutdown.

Flow:
1) Create ClientSession-1, send prompt, read until ResultMessage.
2) Gracefully close session-1 (end_input -> optional grace sleep -> disconnect).
3) Create ClientSession-2 with options.resume=<session_id from step 1>.
4) Send follow-up prompt and verify resume works.
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
DEFAULT_FIRST_PROMPT = "只回复 ROUND1_OK"
DEFAULT_SECOND_PROMPT = "你上一轮收到的用户消息是什么？只回复那句原文。"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Test ClientSession close + new ClientSession resume behavior."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model name.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("ANTHROPIC_BASE_URL", DEFAULT_BASE_URL),
        help="Anthropic-compatible base URL.",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("ANTHROPIC_API_KEY", DEFAULT_API_KEY),
        help="API key for the endpoint.",
    )
    parser.add_argument("--first-prompt", default=DEFAULT_FIRST_PROMPT)
    parser.add_argument("--second-prompt", default=DEFAULT_SECOND_PROMPT)
    parser.add_argument(
        "--wait-seconds",
        type=float,
        default=0.0,
        help="Wait time between closing session-1 and starting session-2.",
    )
    parser.add_argument(
        "--grace-seconds",
        type=float,
        default=1.0,
        help="Sleep after end_input before disconnect.",
    )
    parser.add_argument(
        "--no-graceful-close",
        action="store_true",
        help="Disable graceful close (for comparison).",
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
        help="Exit non-zero when resume fails.",
    )
    return parser.parse_args()


def make_options(
    *,
    model: str,
    base_url: str,
    api_key: str,
    include_partial: bool,
    resume_session_id: str | None = None,
) -> ClaudeAgentOptions:
    options = ClaudeAgentOptions(
        model=model,
        max_turns=20,
        include_partial_messages=include_partial,
        permission_mode="bypassPermissions",
    )
    options.env = {
        "ANTHROPIC_BASE_URL": base_url,
        "ANTHROPIC_API_KEY": api_key,
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
        "ANTHROPIC_SMALL_FAST_MODEL": model,
    }
    if resume_session_id:
        options.resume = resume_session_id
        options.system_prompt = None
    return options


async def close_client(
    client: ClaudeSDKClient,
    *,
    graceful_close: bool,
    grace_seconds: float,
) -> None:
    # NOTE: end_input() is currently only available via transport internals.
    # This avoids immediate process terminate before CLI natural flush/exit.
    if graceful_close:
        transport = getattr(client, "_transport", None)
        if transport is not None:
            try:
                await transport.end_input()
            except Exception:
                pass
        if grace_seconds > 0:
            await asyncio.sleep(grace_seconds)

    await client.disconnect()


async def run_turn(
    *,
    prompt: str,
    model: str,
    base_url: str,
    api_key: str,
    include_partial: bool,
    resume_session_id: str | None,
    graceful_close: bool,
    grace_seconds: float,
) -> dict[str, Any]:
    sdk_session_id = None
    text_parts: list[str] = []
    result_error = None
    message_types: list[str] = []

    options = make_options(
        model=model,
        base_url=base_url,
        api_key=api_key,
        include_partial=include_partial,
        resume_session_id=resume_session_id,
    )

    client = ClaudeSDKClient(options=options)
    await client.connect()
    try:
        await client.query(prompt)

        async for msg in client.receive_response():
            message_types.append(type(msg).__name__)

            if isinstance(msg, SystemMessage):
                if (
                    getattr(msg, "subtype", None) == "init"
                    and isinstance(getattr(msg, "data", None), dict)
                ):
                    sid = msg.data.get("session_id")
                    if sid:
                        sdk_session_id = sid

            elif isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        text_parts.append(block.text)

            elif isinstance(msg, ResultMessage):
                if getattr(msg, "is_error", False):
                    result_error = {
                        "subtype": getattr(msg, "subtype", None),
                        "result": getattr(msg, "result", None),
                    }
    finally:
        await close_client(
            client,
            graceful_close=graceful_close,
            grace_seconds=grace_seconds,
        )

    return {
        "sdk_session_id": sdk_session_id,
        "text": "".join(text_parts).strip(),
        "result_error": result_error,
        "message_types": message_types,
    }


async def async_main(args: argparse.Namespace) -> int:
    started_at = time.time()
    graceful_close = not args.no_graceful_close

    round1 = await run_turn(
        prompt=args.first_prompt,
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
        include_partial=args.include_partial,
        resume_session_id=None,
        graceful_close=graceful_close,
        grace_seconds=args.grace_seconds,
    )

    first_session_id = round1.get("sdk_session_id")
    if args.wait_seconds > 0:
        await asyncio.sleep(args.wait_seconds)

    round2 = await run_turn(
        prompt=args.second_prompt,
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
        include_partial=args.include_partial,
        resume_session_id=first_session_id,
        graceful_close=graceful_close,
        grace_seconds=args.grace_seconds,
    )

    resume_success = bool(round2.get("text")) and not bool(round2.get("result_error"))

    output = {
        "model": args.model,
        "base_url": args.base_url,
        "include_partial_messages": args.include_partial,
        "graceful_close": graceful_close,
        "grace_seconds": args.grace_seconds,
        "wait_seconds": args.wait_seconds,
        "round1": round1,
        "round2": round2,
        "resume_success": resume_success,
        "elapsed_seconds": round(time.time() - started_at, 2),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

    if args.strict and not resume_success:
        return 1
    return 0


def main() -> int:
    args = parse_args()
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    sys.exit(main())
