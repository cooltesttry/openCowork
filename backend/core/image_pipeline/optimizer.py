"""
Image Optimizer

Resizes and compresses images to meet API limits
"""

import io
from dataclasses import dataclass
from typing import Optional

from PIL import Image

from .types import ProcessedImage, ImageMetadata, ImageFormat
from .config import get_config, PipelineConfig
from .exif import apply_orientation_fix


@dataclass
class OptimizationResult:
    """Optimization result"""
    data: bytes
    format: str  # "jpeg" or "png"
    width: int
    height: int
    quality: Optional[int] = None
    compression: Optional[int] = None


class ImageOptimizer:
    """Image optimizer"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    def needs_optimization(self, image: ProcessedImage) -> bool:
        """Check if image needs optimization"""
        meta = image.metadata

        # Dimension exceeds limit
        if meta.width > self.config.max_dimension_px or meta.height > self.config.max_dimension_px:
            return True

        # Size exceeds limit
        if meta.file_size > self.config.max_bytes:
            return True

        return False

    def optimize(self, image: ProcessedImage) -> ProcessedImage:
        """
        Optimize image

        Strategy:
        1. If has alpha and needs to preserve, use PNG
        2. Otherwise use JPEG
        3. Try different size/quality combinations until within limits
        """
        preserve_alpha = (
            self.config.preserve_alpha_as_png and
            image.metadata.has_alpha
        )

        if preserve_alpha:
            result = self._optimize_as_png(image)

            # If PNG still too large, fallback to JPEG
            if result.data and len(result.data) > self.config.max_bytes:
                result = self._optimize_as_jpeg(image)
        else:
            result = self._optimize_as_jpeg(image)

        if not result.data:
            raise ValueError("Failed to optimize image")

        return ProcessedImage(
            data=result.data,
            mime_type=f"image/{result.format}",
            metadata=ImageMetadata(
                width=result.width,
                height=result.height,
                format=ImageFormat.PNG if result.format == "png" else ImageFormat.JPEG,
                has_alpha=result.format == "png",
                file_size=len(result.data)
            ),
            original_path=image.original_path
        )

    def _optimize_as_jpeg(self, image: ProcessedImage) -> OptimizationResult:
        """Optimize as JPEG"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # Convert to RGB
        if img.mode != "RGB":
            if img.mode in ("RGBA", "LA", "P"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                if img.mode in ("RGBA", "LA"):
                    mask = img.split()[-1]
                    background.paste(img, mask=mask)
                img = background
            else:
                img = img.convert("RGB")

        # Get current max dimension
        current_max = max(img.width, img.height)

        # Start from current size or max limit
        start_side = min(current_max, self.config.max_dimension_px)

        # Build resize grid
        resize_grid = [s for s in self.config.resize_grid if s <= start_side]
        if start_side not in resize_grid:
            resize_grid = [start_side] + resize_grid
        resize_grid.sort(reverse=True)

        best: Optional[OptimizationResult] = None

        for side in resize_grid:
            for quality in self.config.quality_grid:
                try:
                    result = self._resize_and_save_jpeg(img, side, quality)

                    # Track smallest result
                    if not best or len(result.data) < len(best.data):
                        best = result

                    # Within limit
                    if len(result.data) <= self.config.max_bytes:
                        return result

                except Exception:
                    continue

        # Return smallest even if over limit
        if best:
            return best

        raise ValueError("Failed to optimize image as JPEG")

    def _optimize_as_png(self, image: ProcessedImage) -> OptimizationResult:
        """Optimize as PNG"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # Ensure alpha
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")

        current_max = max(img.width, img.height)
        start_side = min(current_max, self.config.max_dimension_px)

        resize_grid = [s for s in self.config.resize_grid if s <= start_side]
        if start_side not in resize_grid:
            resize_grid = [start_side] + resize_grid
        resize_grid.sort(reverse=True)

        best: Optional[OptimizationResult] = None

        for side in resize_grid:
            for compression in self.config.png_compression_levels:
                try:
                    result = self._resize_and_save_png(img, side, compression)

                    if not best or len(result.data) < len(best.data):
                        best = result

                    if len(result.data) <= self.config.max_bytes:
                        return result

                except Exception:
                    continue

        if best:
            return best

        raise ValueError("Failed to optimize image as PNG")

    def _resize_and_save_jpeg(
        self,
        img: Image.Image,
        max_side: int,
        quality: int
    ) -> OptimizationResult:
        """Resize and save as JPEG"""
        resized = self._resize_image(img, max_side)

        output = io.BytesIO()
        resized.save(output, format="JPEG", quality=quality, optimize=True)

        return OptimizationResult(
            data=output.getvalue(),
            format="jpeg",
            width=resized.width,
            height=resized.height,
            quality=quality
        )

    def _resize_and_save_png(
        self,
        img: Image.Image,
        max_side: int,
        compression: int
    ) -> OptimizationResult:
        """Resize and save as PNG"""
        resized = self._resize_image(img, max_side)

        output = io.BytesIO()
        resized.save(output, format="PNG", compress_level=compression)

        return OptimizationResult(
            data=output.getvalue(),
            format="png",
            width=resized.width,
            height=resized.height,
            compression=compression
        )

    def _resize_image(self, img: Image.Image, max_side: int) -> Image.Image:
        """Resize image to fit within max_side"""
        if max(img.width, img.height) <= max_side:
            return img

        if img.width > img.height:
            new_width = max_side
            new_height = int(img.height * max_side / img.width)
        else:
            new_height = max_side
            new_width = int(img.width * max_side / img.height)

        return img.resize((new_width, new_height), Image.Resampling.LANCZOS)
