from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

IMAGE_EXTS = {
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif",
}
VIDEO_EXTS = {
    "mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg",
}
AUDIO_EXTS = {
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "opus",
}
DOC_EXTS = {
    "md", "markdown", "mdx", "doc", "docx", "rtf", "odt", "xls", "xlsx", "csv", "tsv",
    "ods", "ppt", "pptx", "odp", "pdf", "txt", "html", "htm",
}
CODE_EXTS = {
    "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "h", "hpp", "go", "rs", "php",
    "rb", "sh", "bash", "zsh", "yaml", "yml", "xml", "sql", "ini", "conf", "env",
    "toml", "json", "css", "scss", "less", "vue", "svelte",
}

DEFAULT_METADATA_SIZE_LIMIT = 1_000_000_000  # 1GB
DEFAULT_METADATA_TIMEOUT = 2.5  # seconds


def classify_kind(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
    if ext in DOC_EXTS:
        return "document"
    if ext in CODE_EXTS:
        return "code"
    return "other"


def extract_metadata(path: Path, size_bytes: int, timeout: float = DEFAULT_METADATA_TIMEOUT,
                     size_limit: int = DEFAULT_METADATA_SIZE_LIMIT) -> dict[str, Any]:
    if size_limit and size_bytes > size_limit:
        return {}

    kind = classify_kind(path)
    if kind == "image":
        return _extract_image_metadata(path)
    if kind in ("video", "audio"):
        return _extract_media_metadata(path, timeout)
    return {}


def _extract_image_metadata(path: Path) -> dict[str, Any]:
    try:
        from PIL import Image
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except Exception:
            pass
    except Exception:
        return {}

    try:
        with Image.open(path) as img:
            width, height = img.size
            metadata: dict[str, Any] = {
                "width": width,
                "height": height,
            }

            exif = getattr(img, "getexif", None)
            if callable(exif):
                exif_data = img.getexif()
                if exif_data:
                    # Keep a small, useful subset to avoid bloating the DB.
                    tag_map = {}
                    try:
                        from PIL import ExifTags
                        tag_map = ExifTags.TAGS
                    except Exception:
                        tag_map = {}
                    keep_keys = {"DateTimeOriginal", "Model", "Make", "Orientation"}
                    for tag_id, value in exif_data.items():
                        name = tag_map.get(tag_id, str(tag_id))
                        if name in keep_keys:
                            metadata[name] = value
            return metadata
    except Exception:
        return {}


def _extract_media_metadata(path: Path, timeout: float) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception:
        return {}

    if result.returncode != 0:
        return {}

    try:
        data = json.loads(result.stdout)
    except Exception:
        return {}

    metadata: dict[str, Any] = {}
    fmt = data.get("format") or {}
    duration = fmt.get("duration")
    if duration is not None:
        try:
            metadata["duration"] = float(duration)
        except Exception:
            pass

    bit_rate = fmt.get("bit_rate")
    if bit_rate is not None:
        try:
            metadata["bit_rate"] = int(float(bit_rate))
        except Exception:
            pass

    streams = data.get("streams") or []
    for stream in streams:
        if stream.get("codec_type") == "video" and "video_codec" not in metadata:
            metadata["video_codec"] = stream.get("codec_name")
            if stream.get("width") is not None and stream.get("height") is not None:
                metadata["width"] = stream.get("width")
                metadata["height"] = stream.get("height")
            metadata["frame_rate"] = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
        if stream.get("codec_type") == "audio" and "audio_codec" not in metadata:
            metadata["audio_codec"] = stream.get("codec_name")
            if stream.get("channels") is not None:
                metadata["channels"] = stream.get("channels")
            if stream.get("sample_rate") is not None:
                metadata["sample_rate"] = stream.get("sample_rate")

    return metadata
