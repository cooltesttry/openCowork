"""
Image Pipeline Type Definitions
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Literal


class ImageFormat(Enum):
    """Supported image formats"""
    JPEG = "jpeg"
    PNG = "png"
    GIF = "gif"
    WEBP = "webp"
    HEIC = "heic"
    BMP = "bmp"
    TIFF = "tiff"
    UNKNOWN = "unknown"


class RefType(Enum):
    """Reference types"""
    PATH = "path"           # Local file path
    URL = "url"             # HTTP(S) URL
    DATA_URL = "data_url"   # data:image/... format


@dataclass
class DetectedImageRef:
    """Detected image reference"""
    raw: str                          # Original matched string
    ref_type: RefType                 # Reference type
    resolved: str                     # Resolved path/URL
    message_index: Optional[int] = None  # Message index (for history)


@dataclass
class ImageMetadata:
    """Image metadata"""
    width: int
    height: int
    format: ImageFormat
    has_alpha: bool = False
    exif_orientation: Optional[int] = None
    file_size: int = 0


@dataclass
class ProcessedImage:
    """Processed image"""
    data: bytes                       # Image binary data
    mime_type: str                    # MIME type
    metadata: ImageMetadata           # Metadata
    original_path: Optional[str] = None  # Original path

    def to_base64(self) -> str:
        import base64
        return base64.b64encode(self.data).decode("utf-8")

    def to_data_url(self) -> str:
        return f"data:{self.mime_type};base64,{self.to_base64()}"


@dataclass
class ImageContent:
    """LLM API image content block"""
    type: Literal["image"] = "image"
    data: str = ""                    # base64 encoded
    mime_type: str = "image/jpeg"


@dataclass
class PipelineResult:
    """Pipeline processing result"""
    images: list[ImageContent] = field(default_factory=list)
    cleaned_prompt: str = ""          # Prompt with image refs removed
    detected_refs: list[DetectedImageRef] = field(default_factory=list)
    loaded_count: int = 0
    skipped_count: int = 0
    errors: list[str] = field(default_factory=list)
