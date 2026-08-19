from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RetrievedChunk:
    id: str
    text: str
    source_type: str
    source_title: str
    source_locator: str
    section: str = "General"
    generic_name: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    dense_score: float = 0.0
    sparse_score: float = 0.0
    rrf_score: float = 0.0
    reranker_score: float = 0.0

    def named_drugs(self) -> set[str]:
        values: set[str] = set()
        if self.generic_name:
            values.add(self.generic_name.casefold())
        for key in ("drug_a", "drug_b"):
            value = self.metadata.get(key)
            if value:
                values.add(str(value).casefold())
        for value in self.metadata.get("mentioned_drugs", []) or []:
            values.add(str(value).casefold())
        return values

    def to_citation(self) -> dict[str, str | int | None]:
        snippet = " ".join(self.text.split())[:420]
        # This is source relevance/grounding strength, not medical certainty.
        # Exact deterministic evidence (e.g. DDInter/openFDA fallback chunks) already
        # carries reranker_score=1.0; normal RAG chunks use the cross-encoder score.
        relevance_percentage = max(0, min(100, round(float(self.reranker_score) * 100)))
        return {
            "source_type": self.source_type,
            "source_title": self.source_title,
            "source_locator": self.source_locator,
            "section": self.section,
            "snippet": snippet,
            "relevance_percentage": relevance_percentage,
        }
