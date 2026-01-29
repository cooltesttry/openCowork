"""
Image Processing Pipeline

A modular pipeline for detecting, loading, converting, optimizing,
and encoding images for LLM multimodal input.

Usage:
    from core.image_pipeline import ImagePipeline, PipelineConfig

    pipeline = ImagePipeline()
    result = await pipeline.process("Describe this image ~/photo.jpg")
    
    if result.images:
        # Get SDK-ready content blocks
        blocks = pipeline.get_sdk_content_blocks(result.images)
"""

from .types import (
    ImageFormat,
    RefType,
    DetectedImageRef,
    ImageMetadata,
    ProcessedImage,
    ImageContent,
    PipelineResult,
)
from .config import PipelineConfig, get_config, set_config
from .pipeline import ImagePipeline
from .detector import ImageReferenceDetector
from .loader import ImageLoader, ImageLoadError
from .converter import ImageConverter
from .optimizer import ImageOptimizer
from .sanitizer import ImageSanitizer


__all__ = [
    # Main classes
    "ImagePipeline",
    "PipelineConfig",
    # Types
    "ImageFormat",
    "RefType",
    "DetectedImageRef",
    "ImageMetadata",
    "ProcessedImage",
    "ImageContent",
    "PipelineResult",
    # Sub-modules
    "ImageReferenceDetector",
    "ImageLoader",
    "ImageLoadError",
    "ImageConverter",
    "ImageOptimizer",
    "ImageSanitizer",
    # Config helpers
    "get_config",
    "set_config",
]
