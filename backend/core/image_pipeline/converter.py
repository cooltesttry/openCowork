"""
Image Format Converter

Converts unsupported formats to compatible ones (JPEG, PNG, GIF, WebP)
"""

import io
from typing import Optional

from PIL import Image

from .types import ProcessedImage, ImageMetadata, ImageFormat
from .config import get_config, PipelineConfig
from .exif import apply_orientation_fix


class ImageConverter:
    """Image format converter"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    def convert_to_jpeg(
        self,
        image: ProcessedImage,
        quality: int = 85
    ) -> ProcessedImage:
        """Convert to JPEG format"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # Convert to RGB (handle alpha)
        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            if img.mode in ("RGBA", "LA"):
                mask = img.split()[-1]
                background.paste(img, mask=mask)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # Export
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=quality, optimize=True)
        data = output.getvalue()

        return ProcessedImage(
            data=data,
            mime_type="image/jpeg",
            metadata=ImageMetadata(
                width=img.width,
                height=img.height,
                format=ImageFormat.JPEG,
                has_alpha=False,
                file_size=len(data)
            ),
            original_path=image.original_path
        )

    def convert_to_png(
        self,
        image: ProcessedImage,
        compression_level: int = 6
    ) -> ProcessedImage:
        """Convert to PNG format (preserves alpha)"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # Ensure alpha channel
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")

        # Export
        output = io.BytesIO()
        img.save(output, format="PNG", compress_level=compression_level)
        data = output.getvalue()

        return ProcessedImage(
            data=data,
            mime_type="image/png",
            metadata=ImageMetadata(
                width=img.width,
                height=img.height,
                format=ImageFormat.PNG,
                has_alpha=True,
                file_size=len(data)
            ),
            original_path=image.original_path
        )

    def convert_heic_to_jpeg(
        self,
        image: ProcessedImage,
        quality: int = 85
    ) -> ProcessedImage:
        """Convert HEIC to JPEG"""
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            raise RuntimeError(
                "pillow-heif is required for HEIC support. "
                "Install with: pip install pillow-heif"
            )

        return self.convert_to_jpeg(image, quality)

    def ensure_compatible_format(
        self,
        image: ProcessedImage,
        preserve_alpha: bool = True
    ) -> ProcessedImage:
        """
        Ensure image format is compatible with LLM API

        Args:
            image: Original image
            preserve_alpha: Whether to preserve alpha channel

        Returns:
            Image in compatible format
        """
        fmt = image.metadata.format

        # HEIC must be converted
        if fmt == ImageFormat.HEIC:
            return self.convert_heic_to_jpeg(image)

        # BMP/TIFF convert to more common format
        if fmt in (ImageFormat.BMP, ImageFormat.TIFF):
            if image.metadata.has_alpha and preserve_alpha:
                return self.convert_to_png(image)
            return self.convert_to_jpeg(image)

        # PNG keep as-is if has alpha
        if fmt == ImageFormat.PNG and image.metadata.has_alpha:
            return image

        # JPEG/GIF/WEBP/PNG are already compatible
        if fmt in (ImageFormat.JPEG, ImageFormat.GIF, ImageFormat.WEBP, ImageFormat.PNG):
            return image

        # Unknown format, try to convert to JPEG
        return self.convert_to_jpeg(image)
