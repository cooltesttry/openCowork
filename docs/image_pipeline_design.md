# 图片处理管线开发文档

## 1. 概述

本文档描述一个用于 LLM 应用的图片处理管线,负责从用户 Prompt 中识别图片路径,并对图片进行转换、优化、压缩,最终注入到模型请求中。

### 1.1 设计目标

- **兼容性**: 支持主流图片格式 (JPEG, PNG, GIF, WebP, HEIC, BMP, TIFF)
- **安全性**: 路径验证、沙盒限制、大小限制
- **效率**: 自动优化图片尺寸和质量,减少 Token 消耗
- **可扩展**: 模块化设计,易于添加新格式或处理逻辑

### 1.2 核心流程

```
用户 Prompt → 路径检测 → 文件加载 → 格式转换 → 尺寸优化 → 质量压缩 → 清理验证 → 注入 Prompt
```

---

## 2. 模块架构

```
image_pipeline/
├── __init__.py
├── config.py           # 配置管理
├── detector.py         # 路径检测
├── loader.py           # 文件加载
├── converter.py        # 格式转换
├── optimizer.py        # 尺寸/质量优化
├── sanitizer.py        # 清理验证
├── injector.py         # Prompt 注入
├── mime.py             # MIME 类型检测
├── exif.py             # EXIF 方向处理
├── types.py            # 类型定义
└── utils.py            # 工具函数
```

---

## 3. 类型定义 (`types.py`)

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Literal
from pathlib import Path


class ImageFormat(Enum):
    """支持的图片格式"""
    JPEG = "jpeg"
    PNG = "png"
    GIF = "gif"
    WEBP = "webp"
    HEIC = "heic"
    BMP = "bmp"
    TIFF = "tiff"
    UNKNOWN = "unknown"


class RefType(Enum):
    """引用类型"""
    PATH = "path"           # 本地路径
    URL = "url"             # HTTP(S) URL
    DATA_URL = "data_url"   # data:image/... 格式


@dataclass
class DetectedImageRef:
    """检测到的图片引用"""
    raw: str                          # 原始匹配字符串
    ref_type: RefType                 # 引用类型
    resolved: str                     # 解析后的路径/URL
    message_index: Optional[int] = None  # 消息索引 (用于历史消息)


@dataclass
class ImageMetadata:
    """图片元信息"""
    width: int
    height: int
    format: ImageFormat
    has_alpha: bool = False
    exif_orientation: Optional[int] = None
    file_size: int = 0


@dataclass
class ProcessedImage:
    """处理后的图片"""
    data: bytes                       # 图片二进制数据
    mime_type: str                    # MIME 类型
    metadata: ImageMetadata           # 元信息
    original_path: Optional[str] = None  # 原始路径

    def to_base64(self) -> str:
        import base64
        return base64.b64encode(self.data).decode("utf-8")

    def to_data_url(self) -> str:
        return f"data:{self.mime_type};base64,{self.to_base64()}"


@dataclass
class ImageContent:
    """LLM API 图片内容块"""
    type: Literal["image"] = "image"
    data: str = ""                    # base64 编码
    mime_type: str = "image/jpeg"


@dataclass
class PipelineConfig:
    """管线配置"""
    # 尺寸限制
    max_dimension_px: int = 2000      # 单边最大像素
    max_bytes: int = 5 * 1024 * 1024  # 最大字节数 (5MB)

    # 优化参数
    resize_grid: list[int] = field(default_factory=lambda: [2000, 1800, 1600, 1400, 1200, 1000, 800])
    quality_grid: list[int] = field(default_factory=lambda: [85, 75, 65, 55, 45, 35])

    # PNG 压缩级别
    png_compression_levels: list[int] = field(default_factory=lambda: [6, 7, 8, 9])

    # 安全设置
    sandbox_root: Optional[str] = None  # 沙盒根目录
    allow_remote_urls: bool = False     # 是否允许远程 URL

    # 格式转换
    convert_heic_to_jpeg: bool = True
    preserve_alpha_as_png: bool = True


@dataclass
class PipelineResult:
    """管线处理结果"""
    images: list[ImageContent]                           # 当前 Prompt 的图片
    history_images: dict[int, list[ImageContent]]        # 历史消息的图片 {消息索引: 图片列表}
    detected_refs: list[DetectedImageRef]                # 检测到的引用
    loaded_count: int = 0                                # 成功加载数
    skipped_count: int = 0                               # 跳过数
    errors: list[str] = field(default_factory=list)      # 错误信息
```

---

## 4. 配置管理 (`config.py`)

```python
from dataclasses import dataclass, field
from typing import Optional
import os


@dataclass
class PipelineConfig:
    """管线配置 - 支持环境变量覆盖"""

    # 尺寸限制
    max_dimension_px: int = 2000
    max_bytes: int = 5 * 1024 * 1024

    # 优化网格
    resize_grid: list[int] = field(
        default_factory=lambda: [2000, 1800, 1600, 1400, 1200, 1000, 800]
    )
    quality_grid: list[int] = field(
        default_factory=lambda: [85, 75, 65, 55, 45, 35]
    )

    # 安全设置
    sandbox_root: Optional[str] = None
    allow_remote_urls: bool = False

    # 格式转换
    convert_heic_to_jpeg: bool = True
    preserve_alpha_as_png: bool = True

    @classmethod
    def from_env(cls) -> "PipelineConfig":
        """从环境变量创建配置"""
        return cls(
            max_dimension_px=int(os.getenv("IMAGE_MAX_DIMENSION", "2000")),
            max_bytes=int(os.getenv("IMAGE_MAX_BYTES", str(5 * 1024 * 1024))),
            sandbox_root=os.getenv("IMAGE_SANDBOX_ROOT"),
            allow_remote_urls=os.getenv("IMAGE_ALLOW_REMOTE", "false").lower() == "true",
        )


# 全局默认配置
DEFAULT_CONFIG = PipelineConfig()


def get_config() -> PipelineConfig:
    """获取当前配置"""
    return DEFAULT_CONFIG
```

---

## 5. 路径检测模块 (`detector.py`)

```python
"""
路径检测模块

支持的模式:
1. 绝对路径: /path/to/image.png
2. 相对路径: ./image.png, ../images/photo.jpg
3. Home 路径: ~/Pictures/screenshot.png
4. file:// URL: file:///path/to/image.png
5. 消息附件格式: [Image: source: /path/to/image.jpg]
6. 媒体附件格式: [media attached: path (type) | url]
"""

import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from .types import DetectedImageRef, RefType


# 支持的图片扩展名
IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".bmp", ".tiff", ".tif", ".heic", ".heif"
}

# 图片扩展名正则 (用于模式匹配)
IMAGE_EXT_PATTERN = r"\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif)"


class ImageReferenceDetector:
    """图片引用检测器"""

    def __init__(self, allow_remote: bool = False):
        self.allow_remote = allow_remote
        self._compile_patterns()

    def _compile_patterns(self):
        """编译正则表达式"""
        # 消息附件格式: [media attached: path (type) | url] 或 [media attached N/M: ...]
        self.media_attached_pattern = re.compile(
            r"\[media attached(?:\s+\d+/\d+)?:\s*([^\]]+)\]",
            re.IGNORECASE
        )

        # 图片消息格式: [Image: source: /path/...]
        self.message_image_pattern = re.compile(
            rf"\[Image:\s*source:\s*([^\]]+{IMAGE_EXT_PATTERN})\]",
            re.IGNORECASE
        )

        # file:// URL
        self.file_url_pattern = re.compile(
            rf"file://[^\s<>\"'`\]]+{IMAGE_EXT_PATTERN}",
            re.IGNORECASE
        )

        # 本地路径 (绝对、相对、Home)
        self.local_path_pattern = re.compile(
            rf"(?:^|\s|[\"'`(])((?:\.\.?/|[~/])[^\s\"'`()\[\]]*{IMAGE_EXT_PATTERN})",
            re.IGNORECASE
        )

        # HTTP(S) URL
        self.http_url_pattern = re.compile(
            rf"https?://[^\s<>\"'`\]]+{IMAGE_EXT_PATTERN}",
            re.IGNORECASE
        )

        # 路径中提取图片路径 (用于 media attached 格式)
        self.path_extract_pattern = re.compile(
            rf"^\s*(.+?{IMAGE_EXT_PATTERN})\s*(?:\(|$|\|)",
            re.IGNORECASE
        )

    def detect(self, text: str) -> list[DetectedImageRef]:
        """
        从文本中检测图片引用

        Args:
            text: 用户输入文本

        Returns:
            检测到的图片引用列表
        """
        refs: list[DetectedImageRef] = []
        seen: set[str] = set()

        def add_path_ref(raw: str) -> None:
            """添加路径引用"""
            trimmed = raw.strip()
            if not trimmed:
                return

            # 跳过 HTTP URL (除非显式允许)
            if trimmed.startswith(("http://", "https://")):
                if not self.allow_remote:
                    return

            # 检查扩展名
            if not self._is_image_extension(trimmed):
                return

            # 去重
            key = trimmed.lower()
            if key in seen:
                return
            seen.add(key)

            # 解析路径
            resolved = self._resolve_path(trimmed)
            refs.append(DetectedImageRef(
                raw=trimmed,
                ref_type=RefType.PATH,
                resolved=resolved
            ))

        # 1. 解析 [media attached: ...] 格式
        for match in self.media_attached_pattern.finditer(text):
            content = match.group(1)
            # 跳过 "N files" 汇总行
            if re.match(r"^\d+\s+files?$", content.strip(), re.IGNORECASE):
                continue
            # 提取路径
            path_match = self.path_extract_pattern.match(content)
            if path_match:
                add_path_ref(path_match.group(1))

        # 2. 解析 [Image: source: ...] 格式
        for match in self.message_image_pattern.finditer(text):
            add_path_ref(match.group(1))

        # 3. 解析 file:// URL
        for match in self.file_url_pattern.finditer(text):
            raw = match.group(0)
            key = raw.lower()
            if key in seen:
                continue
            seen.add(key)

            try:
                from urllib.request import url2pathname
                resolved = url2pathname(urlparse(raw).path)
                refs.append(DetectedImageRef(
                    raw=raw,
                    ref_type=RefType.PATH,
                    resolved=resolved
                ))
            except Exception:
                pass

        # 4. 解析本地路径
        for match in self.local_path_pattern.finditer(text):
            add_path_ref(match.group(1))

        # 5. 解析 HTTP URL (如果允许)
        if self.allow_remote:
            for match in self.http_url_pattern.finditer(text):
                raw = match.group(0)
                key = raw.lower()
                if key in seen:
                    continue
                seen.add(key)
                refs.append(DetectedImageRef(
                    raw=raw,
                    ref_type=RefType.URL,
                    resolved=raw
                ))

        return refs

    def detect_from_messages(
        self,
        messages: list[dict],
        current_prompt: str
    ) -> tuple[list[DetectedImageRef], list[DetectedImageRef]]:
        """
        从消息历史和当前 Prompt 中检测图片引用

        Args:
            messages: 消息历史列表 [{"role": "user", "content": "..."}]
            current_prompt: 当前用户输入

        Returns:
            (当前 Prompt 的引用, 历史消息的引用)
        """
        # 检测当前 Prompt
        prompt_refs = self.detect(current_prompt)
        seen_paths = {r.resolved.lower() for r in prompt_refs}

        # 检测历史消息
        history_refs: list[DetectedImageRef] = []

        for i, msg in enumerate(messages):
            if msg.get("role") != "user":
                continue

            # 跳过已有图片内容的消息
            content = msg.get("content")
            if isinstance(content, list):
                has_image = any(
                    isinstance(part, dict) and part.get("type") == "image"
                    for part in content
                )
                if has_image:
                    continue

            # 提取文本
            text = self._extract_text(msg)
            if not text:
                continue

            # 检测引用
            for ref in self.detect(text):
                key = ref.resolved.lower()
                if key in seen_paths:
                    continue
                seen_paths.add(key)
                ref.message_index = i
                history_refs.append(ref)

        return prompt_refs, history_refs

    def _is_image_extension(self, path: str) -> bool:
        """检查是否为图片扩展名"""
        ext = Path(path).suffix.lower()
        return ext in IMAGE_EXTENSIONS

    def _resolve_path(self, path: str) -> str:
        """解析路径 (展开 ~ 等)"""
        if path.startswith("~"):
            return str(Path(path).expanduser())
        return path

    def _extract_text(self, message: dict) -> str:
        """从消息中提取文本"""
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    parts.append(part.get("text", ""))
                elif isinstance(part, str):
                    parts.append(part)
            return "\n".join(parts)
        return ""


# 便捷函数
def detect_image_references(text: str, allow_remote: bool = False) -> list[DetectedImageRef]:
    """检测文本中的图片引用"""
    detector = ImageReferenceDetector(allow_remote=allow_remote)
    return detector.detect(text)
```

---

## 6. MIME 类型检测 (`mime.py`)

```python
"""
MIME 类型检测模块

通过文件魔数 (Magic Bytes) 和扩展名识别图片格式
"""

from pathlib import Path
from typing import Optional
from .types import ImageFormat


# 文件魔数签名
MAGIC_SIGNATURES = {
    b"\xff\xd8\xff": ImageFormat.JPEG,
    b"\x89PNG\r\n\x1a\n": ImageFormat.PNG,
    b"GIF87a": ImageFormat.GIF,
    b"GIF89a": ImageFormat.GIF,
    b"RIFF": ImageFormat.WEBP,  # 需要进一步检查 WEBP 标识
    b"BM": ImageFormat.BMP,
    b"II*\x00": ImageFormat.TIFF,  # Little-endian TIFF
    b"MM\x00*": ImageFormat.TIFF,  # Big-endian TIFF
}

# HEIC 需要检查 ftyp box
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}

# 扩展名映射
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

# 格式到 MIME 类型
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
    """
    通过魔数检测图片格式

    Args:
        data: 图片数据 (至少需要前 12 字节)

    Returns:
        检测到的图片格式
    """
    if len(data) < 4:
        return ImageFormat.UNKNOWN

    # 检查常规魔数
    for magic, fmt in MAGIC_SIGNATURES.items():
        if data.startswith(magic):
            # WEBP 需要额外检查
            if fmt == ImageFormat.WEBP:
                if len(data) >= 12 and data[8:12] == b"WEBP":
                    return ImageFormat.WEBP
                continue
            return fmt

    # 检查 HEIC (ftyp box)
    if len(data) >= 12:
        # ftyp box 格式: [size:4][ftyp:4][brand:4]
        if data[4:8] == b"ftyp":
            brand = data[8:12]
            if brand in HEIC_BRANDS:
                return ImageFormat.HEIC

    return ImageFormat.UNKNOWN


def detect_format_from_extension(path: str) -> ImageFormat:
    """通过扩展名检测图片格式"""
    ext = Path(path).suffix.lower()
    return EXTENSION_TO_FORMAT.get(ext, ImageFormat.UNKNOWN)


def detect_format(data: bytes, path: Optional[str] = None) -> ImageFormat:
    """
    综合检测图片格式 (优先使用魔数)

    Args:
        data: 图片数据
        path: 可选的文件路径 (用于扩展名回退)

    Returns:
        检测到的图片格式
    """
    # 优先使用魔数
    fmt = detect_format_from_bytes(data)
    if fmt != ImageFormat.UNKNOWN:
        return fmt

    # 回退到扩展名
    if path:
        return detect_format_from_extension(path)

    return ImageFormat.UNKNOWN


def format_to_mime(fmt: ImageFormat) -> str:
    """格式转 MIME 类型"""
    return FORMAT_TO_MIME.get(fmt, "application/octet-stream")


def detect_mime(data: bytes, path: Optional[str] = None) -> str:
    """检测 MIME 类型"""
    fmt = detect_format(data, path)
    return format_to_mime(fmt)


def extension_for_format(fmt: ImageFormat) -> str:
    """获取格式对应的扩展名"""
    mapping = {
        ImageFormat.JPEG: ".jpg",
        ImageFormat.PNG: ".png",
        ImageFormat.GIF: ".gif",
        ImageFormat.WEBP: ".webp",
        ImageFormat.BMP: ".bmp",
        ImageFormat.TIFF: ".tiff",
        ImageFormat.HEIC: ".heic",
    }
    return mapping.get(fmt, "")
```

---

## 7. 文件加载模块 (`loader.py`)

```python
"""
文件加载模块

负责从本地路径或 URL 加载图片文件
"""

import asyncio
from pathlib import Path
from typing import Optional
import aiofiles
import httpx

from .types import DetectedImageRef, RefType, ProcessedImage, ImageMetadata, ImageFormat, PipelineConfig
from .mime import detect_format, format_to_mime
from .config import get_config


class ImageLoadError(Exception):
    """图片加载错误"""
    pass


class ImageLoader:
    """图片加载器"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    async def load(self, ref: DetectedImageRef) -> ProcessedImage:
        """
        加载图片

        Args:
            ref: 图片引用

        Returns:
            处理后的图片对象

        Raises:
            ImageLoadError: 加载失败
        """
        if ref.ref_type == RefType.URL:
            return await self._load_from_url(ref)
        elif ref.ref_type == RefType.DATA_URL:
            return self._load_from_data_url(ref)
        else:
            return await self._load_from_path(ref)

    async def _load_from_path(self, ref: DetectedImageRef) -> ProcessedImage:
        """从本地路径加载"""
        path = Path(ref.resolved)

        # 安全检查: 沙盒限制
        if self.config.sandbox_root:
            sandbox = Path(self.config.sandbox_root).resolve()
            try:
                resolved = path.resolve()
                resolved.relative_to(sandbox)
            except ValueError:
                raise ImageLoadError(
                    f"Path '{ref.resolved}' is outside sandbox root"
                )

        # 检查文件存在
        if not path.exists():
            raise ImageLoadError(f"File not found: {ref.resolved}")

        if not path.is_file():
            raise ImageLoadError(f"Not a file: {ref.resolved}")

        # 读取文件
        async with aiofiles.open(path, "rb") as f:
            data = await f.read()

        # 检查大小
        if len(data) > self.config.max_bytes * 2:  # 允许加载 2x 限制 (后续会压缩)
            raise ImageLoadError(
                f"File too large: {len(data)} bytes (max: {self.config.max_bytes * 2})"
            )

        # 检测格式
        fmt = detect_format(data, str(path))
        if fmt == ImageFormat.UNKNOWN:
            raise ImageLoadError(f"Unknown image format: {ref.resolved}")

        # 获取元信息
        metadata = await self._get_metadata(data, fmt)

        return ProcessedImage(
            data=data,
            mime_type=format_to_mime(fmt),
            metadata=metadata,
            original_path=ref.resolved
        )

    async def _load_from_url(self, ref: DetectedImageRef) -> ProcessedImage:
        """从 URL 加载"""
        if not self.config.allow_remote_urls:
            raise ImageLoadError("Remote URLs are not allowed")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(ref.resolved)
                response.raise_for_status()
                data = response.content
        except httpx.HTTPError as e:
            raise ImageLoadError(f"Failed to fetch URL: {e}")

        # 检查大小
        if len(data) > self.config.max_bytes * 2:
            raise ImageLoadError(f"Remote file too large: {len(data)} bytes")

        # 检测格式
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

    def _load_from_data_url(self, ref: DetectedImageRef) -> ProcessedImage:
        """从 data URL 加载"""
        import base64
        import re

        match = re.match(r"data:([^;]+);base64,(.+)", ref.resolved)
        if not match:
            raise ImageLoadError("Invalid data URL format")

        mime_type = match.group(1)
        try:
            data = base64.b64decode(match.group(2))
        except Exception as e:
            raise ImageLoadError(f"Failed to decode base64: {e}")

        fmt = detect_format(data)
        metadata = asyncio.get_event_loop().run_until_complete(
            self._get_metadata(data, fmt)
        )

        return ProcessedImage(
            data=data,
            mime_type=mime_type,
            metadata=metadata
        )

    async def _get_metadata(self, data: bytes, fmt: ImageFormat) -> ImageMetadata:
        """获取图片元信息"""
        try:
            from PIL import Image
            import io

            img = Image.open(io.BytesIO(data))

            # 检查是否有 alpha 通道
            has_alpha = img.mode in ("RGBA", "LA", "PA") or (
                img.mode == "P" and "transparency" in img.info
            )

            # 读取 EXIF 方向
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
        except Exception as e:
            # 回退: 返回基本信息
            return ImageMetadata(
                width=0,
                height=0,
                format=fmt,
                file_size=len(data)
            )


async def load_image(ref: DetectedImageRef, config: Optional[PipelineConfig] = None) -> ProcessedImage:
    """便捷函数: 加载图片"""
    loader = ImageLoader(config)
    return await loader.load(ref)
```

---

## 8. EXIF 方向处理 (`exif.py`)

```python
"""
EXIF 方向处理模块

修正由于 EXIF Orientation 标签导致的图片方向问题
"""

from typing import Optional
from PIL import Image
from PIL.ExifTags import TAGS
import io


# EXIF Orientation 值与变换的映射
# 1 = Normal, 2 = Flip H, 3 = Rotate 180, 4 = Flip V,
# 5 = Rotate 270 CW + Flip H, 6 = Rotate 90 CW, 7 = Rotate 90 CW + Flip H, 8 = Rotate 270 CW
ORIENTATION_TRANSFORMS = {
    2: [Image.Transpose.FLIP_LEFT_RIGHT],
    3: [Image.Transpose.ROTATE_180],
    4: [Image.Transpose.FLIP_TOP_BOTTOM],
    5: [Image.Transpose.ROTATE_270, Image.Transpose.FLIP_LEFT_RIGHT],
    6: [Image.Transpose.ROTATE_270],
    7: [Image.Transpose.ROTATE_90, Image.Transpose.FLIP_LEFT_RIGHT],
    8: [Image.Transpose.ROTATE_90],
}


def read_exif_orientation(data: bytes) -> Optional[int]:
    """
    读取 JPEG 图片的 EXIF 方向

    Args:
        data: 图片数据

    Returns:
        方向值 (1-8), 或 None
    """
    try:
        img = Image.open(io.BytesIO(data))
        exif = img.getexif()
        if exif:
            return exif.get(274)  # 274 = Orientation tag
    except Exception:
        pass
    return None


def normalize_orientation(data: bytes, format: str = "JPEG") -> bytes:
    """
    根据 EXIF Orientation 修正图片方向

    Args:
        data: 原始图片数据
        format: 输出格式

    Returns:
        修正后的图片数据
    """
    try:
        img = Image.open(io.BytesIO(data))

        # 读取 EXIF 方向
        orientation = None
        try:
            exif = img.getexif()
            if exif:
                orientation = exif.get(274)
        except Exception:
            pass

        # 无需变换
        if not orientation or orientation == 1:
            return data

        # 应用变换
        transforms = ORIENTATION_TRANSFORMS.get(orientation)
        if not transforms:
            return data

        for transform in transforms:
            img = img.transpose(transform)

        # 导出
        output = io.BytesIO()

        # 移除 EXIF 方向标签 (已应用)
        exif_data = img.getexif()
        if exif_data and 274 in exif_data:
            del exif_data[274]

        save_kwargs = {"format": format}
        if format.upper() == "JPEG":
            save_kwargs["quality"] = 95
            save_kwargs["exif"] = exif_data.tobytes() if exif_data else b""

        img.save(output, **save_kwargs)
        return output.getvalue()

    except Exception:
        # 失败时返回原数据
        return data


def apply_orientation_fix(img: Image.Image) -> Image.Image:
    """
    对 PIL Image 对象应用方向修正

    Args:
        img: PIL Image 对象

    Returns:
        修正后的 Image 对象
    """
    try:
        exif = img.getexif()
        if not exif:
            return img

        orientation = exif.get(274)
        if not orientation or orientation == 1:
            return img

        transforms = ORIENTATION_TRANSFORMS.get(orientation)
        if not transforms:
            return img

        for transform in transforms:
            img = img.transpose(transform)

        return img

    except Exception:
        return img
```

---

## 9. 格式转换模块 (`converter.py`)

```python
"""
格式转换模块

处理需要转换的图片格式 (如 HEIC → JPEG)
"""

import io
from typing import Optional
from PIL import Image

from .types import ProcessedImage, ImageMetadata, ImageFormat
from .mime import format_to_mime
from .exif import apply_orientation_fix


class ImageConverter:
    """图片格式转换器"""

    def convert_to_jpeg(
        self,
        image: ProcessedImage,
        quality: int = 90
    ) -> ProcessedImage:
        """
        转换为 JPEG 格式

        Args:
            image: 原始图片
            quality: JPEG 质量 (1-100)

        Returns:
            转换后的图片
        """
        img = Image.open(io.BytesIO(image.data))

        # 应用 EXIF 方向修正
        img = apply_orientation_fix(img)

        # 转换为 RGB (移除 alpha 通道)
        if img.mode in ("RGBA", "LA", "P"):
            # 创建白色背景
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # 导出
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
        """
        转换为 PNG 格式 (保留 alpha 通道)

        Args:
            image: 原始图片
            compression_level: 压缩级别 (0-9)

        Returns:
            转换后的图片
        """
        img = Image.open(io.BytesIO(image.data))

        # 应用 EXIF 方向修正
        img = apply_orientation_fix(img)

        # 确保有 alpha 通道
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")

        # 导出
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
        quality: int = 90
    ) -> ProcessedImage:
        """
        HEIC 转 JPEG

        需要安装 pillow-heif: pip install pillow-heif
        """
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
        确保图片格式兼容 LLM API

        Args:
            image: 原始图片
            preserve_alpha: 是否保留 alpha 通道

        Returns:
            兼容格式的图片
        """
        fmt = image.metadata.format

        # HEIC 必须转换
        if fmt == ImageFormat.HEIC:
            return self.convert_heic_to_jpeg(image)

        # BMP/TIFF 转为更通用的格式
        if fmt in (ImageFormat.BMP, ImageFormat.TIFF):
            if image.metadata.has_alpha and preserve_alpha:
                return self.convert_to_png(image)
            return self.convert_to_jpeg(image)

        # PNG 保持不变 (如果有 alpha)
        if fmt == ImageFormat.PNG and image.metadata.has_alpha:
            return image

        # JPEG/GIF/WEBP/PNG 已经兼容
        if fmt in (ImageFormat.JPEG, ImageFormat.GIF, ImageFormat.WEBP, ImageFormat.PNG):
            return image

        # 未知格式尝试转为 JPEG
        return self.convert_to_jpeg(image)
```

---

## 10. 尺寸/质量优化模块 (`optimizer.py`)

```python
"""
图片优化模块

自动调整图片尺寸和质量以满足 API 限制
"""

import io
from dataclasses import dataclass
from typing import Optional
from PIL import Image

from .types import ProcessedImage, ImageMetadata, ImageFormat, PipelineConfig
from .exif import apply_orientation_fix
from .config import get_config


@dataclass
class OptimizationResult:
    """优化结果"""
    data: bytes
    format: str  # "jpeg" or "png"
    width: int
    height: int
    quality: Optional[int] = None      # JPEG 质量
    compression: Optional[int] = None  # PNG 压缩级别
    resize_side: int = 0               # 缩放后的最大边


class ImageOptimizer:
    """图片优化器"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    def needs_optimization(self, image: ProcessedImage) -> bool:
        """检查图片是否需要优化"""
        meta = image.metadata

        # 尺寸超限
        if meta.width > self.config.max_dimension_px or meta.height > self.config.max_dimension_px:
            return True

        # 大小超限
        if meta.file_size > self.config.max_bytes:
            return True

        return False

    def optimize(self, image: ProcessedImage) -> ProcessedImage:
        """
        优化图片

        策略:
        1. 如果有 alpha 通道且需要保留, 使用 PNG
        2. 否则使用 JPEG
        3. 尝试不同的尺寸/质量组合直到满足限制

        Args:
            image: 原始图片

        Returns:
            优化后的图片
        """
        # 检查是否需要保留 alpha
        preserve_alpha = (
            self.config.preserve_alpha_as_png and
            image.metadata.has_alpha
        )

        if preserve_alpha:
            result = self._optimize_as_png(image)

            # 如果 PNG 还是太大, 降级为 JPEG
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
        """优化为 JPEG"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # 转为 RGB
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

        # 获取当前最大边
        current_max = max(img.width, img.height)

        # 如果当前尺寸小于限制, 从当前尺寸开始
        start_side = min(current_max, self.config.max_dimension_px)

        # 构建尺寸网格
        resize_grid = [s for s in self.config.resize_grid if s <= start_side]
        if start_side not in resize_grid:
            resize_grid = [start_side] + resize_grid
        resize_grid.sort(reverse=True)

        best: Optional[OptimizationResult] = None

        for side in resize_grid:
            for quality in self.config.quality_grid:
                try:
                    result = self._resize_and_save_jpeg(img, side, quality)

                    # 记录最小结果
                    if not best or len(result.data) < len(best.data):
                        best = result

                    # 满足限制
                    if len(result.data) <= self.config.max_bytes:
                        return result

                except Exception:
                    continue

        # 返回最小的结果 (即使超限)
        if best:
            return best

        raise ValueError("Failed to optimize image as JPEG")

    def _optimize_as_png(self, image: ProcessedImage) -> OptimizationResult:
        """优化为 PNG"""
        img = Image.open(io.BytesIO(image.data))
        img = apply_orientation_fix(img)

        # 确保有 alpha
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")

        # 获取当前最大边
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
        """缩放并保存为 JPEG"""
        # 计算新尺寸
        ratio = min(max_side / img.width, max_side / img.height)
        if ratio < 1:
            new_width = int(img.width * ratio)
            new_height = int(img.height * ratio)
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        else:
            resized = img
            new_width, new_height = img.width, img.height

        # 保存
        output = io.BytesIO()
        resized.save(
            output,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True
        )

        return OptimizationResult(
            data=output.getvalue(),
            format="jpeg",
            width=new_width,
            height=new_height,
            quality=quality,
            resize_side=max_side
        )

    def _resize_and_save_png(
        self,
        img: Image.Image,
        max_side: int,
        compression: int
    ) -> OptimizationResult:
        """缩放并保存为 PNG"""
        ratio = min(max_side / img.width, max_side / img.height)
        if ratio < 1:
            new_width = int(img.width * ratio)
            new_height = int(img.height * ratio)
            resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        else:
            resized = img
            new_width, new_height = img.width, img.height

        output = io.BytesIO()
        resized.save(output, format="PNG", compress_level=compression)

        return OptimizationResult(
            data=output.getvalue(),
            format="png",
            width=new_width,
            height=new_height,
            compression=compression,
            resize_side=max_side
        )


def optimize_image(
    image: ProcessedImage,
    config: Optional[PipelineConfig] = None
) -> ProcessedImage:
    """便捷函数: 优化图片"""
    optimizer = ImageOptimizer(config)
    if optimizer.needs_optimization(image):
        return optimizer.optimize(image)
    return image
```

---

## 11. 清理验证模块 (`sanitizer.py`)

```python
"""
清理验证模块

对图片进行最终验证和清理, 确保符合 API 要求
"""

import base64
from dataclasses import dataclass
from typing import Optional

from .types import ProcessedImage, ImageContent, PipelineConfig
from .mime import detect_format, ImageFormat
from .config import get_config


@dataclass
class SanitizeResult:
    """清理结果"""
    content: Optional[ImageContent]
    dropped: bool = False
    error: Optional[str] = None


class ImageSanitizer:
    """图片清理验证器"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or get_config()

    def sanitize(self, image: ProcessedImage, label: str = "") -> SanitizeResult:
        """
        清理验证图片

        Args:
            image: 处理后的图片
            label: 日志标签

        Returns:
            清理结果
        """
        # 1. 验证数据非空
        if not image.data:
            return SanitizeResult(
                content=None,
                dropped=True,
                error=f"[{label}] Empty image data"
            )

        # 2. 验证格式
        detected = detect_format(image.data)
        if detected == ImageFormat.UNKNOWN:
            return SanitizeResult(
                content=None,
                dropped=True,
                error=f"[{label}] Unknown image format"
            )

        # 3. 验证大小
        if len(image.data) > self.config.max_bytes:
            return SanitizeResult(
                content=None,
                dropped=True,
                error=f"[{label}] Image too large: {len(image.data)} > {self.config.max_bytes}"
            )

        # 4. 验证尺寸
        if (image.metadata.width > self.config.max_dimension_px or
            image.metadata.height > self.config.max_dimension_px):
            return SanitizeResult(
                content=None,
                dropped=True,
                error=f"[{label}] Image dimensions too large: {image.metadata.width}x{image.metadata.height}"
            )

        # 5. 验证 MIME 类型
        allowed_mimes = {"image/jpeg", "image/png", "image/gif", "image/webp"}
        if image.mime_type not in allowed_mimes:
            return SanitizeResult(
                content=None,
                dropped=True,
                error=f"[{label}] Unsupported MIME type: {image.mime_type}"
            )

        # 6. 生成 ImageContent
        return SanitizeResult(
            content=ImageContent(
                type="image",
                data=base64.b64encode(image.data).decode("utf-8"),
                mime_type=image.mime_type
            )
        )

    def sanitize_batch(
        self,
        images: list[ProcessedImage],
        label: str = ""
    ) -> tuple[list[ImageContent], int]:
        """
        批量清理验证图片

        Args:
            images: 图片列表
            label: 日志标签

        Returns:
            (有效图片内容列表, 丢弃数量)
        """
        valid: list[ImageContent] = []
        dropped = 0

        for i, image in enumerate(images):
            result = self.sanitize(image, f"{label}:{i}")
            if result.content:
                valid.append(result.content)
            if result.dropped:
                dropped += 1

        return valid, dropped


def sanitize_image(
    image: ProcessedImage,
    config: Optional[PipelineConfig] = None,
    label: str = ""
) -> SanitizeResult:
    """便捷函数: 清理验证图片"""
    sanitizer = ImageSanitizer(config)
    return sanitizer.sanitize(image, label)
```

---

## 12. Prompt 注入模块 (`injector.py`)

```python
"""
Prompt 注入模块

将处理后的图片注入到 LLM API 请求中
"""

from typing import Any, Union
from .types import ImageContent


class PromptInjector:
    """Prompt 图片注入器"""

    def inject_to_message(
        self,
        message: dict,
        images: list[ImageContent]
    ) -> dict:
        """
        将图片注入到单条消息中

        Args:
            message: 消息字典 {"role": "user", "content": "..."}
            images: 图片内容列表

        Returns:
            注入后的消息
        """
        if not images:
            return message

        content = message.get("content")

        # 已经是列表格式
        if isinstance(content, list):
            new_content = list(content)
            # 将图片添加到文本之后
            for img in images:
                new_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": img.mime_type,
                        "data": img.data
                    }
                })
            return {**message, "content": new_content}

        # 字符串格式 -> 转换为列表格式
        new_content: list[dict] = []

        if content:
            new_content.append({
                "type": "text",
                "text": str(content)
            })

        for img in images:
            new_content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.mime_type,
                    "data": img.data
                }
            })

        return {**message, "content": new_content}

    def inject_to_messages(
        self,
        messages: list[dict],
        prompt_images: list[ImageContent],
        history_images: dict[int, list[ImageContent]]
    ) -> list[dict]:
        """
        将图片注入到消息列表中

        Args:
            messages: 消息列表
            prompt_images: 当前 Prompt 的图片 (注入到最后一条用户消息)
            history_images: 历史消息的图片 {消息索引: 图片列表}

        Returns:
            注入后的消息列表
        """
        result = []

        for i, msg in enumerate(messages):
            # 注入历史图片
            if i in history_images:
                msg = self.inject_to_message(msg, history_images[i])
            result.append(msg)

        # 注入当前 Prompt 图片到最后一条用户消息
        if prompt_images:
            for i in range(len(result) - 1, -1, -1):
                if result[i].get("role") == "user":
                    result[i] = self.inject_to_message(result[i], prompt_images)
                    break

        return result

    def create_openai_format(
        self,
        text: str,
        images: list[ImageContent]
    ) -> list[dict]:
        """
        创建 OpenAI API 格式的内容

        Args:
            text: 文本内容
            images: 图片列表

        Returns:
            OpenAI 格式的 content 列表
        """
        content: list[dict] = []

        if text:
            content.append({
                "type": "text",
                "text": text
            })

        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:{img.mime_type};base64,{img.data}"
                }
            })

        return content

    def create_anthropic_format(
        self,
        text: str,
        images: list[ImageContent]
    ) -> list[dict]:
        """
        创建 Anthropic API 格式的内容

        Args:
            text: 文本内容
            images: 图片列表

        Returns:
            Anthropic 格式的 content 列表
        """
        content: list[dict] = []

        if text:
            content.append({
                "type": "text",
                "text": text
            })

        for img in images:
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.mime_type,
                    "data": img.data
                }
            })

        return content


# 全局注入器实例
_injector = PromptInjector()


def inject_images(
    messages: list[dict],
    prompt_images: list[ImageContent],
    history_images: dict[int, list[ImageContent]] = None
) -> list[dict]:
    """便捷函数: 注入图片"""
    return _injector.inject_to_messages(
        messages,
        prompt_images,
        history_images or {}
    )
```

---

## 13. 管线主入口 (`pipeline.py`)

```python
"""
图片处理管线主入口

整合所有模块, 提供统一的处理接口
"""

import asyncio
import logging
from typing import Optional

from .types import (
    DetectedImageRef,
    ProcessedImage,
    ImageContent,
    PipelineConfig,
    PipelineResult,
)
from .config import get_config, DEFAULT_CONFIG
from .detector import ImageReferenceDetector
from .loader import ImageLoader, ImageLoadError
from .converter import ImageConverter
from .optimizer import ImageOptimizer
from .sanitizer import ImageSanitizer


logger = logging.getLogger(__name__)


class ImagePipeline:
    """图片处理管线"""

    def __init__(self, config: Optional[PipelineConfig] = None):
        self.config = config or DEFAULT_CONFIG
        self.detector = ImageReferenceDetector(
            allow_remote=self.config.allow_remote_urls
        )
        self.loader = ImageLoader(self.config)
        self.converter = ImageConverter()
        self.optimizer = ImageOptimizer(self.config)
        self.sanitizer = ImageSanitizer(self.config)

    async def process(
        self,
        prompt: str,
        messages: Optional[list[dict]] = None,
        existing_images: Optional[list[ImageContent]] = None
    ) -> PipelineResult:
        """
        处理 Prompt 中的图片引用

        Args:
            prompt: 当前用户输入
            messages: 消息历史 (可选)
            existing_images: 已存在的图片 (如从附件解析)

        Returns:
            处理结果
        """
        result = PipelineResult(
            images=list(existing_images) if existing_images else [],
            history_images={},
            detected_refs=[]
        )

        # 1. 检测图片引用
        prompt_refs, history_refs = self.detector.detect_from_messages(
            messages or [],
            prompt
        )
        result.detected_refs = prompt_refs + history_refs

        if not result.detected_refs:
            return result

        logger.debug(
            f"Detected {len(prompt_refs)} refs in prompt, "
            f"{len(history_refs)} refs in history"
        )

        # 2. 处理当前 Prompt 的图片
        for ref in prompt_refs:
            content = await self._process_ref(ref, result)
            if content:
                result.images.append(content)
                result.loaded_count += 1
            else:
                result.skipped_count += 1

        # 3. 处理历史消息的图片
        for ref in history_refs:
            content = await self._process_ref(ref, result)
            if content and ref.message_index is not None:
                if ref.message_index not in result.history_images:
                    result.history_images[ref.message_index] = []
                result.history_images[ref.message_index].append(content)
                result.loaded_count += 1
            else:
                result.skipped_count += 1

        return result

    async def _process_ref(
        self,
        ref: DetectedImageRef,
        result: PipelineResult
    ) -> Optional[ImageContent]:
        """处理单个图片引用"""
        try:
            # 加载
            image = await self.loader.load(ref)
            logger.debug(f"Loaded: {ref.resolved} ({image.metadata.file_size} bytes)")

            # 转换 (如 HEIC -> JPEG)
            image = self.converter.ensure_compatible_format(
                image,
                preserve_alpha=self.config.preserve_alpha_as_png
            )

            # 优化 (尺寸/质量)
            if self.optimizer.needs_optimization(image):
                image = self.optimizer.optimize(image)
                logger.debug(
                    f"Optimized: {ref.resolved} -> "
                    f"{image.metadata.width}x{image.metadata.height}, "
                    f"{image.metadata.file_size} bytes"
                )

            # 清理验证
            sanitize_result = self.sanitizer.sanitize(image, ref.resolved)
            if sanitize_result.dropped:
                result.errors.append(sanitize_result.error or f"Dropped: {ref.resolved}")
                return None

            return sanitize_result.content

        except ImageLoadError as e:
            result.errors.append(f"Load error [{ref.resolved}]: {e}")
            logger.warning(f"Failed to load image: {ref.resolved} - {e}")
            return None

        except Exception as e:
            result.errors.append(f"Process error [{ref.resolved}]: {e}")
            logger.exception(f"Failed to process image: {ref.resolved}")
            return None

    def process_sync(
        self,
        prompt: str,
        messages: Optional[list[dict]] = None,
        existing_images: Optional[list[ImageContent]] = None
    ) -> PipelineResult:
        """同步版本的 process"""
        return asyncio.get_event_loop().run_until_complete(
            self.process(prompt, messages, existing_images)
        )


# 便捷函数
async def process_images(
    prompt: str,
    messages: Optional[list[dict]] = None,
    config: Optional[PipelineConfig] = None
) -> PipelineResult:
    """处理 Prompt 中的图片"""
    pipeline = ImagePipeline(config)
    return await pipeline.process(prompt, messages)


def process_images_sync(
    prompt: str,
    messages: Optional[list[dict]] = None,
    config: Optional[PipelineConfig] = None
) -> PipelineResult:
    """同步版本"""
    pipeline = ImagePipeline(config)
    return pipeline.process_sync(prompt, messages)
```

---

## 14. 使用示例

### 14.1 基本使用

```python
from image_pipeline import ImagePipeline, PipelineConfig, inject_images

# 创建管线
config = PipelineConfig(
    max_dimension_px=2000,
    max_bytes=5 * 1024 * 1024,
    sandbox_root="/path/to/workspace",  # 可选: 限制访问范围
)
pipeline = ImagePipeline(config)

# 用户输入
prompt = "请分析这张图片 /Users/me/photos/example.png 并描述内容"

# 消息历史
messages = [
    {"role": "user", "content": "之前的图片在 ~/old.jpg"},
    {"role": "assistant", "content": "好的,我看到了"}
]

# 处理图片
result = await pipeline.process(prompt, messages)

# 注入到消息中
messages_with_images = inject_images(
    messages + [{"role": "user", "content": prompt}],
    result.images,
    result.history_images
)

# 发送给 LLM API
response = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages_with_images
)
```

### 14.2 同步使用

```python
from image_pipeline import process_images_sync

result = process_images_sync(
    prompt="分析 ./screenshot.png",
    messages=[]
)

print(f"加载: {result.loaded_count}, 跳过: {result.skipped_count}")
if result.errors:
    print("错误:", result.errors)
```

### 14.3 自定义配置

```python
config = PipelineConfig(
    max_dimension_px=1024,     # 更小的尺寸限制
    max_bytes=2 * 1024 * 1024, # 2MB 限制
    resize_grid=[1024, 800, 600, 400],
    quality_grid=[90, 80, 70, 60],
    allow_remote_urls=True,    # 允许 HTTP URL
    preserve_alpha_as_png=False  # 总是转为 JPEG
)
```

---

## 15. 依赖项

```txt
# requirements.txt
pillow>=10.0.0
pillow-heif>=0.13.0  # HEIC 支持
aiofiles>=23.0.0     # 异步文件读取
httpx>=0.25.0        # 异步 HTTP (远程 URL)
```

---

## 16. 测试建议

```python
# tests/test_detector.py
import pytest
from image_pipeline.detector import detect_image_references

def test_detect_absolute_path():
    refs = detect_image_references("看这个 /path/to/image.png")
    assert len(refs) == 1
    assert refs[0].resolved == "/path/to/image.png"

def test_detect_home_path():
    refs = detect_image_references("图片在 ~/Pictures/photo.jpg")
    assert len(refs) == 1
    assert "Pictures/photo.jpg" in refs[0].resolved

def test_detect_media_attached():
    refs = detect_image_references("[media attached: /tmp/img.png (image/png) | url]")
    assert len(refs) == 1
    assert refs[0].resolved == "/tmp/img.png"

def test_skip_non_image():
    refs = detect_image_references("文档在 /path/to/doc.pdf")
    assert len(refs) == 0
```

---

## 17. 错误处理

| 错误类型 | 处理方式 |
|---------|---------|
| 文件不存在 | 记录错误, 跳过, 继续处理其他图片 |
| 格式不支持 | 尝试转换, 失败则跳过 |
| 尺寸/大小超限 | 自动优化, 失败则跳过 |
| 沙盒路径越界 | 拒绝加载, 记录安全警告 |
| 网络错误 (远程 URL) | 记录错误, 跳过 |

---

## 18. 性能优化建议

1. **并发加载**: 使用 `asyncio.gather` 并发加载多张图片
2. **缓存**: 对相同路径的图片进行缓存
3. **懒加载**: 只在需要时才读取文件内容
4. **流式处理**: 对大图片使用流式读取和处理

```python
# 并发加载示例
async def _process_refs_concurrent(self, refs: list[DetectedImageRef]):
    tasks = [self._process_ref(ref) for ref in refs]
    return await asyncio.gather(*tasks, return_exceptions=True)
```

---

## 附录: 数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 Prompt                              │
│  "分析这张图片 ~/photos/example.heic 和 ./screenshot.png"         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    detector.py (路径检测)                        │
│  输出: [                                                         │
│    DetectedImageRef(raw="~/photos/example.heic", resolved=...)  │
│    DetectedImageRef(raw="./screenshot.png", resolved=...)       │
│  ]                                                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    loader.py (文件加载)                          │
│  - 读取文件内容                                                   │
│  - 检测 MIME 类型 (mime.py)                                      │
│  - 获取元信息 (PIL)                                              │
│  输出: ProcessedImage(data=bytes, metadata=ImageMetadata)        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    converter.py (格式转换)                       │
│  - HEIC → JPEG                                                   │
│  - BMP/TIFF → PNG/JPEG                                          │
│  - 应用 EXIF 方向修正 (exif.py)                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    optimizer.py (尺寸/质量优化)                  │
│  - 尺寸网格: [2000, 1800, 1600, 1400, 1200, 1000, 800]          │
│  - 质量网格: [85, 75, 65, 55, 45, 35]                           │
│  - 目标: ≤2000px, ≤5MB                                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    sanitizer.py (清理验证)                       │
│  - 验证格式/尺寸/大小                                            │
│  - 生成 base64                                                   │
│  输出: ImageContent(type="image", data=base64, mime_type=...)   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    injector.py (Prompt 注入)                     │
│  - 注入到消息 content 列表                                       │
│  - 支持 OpenAI / Anthropic 格式                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         LLM API 请求                             │
│  {"role": "user", "content": [                                   │
│    {"type": "text", "text": "分析这张图片..."},                   │
│    {"type": "image", "source": {"type": "base64", ...}}         │
│  ]}                                                              │
└─────────────────────────────────────────────────────────────────┘
```
