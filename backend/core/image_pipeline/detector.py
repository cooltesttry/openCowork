"""
Image Reference Detector

Supported patterns:
1. Absolute paths: /path/to/image.png
2. Relative paths: ./image.png, ../images/photo.jpg
3. Home paths: ~/Pictures/screenshot.png
4. file:// URLs: file:///path/to/image.png
5. Media attached format: [media attached: path (type) | url]
"""

import re
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from .types import DetectedImageRef, RefType


# Supported image extensions
IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".bmp", ".tiff", ".tif", ".heic", ".heif"
}

# Image extension regex pattern
IMAGE_EXT_PATTERN = r"\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|heif)"


class ImageReferenceDetector:
    """Image reference detector"""

    def __init__(self, allow_remote: bool = False):
        self.allow_remote = allow_remote
        self._compile_patterns()

    def _compile_patterns(self):
        """Compile regex patterns"""
        # Media attached format: [media attached: path (type) | url]
        self.media_attached_pattern = re.compile(
            r"\[media attached(?:\s+\d+/\d+)?:\s*([^\]]+)\]",
            re.IGNORECASE
        )

        # file:// URL
        self.file_url_pattern = re.compile(
            rf"file://[^\s<>\"'`\]]+{IMAGE_EXT_PATTERN}",
            re.IGNORECASE
        )

        # Local path (absolute, relative, home)
        self.local_path_pattern = re.compile(
            rf"(?:^|\s|[\"'`(])((?:\.\.?/|[~/])[^\s\"'`()\[\]]*{IMAGE_EXT_PATTERN})",
            re.IGNORECASE
        )

        # HTTP(S) URL
        self.http_url_pattern = re.compile(
            rf"https?://[^\s<>\"'`\]]+{IMAGE_EXT_PATTERN}",
            re.IGNORECASE
        )

        # Path extraction from media attached content
        self.path_extract_pattern = re.compile(
            rf"^\s*(.+?{IMAGE_EXT_PATTERN})\s*(?:\(|$|\|)",
            re.IGNORECASE
        )

    def detect(self, text: str) -> list[DetectedImageRef]:
        """
        Detect image references in text

        Args:
            text: User input text

        Returns:
            List of detected image references
        """
        refs: list[DetectedImageRef] = []
        seen: set[str] = set()

        def add_path_ref(raw: str) -> None:
            """Add path reference"""
            trimmed = raw.strip()
            if not trimmed:
                return

            # Skip HTTP URLs unless explicitly allowed
            if trimmed.startswith(("http://", "https://")):
                if not self.allow_remote:
                    return

            # Check extension
            if not self._is_image_extension(trimmed):
                return

            # Dedupe
            key = trimmed.lower()
            if key in seen:
                return
            seen.add(key)

            # Resolve path
            resolved = self._resolve_path(trimmed)
            refs.append(DetectedImageRef(
                raw=trimmed,
                ref_type=RefType.PATH,
                resolved=resolved
            ))

        # 0. Parse "Attached files:" section (one file per line)
        # This is the most reliable format for paths with spaces
        attached_match = re.search(r'Attached files:\s*\n((?:.+\n?)+)', text, re.IGNORECASE)
        if attached_match:
            lines = attached_match.group(1).strip().split('\n')
            for line in lines:
                line = line.strip()
                if line and not line.startswith('Attached files'):
                    add_path_ref(line)

        # 1. Parse [media attached: ...] format
        for match in self.media_attached_pattern.finditer(text):
            content = match.group(1)
            # Skip "N files" summary lines
            if re.match(r"^\d+\s+files?$", content.strip(), re.IGNORECASE):
                continue
            # Extract path
            path_match = self.path_extract_pattern.match(content)
            if path_match:
                add_path_ref(path_match.group(1))

        # 2. Parse file:// URLs
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

        # 3. Parse local paths (fallback for inline paths)
        for match in self.local_path_pattern.finditer(text):
            add_path_ref(match.group(1))

        # 4. Parse HTTP URLs (if allowed)
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

    def remove_refs_from_text(self, text: str, refs: list[DetectedImageRef]) -> str:
        """
        Remove detected image references from text, preserving non-image files.
        
        Output format:
        1. Non-image attached files (if any)
        2. Embedded image paths section (so model knows the file paths for tool calls)
        """
        result = text
        
        # Build set of resolved paths to remove
        paths_to_remove = {ref.raw for ref in refs}
        paths_to_remove.update(ref.resolved for ref in refs)
        
        # Collect embedded image paths in order (use resolved paths)
        embedded_image_paths = [ref.resolved for ref in refs]
        
        # Handle "Attached files:" section - separate images from non-images
        attached_match = re.search(r'(\n*)Attached files:\s*\n((?:.+\n?)+)', result, re.IGNORECASE)
        if attached_match:
            prefix_newlines = attached_match.group(1)
            lines = attached_match.group(2).strip().split('\n')
            non_image_lines = []
            
            for line in lines:
                line_stripped = line.strip()
                # Keep non-image files
                if line_stripped and line_stripped not in paths_to_remove:
                    non_image_lines.append(line_stripped)
            
            # Build new section: non-images first, then embedded image paths
            new_sections = []
            
            if non_image_lines:
                new_sections.append("Attached files:\n" + "\n".join(non_image_lines))
            
            if embedded_image_paths:
                new_sections.append(
                    "Embedded image paths (already injected as base64, use these paths for image tools):\n" + 
                    "\n".join(embedded_image_paths)
                )
            
            if new_sections:
                new_content = f"{prefix_newlines}" + "\n\n".join(new_sections)
                result = result[:attached_match.start()] + new_content + result[attached_match.end():]
            else:
                result = result[:attached_match.start()] + result[attached_match.end():]
        else:
            # No "Attached files:" section, but we have image refs to note
            if embedded_image_paths:
                embedded_section = (
                    "\n\nEmbedded image paths (already injected as base64, use these paths for image tools):\n" + 
                    "\n".join(embedded_image_paths)
                )
                result = result + embedded_section
        
        # Remove [media attached: ...] blocks
        result = self.media_attached_pattern.sub("", result)
        
        # Remove individual inline paths (but keep the embedded section we just added)
        # Only remove refs that appear OUTSIDE the embedded section
        for ref in refs:
            # Don't remove from embedded section - use negative lookahead approach
            # Simple approach: only replace occurrences before the embedded section marker
            parts = result.split("Embedded image paths")
            if len(parts) == 2:
                parts[0] = parts[0].replace(ref.raw, "")
                result = "Embedded image paths".join(parts)
            else:
                result = result.replace(ref.raw, "")
        
        # Clean up whitespace
        result = re.sub(r"\n\s*\n\s*\n", "\n\n", result)
        return result.strip()

    def _is_image_extension(self, path: str) -> bool:
        """Check if path has image extension"""
        path_lower = path.lower()
        return any(path_lower.endswith(ext) for ext in IMAGE_EXTENSIONS)

    def _resolve_path(self, raw: str) -> str:
        """Resolve path (expand ~, normalize)"""
        try:
            path = Path(raw).expanduser()
            return str(path.resolve()) if path.is_absolute() else str(path)
        except Exception:
            return raw
