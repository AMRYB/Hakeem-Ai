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

    def _display_relevance_percentage(self) -> int:
        """Return a UI-friendly evidence-match score.

        IMPORTANT:
        - This is NOT medical certainty and does not affect retrieval/refusal logic.
        - The raw cross-encoder reranker score is not a calibrated probability, so
          showing `reranker_score * 100` can be misleading (for example, a valid
          source with reranker_score=0.33 looking like only "33% confident").
        - This display score keeps the existing reranker signal, but also reflects
          deterministic evidence flags and source quality already used by the RAG.

        The real raw reranker_score remains unchanged everywhere else.
        """
        raw = max(0.0, min(1.0, float(self.reranker_score or 0.0)))

        # Exact structured evidence is deterministic in this project.
        if self.source_type == "ddinter":
            return 100

        # openFDA fallback chunks are created with reranker_score=1.0 when they are
        # directly returned from the official label/event API.
        if self.source_type in {"openfda_label", "openfda_event"} and raw >= 0.999:
            return 100

        # The RAG's configured acceptance threshold is 0.15.  Map the model-specific
        # cross-encoder score into a human-friendly evidence-match range without
        # changing the underlying score or any hard gate.
        threshold = 0.15
        if raw < threshold:
            # Below the normal retrieval threshold: keep the display clearly low.
            score = 40.0 + (raw / threshold) * 20.0 if threshold > 0 else 40.0
        else:
            # Accepted reranker evidence maps from ~65% at threshold to ~90% at 1.0.
            score = 65.0 + ((raw - threshold) / (1.0 - threshold)) * 25.0

        # Reflect signals that the retrieval pipeline already uses when ranking
        # evidence. These are presentation bonuses only.
        source_bonus = {
            "eda_csv": 5.0,
            "eda_csv_raw": 3.0,
            "formulary_pdf": 2.0,
        }.get(self.source_type, 0.0)
        score += source_bonus

        if self.metadata.get("owner_match"):
            score += 5.0
        if self.metadata.get("topic_match"):
            score += 5.0
        if self.metadata.get("context_match"):
            score += 5.0

        # Exact owner/topic/context matches are explicitly treated as deterministic
        # evidence by the retrieval/confidence code, regardless of cross-encoder
        # calibration. Mirror that strength in the display score.
        if self.metadata.get("deterministic_match"):
            score = max(score, 95.0)

        # Reserve 100% for exact DDInter / direct openFDA evidence above.
        return max(0, min(99, round(score)))

    def to_citation(self) -> dict[str, str | int | None]:
        snippet = " ".join(self.text.split())[:420]
        return {
            "source_type": self.source_type,
            "source_title": self.source_title,
            "source_locator": self.source_locator,
            "section": self.section,
            "snippet": snippet,
            "relevance_percentage": self._display_relevance_percentage(),
        }
