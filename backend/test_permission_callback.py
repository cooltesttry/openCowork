#!/usr/bin/env python3
"""
Test MCP search tool permission callback behavior.
Loads the search MCP server and tests if can_use_tool is invoked.
"""

import asyncio
import json
import os
import sys
sys.path.insert(0, '/Users/huawang/pyproject/openCowork/backend')

from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
)
from claude_agent_sdk.types import PermissionResultAllow, ToolPermissionContext

# Track callback calls
callback_calls = []

async def my_permission_callback(
    tool_name: str,
    input_data: dict,
    context: ToolPermissionContext
) -> PermissionResultAllow:
    """Permission callback."""
    callback_calls.append(tool_name)
    print(f'\n>>> CALLBACK CALLED: {tool_name} <<<')
    print(f'    Input keys: {list(input_data.keys()) if input_data else []}')
    return PermissionResultAllow()


async def main():
    endpoint = "http://localhost:8317"
    
    # MCP search server config - same as app uses
    search_server_script = "/Users/huawang/pyproject/openCowork/backend/core/run_search_server.py"
    python_exe = sys.executable
    
    mcp_servers = {
        "search-tools": {
            "command": python_exe,
            "args": [search_server_script],
            "env": {
                **os.environ,
                "PYTHONUNBUFFERED": "1"
            }
        }
    }
    
    options = ClaudeAgentOptions(
        can_use_tool=my_permission_callback,
        permission_mode='default',  # Should trigger callback
        model='gemini-claude-opus-4-5-thinking',
        cwd='/Users/huawang/Documents/agenttest',
        max_turns=3,
        # No allowed_tools - should require approval for all tools
        disallowed_tools=['WebSearch', 'WebFetch'],
        mcp_servers=mcp_servers,
        env={
            "ANTHROPIC_BASE_URL": endpoint,
            "ANTHROPIC_API_KEY": "oo",
        }
    )
    
    print(f'Config:')
    print(f'  permission_mode={options.permission_mode}')
    print(f'  can_use_tool=SET')
    print(f'  allowed_tools={options.allowed_tools}')
    print(f'  mcp_servers: search-tools loaded')
    print(f'')
    
    async with ClaudeSDKClient(options) as client:
        query = 'Search for "Python programming language" using the search tool'
        print(f'Sending: {query}')
        await client.query(query)
        
        tools_used = []
        async for msg in client.receive_messages():
            if isinstance(msg, AssistantMessage):
                for b in msg.content:
                    if isinstance(b, TextBlock):
                        print(f'Text: {b.text[:100]}...')
                    elif isinstance(b, ToolUseBlock):
                        tools_used.append(b.name)
                        print(f'Tool used: {b.name}')
            elif isinstance(msg, ResultMessage):
                print(f'Done! Duration: {msg.duration_ms}ms')
                break
    
    print(f'\n=== RESULT ===')
    print(f'Tools used: {tools_used}')
    print(f'Callback calls: {callback_calls}')
    
    if callback_calls:
        print('SUCCESS: Callback was invoked!')
    else:
        print('FAILURE: Callback was NOT invoked!')
        if tools_used:
            print(f'  Tools were used but callback not called!')

asyncio.run(main())
