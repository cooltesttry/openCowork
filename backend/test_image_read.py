#!/usr/bin/env python3
"""Debug: Check what SDK actually sends to CLI."""

import asyncio
import json
from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from claude_agent_sdk.types import TextBlock, ToolUseBlock, ToolResultBlock, UserMessage, AssistantMessage, ResultMessage


ENV_VARS = {
    "ANTHROPIC_BASE_URL": "http://localhost:8317",
    "ANTHROPIC_API_KEY": "aa",
}
MODEL = "gemini-claude-opus-4-5-thinking"
IMAGE_PATH = "/Users/huawang/Documents/mm.jpg"
PROMPT = f"请描述这张图片：{IMAGE_PATH}"


def stderr_handler(line: str):
    """Capture stderr from CLI for debugging."""
    print(f"[STDERR] {line}")


async def test_with_debug():
    print("=" * 60)
    print(f"Prompt: {PROMPT}")
    print("=" * 60)
    
    options = ClaudeAgentOptions(
        model=MODEL,
        include_partial_messages=True,
        permission_mode="bypassPermissions",
        max_turns=5,
        env=ENV_VARS,
        stderr=stderr_handler,  # Capture stderr
        extra_args={"debug-to-stderr": None},  # Enable debug output
    )
    
    async with ClaudeSDKClient(options=options) as client:
        await client.query(PROMPT)
        
        full_text = ""
        tool_result_raw = None
        
        async for msg in client.receive_messages():
            if isinstance(msg, ResultMessage):
                print(f"\n[RESULT] turns={msg.num_turns}")
                break
            
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    if isinstance(block, TextBlock):
                        full_text += block.text
                        if len(block.text) > 10:
                            print(f"[TEXT] {block.text[:200]}...")
                    elif isinstance(block, ToolUseBlock):
                        print(f"[TOOL_USE] {block.name}: {block.input}")
            
            elif isinstance(msg, UserMessage):
                if isinstance(msg.content, list):
                    for block in msg.content:
                        if isinstance(block, ToolResultBlock):
                            tool_result_raw = block
                            content = block.content
                            print(f"\n[DEBUG] ToolResultBlock.content type: {type(content)}")
                            if isinstance(content, list) and len(content) > 0:
                                first_item = content[0]
                                print(f"[DEBUG] First item type: {type(first_item)}")
                                if isinstance(first_item, dict):
                                    print(f"[DEBUG] Item keys: {first_item.keys()}")
                                    if first_item.get('type') == 'image':
                                        source = first_item.get('source', {})
                                        print(f"[DEBUG] source.type: {source.get('type')}")
                                        print(f"[DEBUG] source.media_type: {source.get('media_type')}")
                                        data = source.get('data', '')
                                        print(f"[DEBUG] source.data length: {len(data)}")
                                        print(f"[DEBUG] source.data first 100 chars: {data[:100] if data else 'EMPTY'}")
        
        print()
        print("=" * 60)
        print(f"FINAL: {full_text[:300]}...")


if __name__ == "__main__":
    asyncio.run(test_with_debug())
