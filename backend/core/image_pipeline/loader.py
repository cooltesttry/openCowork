"""
Image File Loader

Loads images from local paths with security validation
"""

import asyncio
from pathlib import Path
from typing import Optional

from .types import DetectedImageRef, ProcessedImage, ImageMetadata, ImageFormat, RefType
from .config import get_config, PipelineConfig
from .mime import detect_format, format_to_mime


class ImageLoadError(Exception):
    """Image loading error"""
    pass


class ImageLoader:
    """Image file loader"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    async def load(self, ref: DetectedImageRef) -> ProcessedImage:
        """
        Load image from reference

        Args:
            ref: Detected image reference

        Returns:
            Processed image with raw data

        Raises:
            ImageLoadError: If loading fails
        """
        if ref.ref_type == RefType.PATH:
            return await self._load_from_path(ref)
        elif ref.ref_type == RefType.URL:
            return await self._load_from_url(ref)
        else:
            raise ImageLoadError(f"Unsupported reference type: {ref.ref_type}")

    async def _load_from_path(self, ref: DetectedImageRef) -> ProcessedImage:
        """Load from local path"""
        path = Path(ref.resolved).expanduser()

        # Security: sandbox validation
        if self.config.sandbox_root:
            sandbox = Path(self.config.sandbox_root).resolve()
            try:
                path.resolve().relative_to(sandbox)
            except ValueError:
                raise ImageLoadError(
                    f"Path outside sandbox: {ref.resolved}"
                )

        # Check existence
        if not path.exists():
            raise ImageLoadError(f"File not found: {ref.resolved}")

        if not path.is_file():
            raise ImageLoadError(f"Not a file: {ref.resolved}")

        # Check size (before loading) - allow up to 150MB for raw files
        # Optimizer will compress to target size later
        max_load_size = 150 * 1024 * 1024  # 150MB
        file_size = path.stat().st_size
        if file_size > max_load_size:
            raise ImageLoadError(
                f"File too large: {file_size} bytes (max: {max_load_size})"
            )

        # Load file
        try:
            data = await asyncio.to_thread(path.read_bytes)
        except Exception as e:
            raise ImageLoadError(f"Failed to read file: {e}")

        # Detect format
        fmt = detect_format(data, str(path))
        if fmt == ImageFormat.UNKNOWN:
            raise ImageLoadError(f"Unknown image format: {ref.resolved}")

        # Get metadata
        metadata = await self._get_metadata(data, fmt)

        return ProcessedImage(
            data=data,
            mime_type=format_to_mime(fmt),
            metadata=metadata,
            original_path=str(path)
        )

    async def _load_from_url(self, ref: DetectedImageRef) -> ProcessedImage:
        """Load from URL"""
        if not self.config.allow_remote_urls:
            raise ImageLoadError("Remote URLs are not allowed")

        try:
            import httpx
        except ImportError:
            raise ImageLoadError("httpx is required for remote URL loading")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(ref.resolved)
                response.raise_for_status()
                data = response.content
        except Exception as e:
            raise ImageLoadError(f"Failed to fetch URL: {e}")

        if len(data) > self.config.max_bytes * 2:
            raise ImageLoadError(f"Remote file too large: {len(data)} bytes")

        fmt = detect_format(data)
        if fmt == ImageFormat.UNKNOWN:
            raise ImageLoadError(f"Unknown image format from URL: {ref.resolved}")

        metadata = await self._get_metadata(data, fmt)

        return ProcessedImage(
            data=data,
            mime_type=format_to_mime(fmt),
            metadata=metadata,
            original_path=ref.resolved
        )

    async def _get_metadata(self, data: bytes, fmt: ImageFormat) -> ImageMetadata:
        """Extract image metadata"""
        try:
            from PIL import Image
            import io

            img = Image.open(io.BytesIO(data))

            # Check for alpha channel
            has_alpha = img.mode in ("RGBA", "LA", "PA") or (
                img.mode == "P" and "transparency" in img.info
            )

            # Read EXIF orientation
            exif_orientation = None
            try:
                exif = img.getexif()
                if exif:
                    exif_orientation = exif.get(274)  # 274 = Orientation tag
            except Exception:
                pass

            return ImageMetadata(
                width=img.width,
                height=img.height,
                format=fmt,
                has_alpha=has_alpha,
                exif_orientation=exif_orientation,
                file_size=len(data)
            )
        except Exception:
            # Fallback: return basic info
            return ImageMetadata(
                width=0,
                height=0,
                format=fmt,
                file_size=len(data)
            )
