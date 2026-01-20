#!/usr/bin/env python3
"""Test to check if thinking events are received from SDK."""

import asyncio
import sys

sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

async def test_thinking():
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    from claude_agent_sdk.types import StreamEvent as SDKStreamEvent
    from claude_agent_sdk import AssistantMessage, ResultMessage, SystemMessage, ThinkingBlock, TextBlock
    
    print("Creating SDK client with streaming and thinking enabled...")
    
    options = ClaudeAgentOptions(
        permission_mode='bypassPermissions',
        cwd='/Users/huawang/pyproject/openCowork',
        include_partial_messages=True,
    )
    
    client = ClaudeSDKClient(options=options)
    
    thinking_events = []
    stream_events = []
    
    async with client:
        prompt = "Think step by step: what is 2+2?"
        print(f"\nSending query: {prompt}")
        await client.query(prompt)
        
        print("\nListening for messages...\n")
        
        async for msg in client.receive_messages():
            msg_type = type(msg).__name__
            
            if isinstance(msg, SDKStreamEvent):
                raw = msg.event
                et = raw.get("type", "?")
                
                # Check for thinking-related events
                if "thinking" in et.lower():
                    stream_events.append({"type": et, "sample": str(raw)[:100]})
                    print(f"  [STREAM] {et}")
                    
                if et == "content_block_start":
                    block = raw.get("content_block", {})
                    block_type = block.get("type")
                    if block_type == "thinking":
                        print(f"  [STREAM] content_block_start: THINKING BLOCK!")
                        stream_events.append({"type": "block_start:thinking"})
                        
                if et == "content_block_delta":
                    delta = raw.get("delta", {})
                    delta_type = delta.get("type")
                    if delta_type == "thinking_delta":
                        thinking_text = delta.get("thinking", "")[:50]
                        print(f"  [STREAM] thinking_delta: {thinking_text}...")
                        stream_events.append({"type": "thinking_delta", "content": thinking_text})
                        
                continue
            
            print(f"[MSG] {msg_type}")
            
            if isinstance(msg, AssistantMessage):
                for block in msg.content:
                    block_type = type(block).__name__
                    print(f"  - block: {block_type}")
                    if isinstance(block, ThinkingBlock):
                        thinking_events.append({"source": "AssistantMessage.ThinkingBlock", "len": len(block.thinking)})
                        print(f"    ThinkingBlock content: {block.thinking[:100]}...")
                    elif isinstance(block, TextBlock):
                        if hasattr(block, 'type') and block.type == 'thinking':
                            thinking_events.append({"source": "TextBlock.thinking", "len": len(block.text)})
            
            if isinstance(msg, ResultMessage):
                print("\n✅ Done\n")
                break

    print("=" * 60)
    print("THINKING EVENTS SUMMARY:")
    print("=" * 60)
    print(f"\nStream events with thinking: {len(stream_events)}")
    for e in stream_events[:5]:
        print(f"  - {e}")
    print(f"\nAssistantMessage thinking blocks: {len(thinking_events)}")
    for e in thinking_events:
        print(f"  - {e}")

if __name__ == "__main__":
    asyncio.run(test_thinking())
