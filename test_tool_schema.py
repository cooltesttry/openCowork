#!/usr/bin/env python3
"""Get EnterPlanMode tool definition via SDK interaction."""

import asyncio
import sys
sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

async def main():
    from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
    from claude_agent_sdk.types import SystemMessage
    
    print("Starting SDK client to get tool definitions...")
    
    options = ClaudeAgentOptions(
        permission_mode='bypassPermissions',
        cwd='/Users/huawang/pyproject/openCowork',
        include_partial_messages=True,
    )
    
    client = ClaudeSDKClient(options=options)
    
    async with client:
        # Ask Claude about its tools
        prompt = "Please list all your available tools, including EnterPlanMode and ExitPlanMode if they exist. What are their parameters and descriptions?"
        print(f"Prompt: {prompt}\n")
        
        await client.query(prompt)
        
        async for msg in client.receive_messages():
            msg_type = type(msg).__name__
            
            if isinstance(msg, SystemMessage):
                if hasattr(msg, 'subtype') and msg.subtype == 'init':
                    print(f"[SystemMessage.init] session_id={msg.data.get('session_id')}")
                    if 'slash_commands' in msg.data:
                        print(f"  slash_commands: {len(msg.data['slash_commands'])} commands")
                continue
            
            if msg_type == 'AssistantMessage':
                for block in msg.content:
                    if hasattr(block, 'text'):
                        print(f"\n=== Claude's Response ===\n{block.text}")
                        
            if msg_type == 'ResultMessage':
                print(f"\n[Done] cost=${msg.total_cost_usd:.4f}")
                break

if __name__ == "__main__":
    asyncio.run(main())
