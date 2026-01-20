#!/usr/bin/env python3
"""Test script to check slash command response details."""

import asyncio
import sys
import json

sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

async def test_slash_command():
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    
    print("Creating SDK client...")
    
    options = ClaudeAgentOptions(
        permission_mode='bypassPermissions',
        cwd='/Users/huawang/Documents/agenttest',
    )
    
    client = ClaudeSDKClient(options=options)
    
    async with client:
        # Test sending a slash command
        slash_cmd = "/compact"
        print(f"\nSending slash command: {slash_cmd}")
        await client.query(slash_cmd)
        
        print("\nListening for ALL messages with full details...")
        message_count = 0
        
        async for msg in client.receive_messages():
            message_count += 1
            msg_type = type(msg).__name__
            
            print(f"\n{'='*50}")
            print(f"[{message_count}] Message type: {msg_type}")
            print(f"{'='*50}")
            
            # Print all attributes
            for attr in dir(msg):
                if not attr.startswith('_'):
                    try:
                        val = getattr(msg, attr)
                        if not callable(val):
                            val_str = str(val)
                            if len(val_str) > 300:
                                val_str = val_str[:300] + "..."
                            print(f"  {attr}: {val_str}")
                    except:
                        pass
            
            if msg_type == 'ResultMessage':
                print("\n✅ ResultMessage received, stopping.")
                break
            
            if message_count > 20:
                print("\n⚠️ Reached message limit, stopping.")
                break

if __name__ == "__main__":
    asyncio.run(test_slash_command())
