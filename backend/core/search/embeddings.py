from __future__ import annotations

from typing import Iterable

import requests

from core.search.paths import default_embedding_server_url


class EmbeddingProvider:
    def __init__(self, server_url: str | None = None):
        self.server_url = server_url or default_embedding_server_url()

    @staticmethod
    def format_query(query: str) -> str:
        return f"task: search result | query: {query}"

    @staticmethod
    def format_document(text: str, title: str | None = None) -> str:
        title_text = title or "none"
        return f"title: {title_text} | text: {text}"

    def is_available(self) -> bool:
        return self._probe_server()

    def _probe_server(self) -> bool:
        for endpoint in ("/health", "/v1/models"):
            try:
                resp = requests.get(f"{self.server_url}{endpoint}", timeout=0.5)
                if resp.ok:
                    return True
            except requests.RequestException:
                continue
        return False

    def embed_texts(self, texts: Iterable[str]) -> list[list[float]]:
        payload = list(texts)
        if not payload:
            return []
        resp = requests.post(
            f"{self.server_url}/v1/embeddings",
            json={"model": "embeddinggemma", "input": payload},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data.get("data", [])]
