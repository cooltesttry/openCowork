#!/usr/bin/env python3
"""Test with tool usage to see all event types."""

import asyncio
import sys

sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

async def test_with_tools():
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    from claude_agent_sdk.types import StreamEvent as SDKStreamEvent
    from claude_agent_sdk import UserMessage, AssistantMessage, ResultMessage, SystemMessage
    
    print("Creating SDK client...")
    
    options = ClaudeAgentOptions(
        permission_mode='bypassPermissions',
        cwd='/Users/huawang/pyproject/openCowork',  # Use project dir with files
        include_partial_messages=True,
    )
    
    client = ClaudeSDKClient(options=options)
    
    # Track all types
    all_types = {}
    
    async with client:
        prompt = "Read the first 5 lines of README.md"
        print(f"\nSending query: {prompt}")
        await client.query(prompt)
        
        print("\nListening for messages...\n")
        count = 0
        
        async for msg in client.receive_messages():
            count += 1
            msg_type = type(msg).__name__
            
            if msg_type not in all_types:
                all_types[msg_type] = []
            
            # Handle SDKStreamEvent
            if isinstance(msg, SDKStreamEvent):
                raw = msg.event
                et = raw.get("type", "?")
                if et not in [x.get("event_type") for x in all_types.get(msg_type, [])]:
                    all_types[msg_type].append({
                        "event_type": et,
                        "sample": str(raw)[:150]
                    })
                continue
            
            # Non-stream messages
            info = {"attrs": {}}
            for attr in dir(msg):
                if not attr.startswith('_'):
                    try:
                        val = getattr(msg, attr)
                        if not callable(val):
                            info["attrs"][attr] = str(val)[:100]
                    except:
                        pass
            
            all_types[msg_type].append(info)
            print(f"[{count}] {msg_type}")
            
            if isinstance(msg, ResultMessage):
                print("\n✅ Done\n")
                break
            
            if count > 200:
                print("\n⚠️ Limit\n")
                break
    
    print("=" * 60)
    print("ALL MESSAGE TYPES AND THEIR VARIANTS:")
    print("=" * 60)
    
    for msg_type, instances in all_types.items():
        print(f"\n### {msg_type} ({len(instances)} seen)")
        
        if msg_type == 'StreamEvent':
            event_types = set(x.get("event_type") for x in instances)
            print(f"  Event types: {sorted(event_types)}")
        else:
            for i, inst in enumerate(instances[:3]):  # Show first 3
                print(f"  [{i+1}] {inst}")

if __name__ == "__main__":
    asyncio.run(test_with_tools())
