"""
Pydantic models for application settings and configuration.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ModelEndpoint(BaseModel):
    """A single endpoint configuration."""
    name: str  # Display name for the endpoint (e.g., "OpenRouter", "Local LM Studio")
    provider: Literal["claude", "openai", "openrouter", "bedrock", "vertex", "local", "cliproxyapi"] = "claude"
    api_key: Optional[str] = None
    endpoint: Optional[str] = None  # API URL


class ModelAPIConfig(BaseModel):
    """Configuration for Model API."""
    # Multi-endpoint support
    endpoints: list[ModelEndpoint] = Field(default_factory=list)
    selected_endpoint: str = ""  # Name of selected endpoint
    
    # Legacy single-endpoint fields (for backward compatibility)
    provider: Literal["claude", "openai", "openrouter", "bedrock", "vertex", "local", "cliproxyapi"] = "claude"
    api_key: Optional[str] = None
    endpoint: Optional[str] = None
    
    # Model selection
    model_name: str = "claude-sonnet-4-20250514"
    max_tokens: int = 0  # 0 = use SDK default
    max_thinking_tokens: int = 0  # 0 = disabled
    context_window: int = 200000  # Default context window size for UI usage
    small_fast_model: str = ""  # Optional override for small/fast pre-flight model
    shell_path: str = ""  # Optional shell override for Bash tool execution
    disable_non_essential_model_calls: bool = False  # Reduce background model calls
    
    def get_active_endpoint(self) -> "ModelEndpoint | None":
        """Get the currently active endpoint configuration."""
        if self.selected_endpoint and self.endpoints:
            for ep in self.endpoints:
                if ep.name == self.selected_endpoint:
                    return ep
        # Fallback to legacy fields if no endpoint selected
        return None


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server."""
    id: Optional[str] = None
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


class ImageGenConfig(BaseModel):
    """Configuration for image generation model."""
    selected_endpoint: str = ""   # endpoint name (from model.endpoints)
    model_name: str = ""          # model name


class AppSettings(BaseModel):
    """Application-wide settings."""
    model: ModelAPIConfig = Field(default_factory=ModelAPIConfig)
    mcp_servers: list[MCPServerConfig] = Field(default_factory=list)
    search: SearchConfig = Field(default_factory=SearchConfig)
    image_gen: ImageGenConfig = Field(default_factory=ImageGenConfig)
    
    # Agent behavior
    allowed_tools: list[str] = Field(default_factory=lambda: ["Read", "Write", "Edit", "Bash", "Glob"])
    max_turns: int = 50
    default_workdir: Optional[str] = None  # Default working directory for agent SDK
    auto_compact_threshold_percent: int = 85  # 0 = disabled

    # Prompt templates (global)
    prompt_global_template: str = ""
    prompt_apply_to_chat: bool = True
    prompt_apply_to_super_agent: bool = False
    prompt_base_preset: str = "claude_code"
    
    class Config:
        json_file = "config.json"
