from __future__ import annotations

from dataclasses import dataclass

from backend.config import get_settings
from backend.rag.aliases import aliases_for_canonical
from backend.rag.normalization import normalize_drug_name
from backend.rag.topics import chunk_matches_topic, detect_topics
from backend.rag.types import RetrievedChunk

settings = get_settings()


@dataclass
class ConfidenceResult:
    score: float
    should_refuse_for_low_confidence: bool
    reasons: list[str]


def _owner_names(drug: str) -> set[str]:
    return {normalize_drug_name(drug), *aliases_for_canonical(drug)}


def _owned_by(chunk: RetrievedChunk, drug: str) -> bool:
    owner = normalize_drug_name(chunk.generic_name or "")
    return bool(owner) and owner in _owner_names(drug)


def score_retrieval_confidence(
    named_drugs: list[str],
    retrieved_chunks: list[RetrievedChunk],
    reranker_scores: list[float],
    question: str | None = None,
    intent: str | None = None,
) -> ConfidenceResult:
    reasons: list[str] = []
    drug_norms = [normalize_drug_name(d) for d in named_drugs]
    chunk_drug_sets = [set(normalize_drug_name(x) for x in chunk.named_drugs()) for chunk in retrieved_chunks]

    # Single-drug and patient-context answers require OWN-monograph evidence,
    # not a paragraph from another drug that happens to mention the target.
    strict_owner = intent in {"patient_context_query", "single_drug_info"} and len(named_drugs) == 1

    coverage: list[bool] = []
    for original, drug in zip(named_drugs, drug_norms):
        if strict_owner:
            present = any(_owned_by(chunk, original) for chunk in retrieved_chunks)
            if not present:
                present = any(
                    bool(chunk.metadata.get("profile_medication_match"))
                    and drug in names
                    for chunk, names in zip(retrieved_chunks, chunk_drug_sets)
                )
        else:
            present = any(drug in names for names in chunk_drug_sets)
        coverage.append(present)
        if not present:
            kind = "owned monograph evidence" if strict_owner else "retrieved evidence"
            reasons.append(f"No {kind} for named drug: {drug}")

    top_score = max(reranker_scores, default=0.0)
    deterministic_match = any(bool(c.metadata.get("deterministic_match")) for c in retrieved_chunks)
    # Exact owner/topic/profile lexical matches and exact DDInter rows are stronger
    # evidence than a model-specific reranker calibration. Never throw them away
    # merely because a cross-encoder score is below a global threshold.
    if retrieved_chunks and top_score < settings.reranker_threshold and not deterministic_match:
        reasons.append(f"Top reranker score {top_score:.3f} is below threshold {settings.reranker_threshold:.3f}")

    cooccurs = True
    if len(drug_norms) == 2:
        required = set(drug_norms)
        cooccurs = any(required.issubset(names) for names in chunk_drug_sets)
        if not cooccurs:
            reasons.append("No retrieved evidence contains both named drugs together")

    topic_match = True
    if question and intent in {"patient_context_query", "single_drug_info"}:
        topics = detect_topics(question, intent)
        if topics:
            if strict_owner and named_drugs:
                eligible = [c for c in retrieved_chunks if _owned_by(c, named_drugs[0])]
            else:
                eligible = retrieved_chunks
            topic_match = any(
                chunk_matches_topic(chunk.section, chunk.text, topic)
                for chunk in eligible
                for topic in topics
            )
            if not topic_match:
                reasons.append("No requested-drug evidence matches the safety topic asked about")

    coverage_score = sum(coverage) / max(1, len(coverage)) if drug_norms else 1.0
    score = 0.6 * coverage_score + 0.4 * min(1.0, top_score)
    if len(drug_norms) == 2 and not cooccurs:
        score = min(score, 0.49)
    if not topic_match:
        score = min(score, 0.49)

    should_refuse = bool(reasons) if drug_norms else (not retrieved_chunks)
    return ConfidenceResult(score=score, should_refuse_for_low_confidence=should_refuse, reasons=reasons)
