from __future__ import annotations

from pathlib import Path
from typing import Iterable

import requests

from core.search.paths import default_embedding_server_url


class EmbeddingProvider:
    def __init__(self, model_path: Path, server_url: str | None = None):
        self.model_path = Path(model_path)
        self.server_url = server_url or default_embedding_server_url()
        self._model = None

    @staticmethod
    def format_query(query: str) -> str:
        return f"task: search result | query: {query}"

    @staticmethod
    def format_document(text: str, title: str | None = None) -> str:
        title_text = title or "none"
        return f"title: {title_text} | text: {text}"

    def is_available(self) -> bool:
        if self.server_url:
            return self._probe_server()
        return self.model_path.exists()

    def _probe_server(self) -> bool:
        for endpoint in ("/health", "/v1/models"):
            try:
                resp = requests.get(f"{self.server_url}{endpoint}", timeout=0.5)
                if resp.ok:
                    return True
            except requests.RequestException:
                continue
        return False

    def _load(self) -> None:
        if self._model is not None:
            return
        if self.server_url:
            return
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise RuntimeError(
                "llama-cpp-python not installed. Run: pip install llama-cpp-python"
            ) from exc

        if not self.model_path.exists():
            raise RuntimeError(f"Embedding model not found: {self.model_path}")

        self._model = Llama(model_path=str(self.model_path), embedding=True)

    def _embed_http(self, texts: list[str]) -> list[list[float]]:
        payload = {"model": "embeddinggemma", "input": texts}
        resp = requests.post(
            f"{self.server_url}/v1/embeddings",
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        return [item["embedding"] for item in data.get("data", [])]

    def embed_texts(self, texts: Iterable[str]) -> list[list[float]]:
        payload = list(texts)
        if not payload:
            return []
        if self.server_url:
            return self._embed_http(payload)

        self._load()
        result = self._model.create_embedding(payload)
        return [item["embedding"] for item in result.get("data", [])]
