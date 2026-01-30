from __future__ import annotations

import re


_WORD_RE = re.compile(r"[A-Za-z0-9_]+")


def is_cjk_char(ch: str) -> bool:
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF  # CJK Unified Ideographs
        or 0x3400 <= code <= 0x4DBF  # CJK Unified Ideographs Extension A
        or 0x3040 <= code <= 0x309F  # Hiragana
        or 0x30A0 <= code <= 0x30FF  # Katakana
        or 0xAC00 <= code <= 0xD7AF  # Hangul Syllables
    )


def _cjk_ngrams(text: str) -> list[str]:
    if not text:
        return []
    if len(text) == 1:
        return [text]

    tokens: list[str] = []
    for n in (2, 3):
        if len(text) < n:
            continue
        for i in range(len(text) - n + 1):
            tokens.append(text[i : i + n])
    return tokens


def tokenize_text(text: str) -> list[str]:
    tokens: list[str] = []
    word_buf: list[str] = []
    cjk_buf: list[str] = []

    def flush_word() -> None:
        if word_buf:
            tokens.append("".join(word_buf).lower())
            word_buf.clear()

    def flush_cjk() -> None:
        if cjk_buf:
            tokens.extend(_cjk_ngrams("".join(cjk_buf)))
            cjk_buf.clear()

    for ch in text:
        if is_cjk_char(ch):
            flush_word()
            cjk_buf.append(ch)
        elif ch.isalnum() or ch == "_":
            flush_cjk()
            word_buf.append(ch)
        else:
            flush_word()
            flush_cjk()

    flush_word()
    flush_cjk()
    return tokens


def tokenize_for_fts(text: str) -> str:
    return " ".join(tokenize_text(text))


def tokenize_query(text: str) -> str:
    return tokenize_for_fts(text)
