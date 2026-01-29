"""
MIME Type Detection

Detects image format via magic bytes and file extension
"""

from pathlib import Path
from typing import Optional

from .types import ImageFormat


# Magic byte signatures
MAGIC_SIGNATURES = {
    b"\xff\xd8\xff": ImageFormat.JPEG,
    b"\x89PNG\r\n\x1a\n": ImageFormat.PNG,
    b"GIF87a": ImageFormat.GIF,
    b"GIF89a": ImageFormat.GIF,
    b"RIFF": ImageFormat.WEBP,  # Need to further check WEBP marker
    b"BM": ImageFormat.BMP,
    b"II*\x00": ImageFormat.TIFF,  # Little-endian TIFF
    b"MM\x00*": ImageFormat.TIFF,  # Big-endian TIFF
}

# HEIC ftyp brands
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}

# Extension mapping
EXTENSION_TO_FORMAT = {
    ".jpg": ImageFormat.JPEG,
    ".jpeg": ImageFormat.JPEG,
    ".png": ImageFormat.PNG,
    ".gif": ImageFormat.GIF,
    ".webp": ImageFormat.WEBP,
    ".bmp": ImageFormat.BMP,
    ".tiff": ImageFormat.TIFF,
    ".tif": ImageFormat.TIFF,
    ".heic": ImageFormat.HEIC,
    ".heif": ImageFormat.HEIC,
}

# Format to MIME type
FORMAT_TO_MIME = {
    ImageFormat.JPEG: "image/jpeg",
    ImageFormat.PNG: "image/png",
    ImageFormat.GIF: "image/gif",
    ImageFormat.WEBP: "image/webp",
    ImageFormat.BMP: "image/bmp",
    ImageFormat.TIFF: "image/tiff",
    ImageFormat.HEIC: "image/heic",
}


def detect_format_from_bytes(data: bytes) -> ImageFormat:
    """Detect image format via magic bytes"""
    if len(data) < 4:
        return ImageFormat.UNKNOWN

    # Check standard magic bytes
    for magic, fmt in MAGIC_SIGNATURES.items():
        if data.startswith(magic):
            # WEBP needs additional check
            if fmt == ImageFormat.WEBP:
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return ImageFormat.WEBP
                continue
            return fmt

    # Check HEIC (ftyp box)
    if len(data) >= 12:
        if data[4:8] == b"ftyp":
            brand = data[8:12]
            if brand in HEIC_BRANDS:
                return ImageFormat.HEIC

    return ImageFormat.UNKNOWN


def detect_format_from_extension(path: str) -> ImageFormat:
    """Detect format via file extension"""
    ext = Path(path).suffix.lower()
    return EXTENSION_TO_FORMAT.get(ext, ImageFormat.UNKNOWN)


def detect_format(data: bytes, path: Optional[str] = None) -> ImageFormat:
    """Detect image format (magic bytes first, then extension)"""
    fmt = detect_format_from_bytes(data)
    if fmt != ImageFormat.UNKNOWN:
        return fmt

    if path:
        return detect_format_from_extension(path)

    return ImageFormat.UNKNOWN


def format_to_mime(fmt: ImageFormat) -> str:
    """Convert format to MIME type"""
    return FORMAT_TO_MIME.get(fmt, "application/octet-stream")


def detect_mime(data: bytes, path: Optional[str] = None) -> str:
    """Detect MIME type"""
    fmt = detect_format(data, path)
    return format_to_mime(fmt)
