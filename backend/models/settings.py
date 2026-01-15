"""
Pydantic models for application settings and configuration.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ModelAPIConfig(BaseModel):
    """Configuration for Model API."""
    provider: Literal["claude", "openai", "openrouter", "bedrock", "vertex", "local"] = "claude"
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    model_name: str = "claude-sonnet-4-20250514"
    max_tokens: int = 0  # 0 = use SDK default
    max_thinking_tokens: int = 0  # 0 = disabled


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server."""
    name: str
    type: Literal["stdio", "sse", "http", "sdk"] = "stdio"  # sse=legacy SSE, http=Streamable HTTP
    command: Optional[str] = None
    args: list[str] = Field(default_factory=list)
    url: Optional[str] = None
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True


class SearchConfig(BaseModel):
    """Configuration for search providers."""
    provider: Literal["serper", "tavily", "brave", "none"] = "none"
    api_key: Optional[str] = None
    max_results: int = 10
    enabled: bool = True  # Controls whether search MCP is active


class AppSettings(BaseModel):
    """Application-wide settings."""
    model: ModelAPIConfig = Field(default_factory=ModelAPIConfig)
    mcp_servers: list[MCPServerConfig] = Field(default_factory=list)
    search: SearchConfig = Field(default_factory=SearchConfig)
    
    # Agent behavior
    allowed_tools: list[str] = Field(default_factory=lambda: ["Read", "Write", "Edit", "Bash", "Glob"])
    max_turns: int = 50
    default_workdir: Optional[str] = None  # Default working directory for agent SDK
    
    class Config:
        json_file = "config.json"
