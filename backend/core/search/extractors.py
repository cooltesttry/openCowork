from __future__ import annotations

import io
import logging
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

logger = logging.getLogger(__name__)


MARKITDOWN_EXTENSIONS = {".pdf", ".docx", ".pptx", ".xlsx", ".xls", ".html", ".htm"}


class ExtractionError(RuntimeError):
    pass


def _is_probably_binary(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            chunk = handle.read(4096)
    except OSError:
        return True

    if b"\x00" in chunk:
        return True
    return False


def _extract_with_markitdown(path: Path) -> str:
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise ExtractionError(
            "MarkItDown not installed. Run: pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'"
        ) from exc
    md = MarkItDown()
    try:
        if path.suffix.lower() == ".pdf":
            with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                result = md.convert(str(path))
        else:
            result = md.convert(str(path))
    except Exception as exc:
        message = str(exc)
        if "FontBBox" in message:
            logger.warning("PDF font metadata warning suppressed for %s", path)
            return ""
        raise
    return result.text_content


def extract_text(path: Path) -> str:
    if not path.exists() or not path.is_file():
        raise ExtractionError(f"File not found: {path}")

    ext = path.suffix.lower()
    if ext in MARKITDOWN_EXTENSIONS:
        return _extract_with_markitdown(path)

    if _is_probably_binary(path):
        raise ExtractionError(f"Binary file not supported: {path}")

    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise ExtractionError(f"Failed to read file: {path}") from exc
