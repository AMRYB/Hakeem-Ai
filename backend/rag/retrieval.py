from __future__ import annotations

import itertools
import json
import re
from collections import defaultdict

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.models import DdiPair, RagChunk
from backend.rag.aliases import aliases_for_canonical
from backend.rag.normalization import canonical_pair, normalize_drug_name
from backend.rag.patient_context import detect_contexts, meaningful_profile_terms, meaningful_question_context_terms, text_matches_context
from backend.rag.reranker import get_reranker
from backend.rag.topics import chunk_matches_topic, detect_topics
from backend.rag.types import RetrievedChunk
from backend.rag.vector_store import get_vector_store

settings = get_settings()

# Evidence about the requested drug should come from that drug's own monograph
# whenever possible. Mention-only chunks are useful for DDI co-occurrence, but are
# unsafe as primary evidence for single-drug / patient-context questions.
_STRUCTURED_SOURCE_PRIORITY = {
    "eda_csv": 4,
    "eda_csv_raw": 3,
    "formulary_pdf": 2,
}


def _rag_model_to_chunk(model: RagChunk) -> RetrievedChunk:
    metadata = json.loads(model.metadata_json or "{}")
    locator = model.source_path + (f" — page {model.page_number}" if model.page_number else "")
    return RetrievedChunk(
        id=model.id,
        text=model.text,
        source_type=model.source_type,
        source_title=model.source_title,
        source_locator=locator,
        section=model.section,
        generic_name=model.generic_name,
        metadata=metadata,
    )


def ddi_pair_lookup(db: Session, drug_a: str, drug_b: str) -> RetrievedChunk | None:
    a, b = canonical_pair(drug_a, drug_b)
    row = db.scalar(select(DdiPair).where(and_(DdiPair.normalized_a == a, DdiPair.normalized_b == b)))
    if not row:
        return None
    text_value = f"{row.drug_a} and {row.drug_b}: {row.level} interaction risk."
    return RetrievedChunk(
        id=f"ddinter:{row.id}",
        text=text_value,
        source_type="ddinter",
        source_title=row.source_file,
        source_locator=f"{row.source_file} — row {row.source_row}",
        section="Pairwise interaction",
        metadata={
            "drug_a": row.drug_a,
            "drug_b": row.drug_b,
            "level": row.level,
            "ddinter_id_a": row.ddinter_id_a,
            "ddinter_id_b": row.ddinter_id_b,
            "mentioned_drugs": [row.drug_a, row.drug_b],
        },
        dense_score=1.0,
        sparse_score=1.0,
        rrf_score=10.0,
        reranker_score=1.0,
    )


def multi_pair_lookup(db: Session, drugs: list[str]) -> list[RetrievedChunk]:
    results: list[RetrievedChunk] = []
    for a, b in itertools.combinations(drugs, 2):
        hit = ddi_pair_lookup(db, a, b)
        if hit:
            results.append(hit)
    return results


def _search_names_for_drug(drug: str) -> list[str]:
    """Normalized canonical + configured aliases for a requested drug."""
    names = [normalize_drug_name(drug)] + aliases_for_canonical(drug)
    return list(dict.fromkeys(x for x in names if x))


def _owner_matches(chunk: RetrievedChunk, drug: str) -> bool:
    """True only when the chunk belongs to the requested drug monograph.

    This intentionally does NOT inspect chunk.text. A Ketoconazole chunk that
    merely mentions Felodipine must not become Felodipine pregnancy evidence.
    """
    owner = normalize_drug_name(chunk.generic_name or "")
    return bool(owner) and owner in set(_search_names_for_drug(drug))


def _owner_condition(drug: str):
    # Exact (case-insensitive) generic-name match only; no %wildcards% here.
    names = _search_names_for_drug(drug)
    return or_(*(RagChunk.generic_name.ilike(name) for name in names))


def _section_terms(question: str, intent: str) -> set[str]:
    topics = detect_topics(question, intent)
    terms: set[str] = set()

    if intent == "ddi_query":
        terms.update(("interaction", "contraindication"))
    elif intent == "patient_context_query":
        for topic in topics:
            terms.update(topic.section_keywords)
        if not terms:
            terms.update(("contraindication", "warning", "dosage adjustment", "monitoring"))
    elif intent == "single_drug_info":
        q = question.casefold()
        for topic in topics:
            terms.update(topic.section_keywords)
        if "side effect" in q or "adverse" in q or "reaction" in q:
            terms.update(("adverse", "warning"))
        elif "dose" in q or "dosage" in q or "how much" in q or "how often" in q:
            terms.update(("dosage regimen", "dosage adjustment", "administration"))
        elif "interaction" in q:
            terms.add("interaction")
        elif not terms:
            terms.update(("indication", "contraindication", "warning", "administration"))
    return terms


def _primary_owner_search(db: Session, question: str, drugs: list[str], intent: str, limit_per_drug: int = 40) -> list[RetrievedChunk]:
    """Fetch sections from the requested drug's own monograph before semantic search.

    For patient-context/specific-topic questions, unrelated sections are not used
    as a fallback. If the drug's own pregnancy/renal/etc evidence is absent, the
    caller can use FDA fallback or refuse rather than borrow another drug's page.
    """
    if not drugs:
        return []

    topics = detect_topics(question, intent)
    section_terms = _section_terms(question, intent)
    results: list[RetrievedChunk] = []

    for drug in drugs:
        owner_cond = _owner_condition(drug)
        query = select(RagChunk).where(owner_cond)
        if section_terms:
            section_cond = or_(*(RagChunk.section.ilike(f"%{term}%") for term in sorted(section_terms)))
            rows = db.scalars(query.where(section_cond).limit(limit_per_drug)).all()
        else:
            rows = db.scalars(query.limit(limit_per_drug)).all()

        chunks = [_rag_model_to_chunk(row) for row in rows]

        # Topic validation is stricter than section-name filtering. For example,
        # a generic Contraindications section is pregnancy evidence only if its
        # text actually discusses pregnancy, unless it is itself a Pregnancy section.
        if topics:
            chunks = [
                chunk for chunk in chunks
                if any(chunk_matches_topic(chunk.section, chunk.text, topic) for topic in topics)
            ]

        # Exact owner + exact requested topic is deterministic evidence.
        # A cross-encoder reranker is useful for ordering, but it must never turn
        # an exact structured match (e.g. Amikacin -> Monitoring Parameters or
        # Adverse Reactions) into a refusal merely because its model score is low.
        # This is generic and applies to every drug/topic, not to any named drug.
        if topics:
            for chunk in chunks:
                if _owner_matches(chunk, drug) and any(
                    chunk_matches_topic(chunk.section, chunk.text, topic)
                    for topic in topics
                ):
                    chunk.metadata["deterministic_match"] = True
                    chunk.metadata["owner_match"] = True
                    chunk.metadata["topic_match"] = True

        # Broad single-drug questions such as "what is felodipine?" may use any
        # owner section if the preferred overview sections were unavailable.
        if not chunks and intent == "single_drug_info" and not topics:
            rows = db.scalars(select(RagChunk).where(owner_cond).limit(limit_per_drug)).all()
            chunks = [_rag_model_to_chunk(row) for row in rows]

        results.extend(chunks)
    return results


def _sparse_search(db: Session, question: str, drugs: list[str], top_k: int, strict_owner: bool = False) -> list[RetrievedChunk]:
    terms = [
        t for t in re.findall(r"[A-Za-z0-9-]{3,}", question)
        if t.casefold() not in {"what", "with", "take", "about", "does", "have", "from", "this", "that"}
    ]
    conditions = []

    if strict_owner and drugs:
        # For patient-context/single-drug retrieval, search only within the
        # requested drug's monograph ownership metadata.
        conditions.extend(_owner_condition(drug) for drug in drugs)
    else:
        for drug in drugs:
            conditions.append(RagChunk.generic_name.ilike(drug))
            for name in _search_names_for_drug(drug):
                conditions.append(RagChunk.text.ilike(f"%{name}%"))
        for term in terms[:8]:
            conditions.append(RagChunk.text.ilike(f"%{term}%"))

    if not conditions:
        return []

    # strict_owner conditions must be ORed across requested owners, then lexical
    # relevance is scored in Python. This avoids allowing a text mention to bypass
    # owner filtering.
    rows = db.scalars(select(RagChunk).where(or_(*conditions)).limit(max(top_k * 6, top_k))).all()
    results: list[RetrievedChunk] = []
    qtokens = set(re.findall(r"[a-z0-9-]+", question.casefold()))
    for row in rows:
        chunk = _rag_model_to_chunk(row)
        tokens = set(re.findall(r"[a-z0-9-]+", row.text.casefold()))
        drug_bonus = 0.0
        for d in drugs:
            if _owner_matches(chunk, d):
                drug_bonus += 2.5
            elif not strict_owner:
                normalized_text = normalize_drug_name(row.text)
                if any(re.search(rf"(?<![\w-]){re.escape(alias)}(?![\w-])", normalized_text) for alias in _search_names_for_drug(d)):
                    drug_bonus += 1.0
        chunk.sparse_score = len(qtokens & tokens) / max(1, len(qtokens)) + drug_bonus
        results.append(chunk)
    return sorted(results, key=lambda c: c.sparse_score, reverse=True)[:top_k]


def _forced_sections(db: Session, drugs: list[str], question: str, intent: str) -> list[RetrievedChunk]:
    # Kept as a named helper for compatibility; now it is ownership-safe.
    return _primary_owner_search(db, question, drugs, intent)


def _rrf(lists: list[list[RetrievedChunk]], k: int = 60) -> list[RetrievedChunk]:
    scores: defaultdict[str, float] = defaultdict(float)
    objects: dict[str, RetrievedChunk] = {}
    for result_list in lists:
        for rank, chunk in enumerate(result_list, start=1):
            scores[chunk.id] += 1.0 / (k + rank)
            current = objects.get(chunk.id)
            if not current:
                objects[chunk.id] = chunk
            else:
                current.dense_score = max(current.dense_score, chunk.dense_score)
                current.sparse_score = max(current.sparse_score, chunk.sparse_score)
    for cid, score in scores.items():
        objects[cid].rrf_score = score
    return sorted(objects.values(), key=lambda c: c.rrf_score, reverse=True)


def _annotate_named_drugs(chunk: RetrievedChunk, drugs: list[str]) -> None:
    # This annotation is useful for DDI co-occurrence checks only. It must not be
    # treated as monograph ownership for patient-context/single-drug evidence.
    mentioned = list(chunk.metadata.get("mentioned_drugs", []) or [])
    haystack = normalize_drug_name(chunk.text)
    generic = normalize_drug_name(chunk.generic_name or "")
    for drug in drugs:
        canonical_norm = normalize_drug_name(drug)
        aliases = _search_names_for_drug(drug)
        present = generic == canonical_norm or any(
            re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", haystack)
            for name in aliases
        )
        if present and drug not in mentioned:
            mentioned.append(drug)
    if mentioned:
        chunk.metadata["mentioned_drugs"] = mentioned


def _strict_owner_filter(chunks: list[RetrievedChunk], drugs: list[str]) -> list[RetrievedChunk]:
    if not drugs:
        return chunks
    # single_drug_info / patient_context_query should normally contain one drug,
    # but this remains safe if history resolution gives more than one.
    return [chunk for chunk in chunks if any(_owner_matches(chunk, drug) for drug in drugs)]


def _topic_filter(chunks: list[RetrievedChunk], question: str, intent: str) -> list[RetrievedChunk]:
    topics = detect_topics(question, intent)
    if not topics:
        return chunks
    return [
        chunk for chunk in chunks
        if any(chunk_matches_topic(chunk.section, chunk.text, topic) for topic in topics)
    ]


def _normalize_evidence_text(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.casefold()))


def _deduplicate(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    """Remove duplicated EDA/PDF evidence while preferring structured monographs."""
    kept: list[RetrievedChunk] = []
    token_sets: list[set[str]] = []

    ordered = sorted(
        chunks,
        key=lambda c: (
            c.reranker_score,
            _STRUCTURED_SOURCE_PRIORITY.get(c.source_type, 1),
            c.rrf_score,
        ),
        reverse=True,
    )
    for chunk in ordered:
        tokens = _normalize_evidence_text(chunk.text)
        duplicate = False
        for existing, existing_tokens in zip(kept, token_sets):
            if normalize_drug_name(existing.generic_name or "") != normalize_drug_name(chunk.generic_name or ""):
                continue
            if (existing.section or "").casefold() != (chunk.section or "").casefold():
                continue
            if not tokens or not existing_tokens:
                continue
            overlap = len(tokens & existing_tokens) / max(1, min(len(tokens), len(existing_tokens)))
            if overlap >= 0.90:
                duplicate = True
                break
        if not duplicate:
            kept.append(chunk)
            token_sets.append(tokens)
    return kept


def _quality_sort(chunks: list[RetrievedChunk], question: str, intent: str, drugs: list[str]) -> list[RetrievedChunk]:
    topics = detect_topics(question, intent)

    def score(chunk: RetrievedChunk) -> tuple[float, float, float]:
        owner_bonus = 0.0
        if drugs and any(_owner_matches(chunk, drug) for drug in drugs):
            owner_bonus = 0.35
        topic_bonus = 0.0
        if topics and any(chunk_matches_topic(chunk.section, chunk.text, topic) for topic in topics):
            topic_bonus = 0.25
        source_bonus = 0.04 * _STRUCTURED_SOURCE_PRIORITY.get(chunk.source_type, 1)
        return (chunk.reranker_score + owner_bonus + topic_bonus + source_bonus, chunk.rrf_score, chunk.sparse_score)

    return sorted(chunks, key=score, reverse=True)



def retrieve_owned_patient_context(
    db: Session,
    question: str,
    drug: str,
    profile_context: str = "",
    profile_medications: list[str] | None = None,
) -> list[RetrievedChunk]:
    """Ownership-first retrieval for every one-drug patient-context question.

    General mechanism:
    1. Candidate ownership is a hard constraint: only the requested drug's own
       monograph chunks are eligible.
    2. Explicit context in the CURRENT question (pregnancy/renal/etc.) is a hard
       topic constraint.
    3. Saved profile context is a relevance signal, not a destructive filter. Any
       owner chunk that explicitly mentions a profile concept/term is force-included.
       This avoids the previous failure where a valid asthma contraindication was
       discarded by a reranker threshold.
    4. If profile text has no lexical/concept match locally, safety sections are
       still reranked, but are marked as not context-matched so the service can try
       FDA before deciding whether to refuse.
    """
    owner_cond = _owner_condition(drug)
    rows = db.scalars(select(RagChunk).where(owner_cond).limit(300)).all()
    owner_chunks = [_rag_model_to_chunk(row) for row in rows]
    if not owner_chunks:
        return []

    for chunk in owner_chunks:
        _annotate_named_drugs(chunk, [drug])

    # Explicit clinical context from the current user turn is authoritative. The
    # configurable context registry covers conditions beyond the old fixed topic
    # list (for example asthma) without adding drug-specific code.
    topics = detect_topics(question, "patient_context_query")
    explicit_contexts = detect_contexts(question, "question")
    explicit_fallback_terms = meaningful_question_context_terms(question, drug)
    if topics or explicit_contexts or explicit_fallback_terms:
        matched = []
        for chunk in owner_chunks:
            topic_hit = any(chunk_matches_topic(chunk.section, chunk.text, topic) for topic in topics) if topics else False
            context_hit = text_matches_context(f"{chunk.section}\n{chunk.text}", explicit_contexts, explicit_fallback_terms)
            if topic_hit or context_hit:
                chunk.metadata["context_match"] = True
                chunk.metadata["context_source"] = "question"
                chunk.metadata["context_keys"] = [c.key for c in explicit_contexts]
                chunk.metadata["deterministic_match"] = True
                matched.append(chunk)
        if not matched:
            return []
        reranked = get_reranker().rerank(question, matched[:100])
        reranked = _quality_sort(reranked, question, "patient_context_query", [drug])
        return _deduplicate(reranked)[: settings.final_top_k]

    preferred = (
        "contraindication", "warning", "precaution", "dosage adjustment",
        "monitoring", "adverse", "pregnancy", "lactation",
    )
    safety_chunks = [
        chunk for chunk in owner_chunks
        if any(term in (chunk.section or "").casefold() for term in preferred)
    ] or owner_chunks

    # Profile notes are parsed into configurable clinical concepts plus generic
    # fallback terms. Exact/concept matches are FORCE-INCLUDED before reranking.
    profile_contexts = detect_contexts(profile_context, "profile") if profile_context else []
    fallback_terms = meaningful_profile_terms(profile_context, profile_medications or []) if profile_context else []
    force_include: list[RetrievedChunk] = []
    if profile_context:
        for chunk in safety_chunks:
            haystack = f"{chunk.section}\n{chunk.text}"
            if text_matches_context(haystack, profile_contexts, fallback_terms):
                chunk.metadata["context_match"] = True
                chunk.metadata["context_source"] = "profile"
                chunk.metadata["context_keys"] = [c.key for c in profile_contexts]
                chunk.metadata["deterministic_match"] = True
                force_include.append(chunk)

    rerank_question = question
    if profile_context:
        rerank_question += "\nPatient profile context: " + profile_context

    reranked = get_reranker().rerank(rerank_question, safety_chunks[:120])
    reranked = _quality_sort(reranked, rerank_question, "patient_context_query", [drug])

    # Force deterministic context hits to the front regardless of cross-encoder
    # calibration, then add the best owner-only safety evidence.
    forced_ids = {c.id for c in force_include}
    forced_ranked = get_reranker().rerank(rerank_question, force_include) if force_include else []
    combined = forced_ranked + [c for c in reranked if c.id not in forced_ids]
    return _deduplicate(combined)[: settings.final_top_k]


def has_patient_context_match(chunks: list[RetrievedChunk]) -> bool:
    return any(bool(chunk.metadata.get("context_match")) for chunk in chunks)

def retrieve(db: Session, question: str, drugs: list[str], intent: str) -> list[RetrievedChunk]:
    direct: list[RetrievedChunk] = []
    if intent == "ddi_query" and len(drugs) == 2:
        pair = ddi_pair_lookup(db, drugs[0], drugs[1])
        if pair:
            direct.append(pair)
    elif intent == "multi_drug_query":
        direct.extend(multi_pair_lookup(db, drugs))

    strict_owner = bool(drugs) and intent in {"single_drug_info", "patient_context_query"}

    dense: list[RetrievedChunk] = []
    try:
        dense = get_vector_store().query(question, settings.dense_top_k)
    except Exception:
        dense = []
    if strict_owner:
        dense = _strict_owner_filter(dense, drugs)
        dense = _topic_filter(dense, question, intent)

    sparse = _sparse_search(db, question, drugs, settings.sparse_top_k, strict_owner=strict_owner)
    if strict_owner:
        sparse = _topic_filter(_strict_owner_filter(sparse, drugs), question, intent)

    forced = _forced_sections(db, drugs, question, intent)

    candidates = _rrf([direct, forced, dense, sparse])
    for chunk in candidates:
        _annotate_named_drugs(chunk, drugs)

    if strict_owner:
        # Hard rule: own-monograph evidence only. An incidental mention in another
        # drug's page can never answer pregnancy/renal/dose/single-drug questions.
        candidates = _strict_owner_filter(candidates, drugs)
        candidates = _topic_filter(candidates, question, intent)

    rerankable = [c for c in candidates if c.source_type != "ddinter"][:40]
    reranked = get_reranker().rerank(question, rerankable)
    reranked = _quality_sort(reranked, question, intent, drugs)
    reranked = _deduplicate(reranked)

    direct_ids = {c.id for c in direct}
    combined = direct + [c for c in reranked if c.id not in direct_ids]
    return combined[: settings.final_top_k]
