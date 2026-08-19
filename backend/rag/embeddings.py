from __future__ import annotations

from functools import lru_cache
from typing import Sequence

import httpx
import numpy as np

from backend.config import get_settings

settings = get_settings()


class EmbeddingProvider:
    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        raise NotImplementedError


class OllamaEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        self.base = settings.ollama_base_url.rstrip("/")
        self.model = settings.embedding_model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        headers = {"Content-Type": "application/json"}
        if settings.ollama_api_key:
            headers["Authorization"] = f"Bearer {settings.ollama_api_key}"
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(
                f"{self.base}/api/embed",
                headers=headers,
                json={"model": self.model, "input": list(texts)},
            )
            response.raise_for_status()
            return response.json()["embeddings"]


class OpenAIEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        self.base = settings.openai_api_base.rstrip("/")
        self.model = settings.openai_embedding_model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")

        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(
                f"{self.base}/embeddings",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": self.model, "input": list(texts)},
            )
            response.raise_for_status()
            rows = response.json().get("data") or []
            rows = sorted(rows, key=lambda row: int(row.get("index", 0)))
            vectors = [row.get("embedding") for row in rows]
            if len(vectors) != len(texts) or any(not isinstance(vector, list) for vector in vectors):
                raise RuntimeError("OpenAI embeddings response was incomplete")
            return [[float(value) for value in vector] for vector in vectors]


class SentenceTransformerEmbeddingProvider(EmbeddingProvider):
    def __init__(self):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(settings.embedding_model)

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        vectors = self.model.encode(
            list(texts),
            batch_size=settings.embedding_batch_size,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=float).tolist()


@lru_cache(maxsize=1)
def get_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_provider == "ollama":
        return OllamaEmbeddingProvider()
    if settings.embedding_provider == "openai":
        return OpenAIEmbeddingProvider()
    if settings.embedding_provider == "sentence_transformers":
        return SentenceTransformerEmbeddingProvider()
    raise RuntimeError(f"Unsupported EMBEDDING_PROVIDER={settings.embedding_provider}")
