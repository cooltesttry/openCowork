from claude_agent_sdk import tool, create_sdk_mcp_server
import inspect

print("--- Inspecting 'tool' ---")
print(f"Signature: {inspect.signature(tool)}")
print(f"Docstring: {tool.__doc__}")

print("\n--- Inspecting 'create_sdk_mcp_server' ---")
print(f"Signature: {inspect.signature(create_sdk_mcp_server)}")
print(f"Docstring: {create_sdk_mcp_server.__doc__}")
