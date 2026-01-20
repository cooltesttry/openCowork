#!/usr/bin/env python3
"""Test script to check if SDK init message contains slash_commands."""

import asyncio
import os
import sys

# Add backend to path
sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

async def test_sdk_init():
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    from claude_agent_sdk import SystemMessage
    
    print("Creating SDK client...")
    
    options = ClaudeAgentOptions(
        permission_mode='bypassPermissions',
        cwd='/Users/huawang/Documents/agenttest',
    )
    
    client = ClaudeSDKClient(options=options)
    
    async with client:
        print("Sending test query...")
        await client.query("hi")
        
        print("\nListening for messages...")
        message_count = 0
        
        async for msg in client.receive_messages():
            message_count += 1
            msg_type = type(msg).__name__
            
            print(f"\n[{message_count}] Message type: {msg_type}")
            
            if isinstance(msg, SystemMessage):
                print(f"  - subtype: {getattr(msg, 'subtype', 'N/A')}")
                if hasattr(msg, 'data') and isinstance(msg.data, dict):
                    print(f"  - data keys: {list(msg.data.keys())}")
                    if 'slash_commands' in msg.data:
                        print(f"  - slash_commands: {msg.data['slash_commands']}")
                    if 'session_id' in msg.data:
                        print(f"  - session_id: {msg.data['session_id'][:20]}...")
            
            # Check for ResultMessage to stop
            if msg_type == 'ResultMessage':
                print("\n✅ ResultMessage received, stopping.")
                break
            
            if message_count > 20:
                print("\n⚠️ Reached message limit, stopping.")
                break

if __name__ == "__main__":
    asyncio.run(test_sdk_init())
