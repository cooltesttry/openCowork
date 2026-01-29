"""
Image Pipeline Configuration
"""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class PipelineConfig:
    """Pipeline configuration - supports environment variable overrides"""

    # Dimension limits
    max_dimension_px: int = 1024          # Max pixels per side (default smaller)
    max_bytes: int = 3 * 1024 * 1024      # 3MB

    # Optimization grids (try from large to small)
    resize_grid: list[int] = field(
        default_factory=lambda: [1024, 800, 600, 400]
    )
    quality_grid: list[int] = field(
        default_factory=lambda: [80, 65, 50, 35]
    )
    png_compression_levels: list[int] = field(
        default_factory=lambda: [6, 7, 8, 9]
    )

    # Security settings
    sandbox_root: Optional[str] = None    # Sandbox root directory
    allow_remote_urls: bool = False       # Allow remote URLs

    # Format conversion
    convert_heic_to_jpeg: bool = True
    preserve_alpha_as_png: bool = True

    @classmethod
    def from_env(cls) -> "PipelineConfig":
        """Create config from environment variables"""
        config = cls()
        
        if val := os.getenv("IMAGE_MAX_DIMENSION"):
            config.max_dimension_px = int(val)
        
        if val := os.getenv("IMAGE_MAX_BYTES"):
            config.max_bytes = int(val)
        
        if val := os.getenv("IMAGE_RESIZE_GRID"):
            config.resize_grid = [int(x) for x in val.split(",")]
        
        if val := os.getenv("IMAGE_QUALITY_GRID"):
            config.quality_grid = [int(x) for x in val.split(",")]
        
        if val := os.getenv("IMAGE_SANDBOX_ROOT"):
            config.sandbox_root = val
        
        if val := os.getenv("IMAGE_ALLOW_REMOTE"):
            config.allow_remote_urls = val.lower() == "true"
        
        return config


# Global default config
_config: Optional[PipelineConfig] = None


def get_config() -> PipelineConfig:
    """Get current configuration"""
    global _config
    if _config is None:
        _config = PipelineConfig.from_env()
    return _config


def set_config(config: PipelineConfig) -> None:
    """Set configuration"""
    global _config
    _config = config
