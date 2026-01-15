"""
MCP Tool Inspector module.
Inspects tools available on a configured MCP server.
"""
import os
import shutil
import json
import asyncio
import httpx
from typing import Any, Optional
from models.settings import MCPServerConfig
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.sse import sse_client

async def inspect_mcp_tools(config: MCPServerConfig) -> list[dict[str, Any]]:
    """
    Connect to an MCP server and list its available tools.
    Returns a list of tool definitions.
    """
    if config.type == "stdio":
        # Prepare environment variables
        env = os.environ.copy()
        if config.env:
            env.update(config.env)

        # Basic command handling
        cmd = config.command
        # If command is not absolute and not found, try to find it in path
        if not os.path.isabs(cmd) and not shutil.which(cmd):
             pass

        server_params = StdioServerParameters(
            command=cmd,
            args=config.args,
            env=env
        )

        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.list_tools()
                return [
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.inputSchema
                    }
                    for tool in result.tools
                ]

    elif config.type == "sse":
        # Legacy SSE transport (GET /sse + POST /message)
        if not config.url:
            raise ValueError("URL is required for SSE servers")

        async with sse_client(config.url) as (read, write):
             async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.list_tools()
                return [
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.inputSchema
                    }
                    for tool in result.tools
                ]
    
    elif config.type == "http":
        # Streamable HTTP transport (unified POST /mcp endpoint)
        if not config.url:
            raise ValueError("URL is required for HTTP servers")
            
        return await _inspect_streamable_http_tools(config.url)
    
    return []

async def _inspect_streamable_http_tools(url: str) -> list[dict[str, Any]]:
    """
    Streamable HTTP implementation for MCP tool inspection.
    Uses the unified POST /mcp endpoint with mcp-session-id header.
    Each command requires a separate stream request.
    """
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }
    
    init_payload = {
        "jsonrpc": "2.0", 
        "id": 1, 
        "method": "initialize", 
        "params": {
            "protocolVersion": "2024-11-05", 
            "capabilities": {}, 
            "clientInfo": {"name": "mcp-inspector", "version": "1.0"}
        }
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Initialize and get session ID
        async with client.stream("POST", url, headers=headers, json=init_payload) as response:
            if response.status_code != 200:
                raise Exception(f"Failed to connect: {response.status_code}")
                
            session_id = response.headers.get("mcp-session-id")
            if not session_id:
                raise Exception("No session ID received from server")

            # Read initialize response
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    if data.get("id") == 1:
                        break
        
        # Step 2: Send initialized notification (using session ID)
        cmd_headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "mcp-session-id": session_id
        }
        await client.post(url, headers=cmd_headers, json={
            "jsonrpc": "2.0", 
            "method": "notifications/initialized"
        })
        
        # Step 3: Send tools/list as a NEW stream request
        list_cmd = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
        async with client.stream("POST", url, headers=cmd_headers, json=list_cmd) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if data.get("id") == 2:
                            if "error" in data:
                                raise Exception(data["error"].get("message", "Unknown error"))
                            
                            tools = data.get("result", {}).get("tools", [])
                            return [
                                {
                                    "name": t.get("name"),
                                    "description": t.get("description"),
                                    "inputSchema": t.get("inputSchema")
                                }
                                for t in tools
                            ]
                    except json.JSONDecodeError:
                        continue
                        
    return []

