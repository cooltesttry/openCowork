import asyncio
import os
from mcp import ClientSession
from mcp.client.sse import sse_client

async def main():
    url = "http://localhost:8081/mcp"
    print(f"Connecting to {url}...")
    try:
        async with sse_client(url) as (read, write):
            print("SSE Connected. Initializing session...")
            async with ClientSession(read, write) as session:
                await session.initialize()
                print("Session initialized. Listing tools...")
                result = await session.list_tools()
                print("Tools found:")
                for tool in result.tools:
                    print(f"- {tool.name}: {tool.description}")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
