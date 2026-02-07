#!/usr/bin/env python3
"""
Standalone Claude Agent SDK resume test.

Flow:
1. Create client and run first prompt
2. Close client
3. Wait N seconds
4. Create new client with options.resume
5. Run second prompt and report result
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
        description="Test close-and-resume flow with Claude Agent SDK."
    )
    parser.add_argument(
        "--wait-seconds",
        type=float,
        default=2.0,
        help="Seconds to sleep between close and resume.",
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
        "--strict",
        action="store_true",
        help="Exit non-zero when resume step fails.",
    )
    return parser.parse_args()


def make_options(
    model: str,
    base_url: str,
    api_key: str,
    resume_session_id: str | None = None,
) -> ClaudeAgentOptions:
    options = ClaudeAgentOptions(
        model=model,
        max_turns=20,
        include_partial_messages=False,
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


async def run_turn(
    prompt: str,
    model: str,
    base_url: str,
    api_key: str,
    resume_session_id: str | None = None,
) -> dict[str, Any]:
    sdk_session_id = None
    text_parts: list[str] = []
    result_error = None
    message_types: list[str] = []

    options = make_options(
        model=model,
        base_url=base_url,
        api_key=api_key,
        resume_session_id=resume_session_id,
    )

    async with ClaudeSDKClient(options=options) as client:
        await client.query(prompt)

        async for msg in client.receive_messages():
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
                break

    return {
        "sdk_session_id": sdk_session_id,
        "text": "".join(text_parts).strip(),
        "result_error": result_error,
        "message_types": message_types,
    }


async def async_main(args: argparse.Namespace) -> int:
    started_at = time.time()

    round1 = await run_turn(
        prompt=args.first_prompt,
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
        resume_session_id=None,
    )

    first_session_id = round1.get("sdk_session_id")
    await asyncio.sleep(args.wait_seconds)

    round2 = await run_turn(
        prompt=args.second_prompt,
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
        resume_session_id=first_session_id,
    )

    resume_success = bool(round2.get("text")) and not bool(round2.get("result_error"))

    output = {
        "model": args.model,
        "base_url": args.base_url,
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
