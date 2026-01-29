"""
Image Sanitizer

Final validation and base64 encoding
"""

import base64
from typing import Optional

from .types import ProcessedImage, ImageContent, ImageFormat
from .config import get_config, PipelineConfig


# API-compatible formats
COMPATIBLE_FORMATS = {
    ImageFormat.JPEG,
    ImageFormat.PNG,
    ImageFormat.GIF,
    ImageFormat.WEBP,
}


class ImageSanitizer:
    """Image sanitizer"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    def validate(self, image: ProcessedImage) -> list[str]:
        """
        Validate image meets API requirements

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        meta = image.metadata

        # Check format
        if meta.format not in COMPATIBLE_FORMATS:
            errors.append(f"Incompatible format: {meta.format.value}")

        # Check dimensions
        if meta.width > 8000 or meta.height > 8000:
            errors.append(f"Dimensions too large: {meta.width}x{meta.height} (max 8000x8000)")

        # Check size
        if meta.file_size > self.config.max_bytes:
            errors.append(f"File too large: {meta.file_size} bytes (max {self.config.max_bytes})")

        return errors

    def sanitize(self, image: ProcessedImage) -> ImageContent:
        """
        Sanitize and convert to API content block

        Args:
            image: Processed image

        Returns:
            API-ready image content block
        """
        # Validate
        errors = self.validate(image)
        if errors:
            raise ValueError(f"Image validation failed: {'; '.join(errors)}")

        # Encode to base64
        data_b64 = base64.b64encode(image.data).decode("utf-8")

        return ImageContent(
            type="image",
            data=data_b64,
            mime_type=image.mime_type
        )

    def to_sdk_format(self, content: ImageContent) -> dict:
        """
        Convert to Claude SDK format

        Returns:
            Dict ready for API request
        """
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": content.mime_type,
                "data": content.data
            }
        }
