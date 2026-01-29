"""
Image Processing Pipeline

Main entry point that orchestrates all modules
"""

import logging
from typing import Optional

from .types import (
    ProcessedImage, ImageContent, PipelineResult, 
    DetectedImageRef, ImageFormat
)
from .config import get_config, PipelineConfig
from .detector import ImageReferenceDetector
from .loader import ImageLoader, ImageLoadError
from .converter import ImageConverter
from .optimizer import ImageOptimizer
from .sanitizer import ImageSanitizer


logger = logging.getLogger(__name__)


class ImagePipeline:
    """
    Image processing pipeline

    Orchestrates:
    1. Detection - Find image references in prompt
    2. Loading - Load image data
    3. Conversion - Convert to compatible format
    4. Optimization - Resize/compress to meet limits
    5. Sanitization - Validate and encode to base64
    """

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()
        self.detector = ImageReferenceDetector(
            allow_remote=self.config.allow_remote_urls
        )
        self.loader = ImageLoader(self.config)
        self.converter = ImageConverter(self.config)
        self.optimizer = ImageOptimizer(self.config)
        self.sanitizer = ImageSanitizer(self.config)

    async def process(self, prompt: str) -> PipelineResult:
        """
        Process prompt and extract images

        Args:
            prompt: User prompt text

        Returns:
            PipelineResult with processed images and cleaned prompt
        """
        result = PipelineResult()
        
        # 1. Detect image references
        refs = self.detector.detect(prompt)
        result.detected_refs = refs

        if not refs:
            result.cleaned_prompt = prompt
            return result

        logger.info(f"[ImagePipeline] Detected {len(refs)} image reference(s)")

        # 2. Process each reference
        for ref in refs:
            try:
                image_content = await self._process_single(ref)
                result.images.append(image_content)
                result.loaded_count += 1
                logger.debug(f"[ImagePipeline] Processed: {ref.resolved}")
            except Exception as e:
                error_msg = f"Failed to process {ref.resolved}: {e}"
                logger.warning(f"[ImagePipeline] {error_msg}")
                result.errors.append(error_msg)
                result.skipped_count += 1

        # 3. Remove refs from prompt
        result.cleaned_prompt = self.detector.remove_refs_from_text(prompt, refs)

        logger.info(
            f"[ImagePipeline] Processed {result.loaded_count} images, "
            f"skipped {result.skipped_count}"
        )

        return result

    async def _process_single(self, ref: DetectedImageRef) -> ImageContent:
        """Process single image reference"""
        # Load
        image = await self.loader.load(ref)

        # Convert if needed
        if image.metadata.format not in {
            ImageFormat.JPEG, ImageFormat.PNG, 
            ImageFormat.GIF, ImageFormat.WEBP
        }:
            image = self.converter.ensure_compatible_format(image)

        # Optimize if needed
        if self.optimizer.needs_optimization(image):
            image = self.optimizer.optimize(image)

        # Sanitize and encode
        return self.sanitizer.sanitize(image)

    def get_sdk_content_blocks(self, images: list[ImageContent]) -> list[dict]:
        """
        Convert images to SDK-ready content blocks

        Args:
            images: List of processed image contents

        Returns:
            List of dicts ready for SDK API
        """
        return [self.sanitizer.to_sdk_format(img) for img in images]
