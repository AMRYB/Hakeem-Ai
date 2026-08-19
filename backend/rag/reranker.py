from __future__ import annotations

import math
import re
from functools import lru_cache

from backend.config import get_settings
from backend.rag.types import RetrievedChunk

settings = get_settings()


def _token_overlap(question: str, text: str) -> float:
    q = set(re.findall(r"[a-z0-9-]+", question.casefold()))
    t = set(re.findall(r"[a-z0-9-]+", text.casefold()))
    if not q:
        return 0.0
    return len(q & t) / len(q)


class Reranker:
    def __init__(self):
        self.model = None
        if settings.reranker_enabled:
            try:
                from sentence_transformers import CrossEncoder

                self.model = CrossEncoder(settings.reranker_model)
            except Exception:
                self.model = None

    def rerank(self, question: str, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        if not chunks:
            return []
        if self.model is None:
            for chunk in chunks:
                chunk.reranker_score = _token_overlap(question, chunk.text)
        else:
            raw_scores = self.model.predict([(question, c.text) for c in chunks])
            for chunk, raw in zip(chunks, raw_scores):
                value = float(raw)
                chunk.reranker_score = 1.0 / (1.0 + math.exp(-max(-20.0, min(20.0, value))))
        return sorted(chunks, key=lambda c: c.reranker_score, reverse=True)


@lru_cache(maxsize=1)
def get_reranker() -> Reranker:
    return Reranker()
