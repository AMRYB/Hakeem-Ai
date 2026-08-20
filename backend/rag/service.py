from __future__ import annotations

import itertools
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from backend.models import UserProfile
from backend.rag.confidence import score_retrieval_confidence
from backend.rag.drug_names import extract_drugs
from backend.rag.fda import FDAClient, label_mentions
from backend.rag.intent import detect_intent
from backend.rag.llm import get_llm
from backend.rag.normalization import normalize_drug_name
from backend.rag.prompts import REFUSAL, build_prompt
from backend.rag.retrieval import ddi_pair_lookup, retrieve, retrieve_owned_patient_context, has_patient_context_match
from backend.rag.safety import detect_safety_signal, urgent_response
from backend.rag.topics import chunk_matches_topic, detect_topics
from backend.rag.patient_context import detect_contexts, meaningful_profile_terms, text_matches_context
from backend.rag.profile_personalization import read_profile_snapshot
from backend.rag.types import RetrievedChunk
from backend.security import decrypt_text


@dataclass
class AnswerResult:
    answer: str
    citations: list[dict]
    route: str


OUT_OF_SCOPE = (
    "This assistant is designed specifically for medication safety and drug-interaction questions. "
    "Please ask about a medication, drug interaction, side effect, contraindication, dose, warning, "
    "pregnancy/medication safety, or another medication-safety topic."
)

_MEDICATION_DOMAIN_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bdrug(?:s)?\b",
        r"\bmedicine(?:s)?\b",
        r"\bmedication(?:s)?\b",
        r"\bprescription(?:s)?\b",
        r"\bdrug[- ]?drug interaction(?:s)?\b",
        r"\binteraction(?:s)?\s+(?:between|with|of)\b",
        r"\bside effect(?:s)?\b",
        r"\badverse (?:effect|effects|reaction|reactions|event|events)\b",
        r"\bcontraindicat(?:e|ed|ion|ions)\b",
        r"\bdos(?:e|es|age|ages|ing)\b",
        r"\btablet(?:s)?\b",
        r"\bcapsule(?:s)?\b",
        r"\binjection(?:s)?\b",
        r"\bpharmac(?:ology|ologic|ological|okinetic|odynamic)\b",
        r"\bformulary\b",
        r"\bdrug label\b",
        r"\bmedication safety\b",
        r"\bdrug safety\b",
    )
)

_FOLLOWUP_ONLY_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^\s*(?:and\s+)?(?:what|how)\s+about\s+(?:it|this|that)(?:\s+too)?[?.!]*\s*$",
        r"^\s*(?:and\s+)?(?:with\s+)?(?:it|this|that)(?:\s+too)?[?.!]*\s*$",
        r"^\s*(?:and\s+)?(?:is|does|can)\s+(?:it|this|that)\b[^A-Za-z0-9]{0,3}[?.!]*\s*$",
    )
)

_PERSONAL_SUITABILITY_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bcan\s+i\s+(?:take|use|start|have)\b",
        r"\bshould\s+i\s+(?:take|use|start)\b",
        r"\bis\s+.+?\s+safe\s+for\s+me\b",
        r"\bis\s+.+?\s+(?:okay|ok|suitable)\s+for\s+me\b",
        r"\bwith\s+my\s+(?:condition|conditions|history|medications|medicine|allergy|allergies)\b",
    )
)

_TRUE_FOLLOWUP_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^\s*(?:and\s+)?(?:what|how)\s+about\b",
        r"^\s*and\b",
        r"^\s*with\s+[^?.!]+[?.!]*\s*$",
        r"\b(?:it|this|that|them|those)\b",
        r"\b(?:too|also)\b",
    )
)


def _is_medication_domain_query(question: str, extraction, has_history: bool) -> bool:
    if extraction.drugs or extraction.unknown_candidates:
        return True
    if any(pattern.search(question) for pattern in _MEDICATION_DOMAIN_PATTERNS):
        return True
    if has_history and any(pattern.match(question) for pattern in _FOLLOWUP_ONLY_PATTERNS):
        return True
    return False


def _needs_history_resolution(question: str) -> bool:
    return any(pattern.search(question) for pattern in _TRUE_FOLLOWUP_PATTERNS)


def _history_context(history: list[tuple[str, str]], question: str) -> str:
    """Resolve medication and clinical-topic context for short additive follow-ups.

    Examples:
    - "Warfarin + Aspirin" -> "What about ibuprofen too?"
      keeps the active multi-drug set.
    - "Can a pregnant woman take aspirin?" -> "What about ibuprofen too?"
      keeps *pregnancy* as the clinical topic without turning aspirin + ibuprofen
      into a fake DDI question.
    - Drugless/out-of-scope interruptions are skipped.
    """
    if not history or not _needs_history_resolution(question):
        return question

    current = extract_drugs(question).drugs
    if len(current) >= 2:
        return question

    previous_drugs: list[str] = []
    inherited_topics: list[str] = []
    inherited_contexts: list[str] = []

    for user_q, _assistant_a in reversed(history[-6:]):
        historical_drugs = extract_drugs(user_q).drugs

        # Skip drugless turns (including the prompt-injection/out-of-scope example)
        # so they do not erase the last valid medication context.
        if not historical_drugs:
            continue

        # If this historical turn carries a clinical topic/context, inherit the
        # topic for the NEW drug, but do not automatically inherit the old drug.
        topics = detect_topics(user_q)
        contexts = detect_contexts(user_q, "question")
        if topics or contexts:
            inherited_topics.extend(topic.name for topic in topics)
            inherited_contexts.extend(context.key for context in contexts)
            break

        # Explicit two-or-more-drug turn is the base of an active DDI thread.
        if len(historical_drugs) >= 2:
            previous_drugs.extend(historical_drugs)
            break

        # One-drug additive follow-up belongs to the same DDI chain; keep walking
        # backward until the explicit multi-drug base is found.
        if _needs_history_resolution(user_q):
            previous_drugs.extend(historical_drugs)
            continue

        # A normal standalone one-drug turn with no clinical topic is a boundary.
        break

    merged: list[str] = []
    seen: set[str] = set()
    for drug in current + previous_drugs:
        norm = normalize_drug_name(drug)
        if norm and norm not in seen:
            merged.append(drug)
            seen.add(norm)

    resolved = question

    # Multi-drug context: preserve all unique drugs for pairwise interaction routing.
    if len(merged) >= 2:
        resolved += "\nResolved medication context: " + ", ".join(merged)

    # Topic/context memory: carry only the concept (e.g. pregnancy/monitoring),
    # not the previous drug name, so "what about ibuprofen?" after a pregnancy
    # question becomes an ibuprofen pregnancy query rather than aspirin+ibuprofen DDI.
    clinical_labels = list(dict.fromkeys(inherited_topics + inherited_contexts))
    if clinical_labels:
        resolved += "\nResolved clinical context: " + ", ".join(clinical_labels)

    return resolved


def _is_personal_suitability_query(question: str) -> bool:
    return any(pattern.search(question) for pattern in _PERSONAL_SUITABILITY_PATTERNS)


def _has_explicit_patient_context_language(question: str) -> bool:
    q = question.casefold()
    patterns = (
        r"\bif\s+i\s+(?:have|am|had)\b",
        r"\bi\s+have\b",
        r"\bwith\s+my\b",
        r"\bhistory\s+of\b",
        r"\b(?:patient|person|woman|man|child)\s+with\b",
        r"\bdiagnosed\s+with\b",
        r"\bsuffering\s+from\b",
    )
    return any(re.search(pattern, q) for pattern in patterns)


def _profile_values(profile: UserProfile | None) -> tuple[str, str]:
    if not profile:
        return "", ""
    notes = (decrypt_text(profile.encrypted_health_notes) or "").strip()
    age = (decrypt_text(profile.encrypted_age) or "").strip()
    return notes, age


def _age_context(age: str) -> str:
    try:
        years = int(float(age))
    except Exception:
        return ""
    if years < 18:
        return f"pediatric patient, age {years}"
    if years >= 65:
        return f"older adult, age {years}"
    return ""


_PROFILE_CONTEXT_STOPWORDS = {
    "health", "notes", "supplied", "user", "patient", "have", "has",
    "with", "and", "the", "that", "this", "condition", "conditions",
    "disease", "diseases", "history", "medical", "current", "currently",
    "take", "taking", "medication", "medications", "medicine", "medicines",
    "allergy", "allergies", "none", "no",
}


def _references_user(question: str) -> bool:
    q = question.casefold()
    return bool(re.search(r"\b(?:i|me|my|mine|myself)\b", q))


def _inherits_personal_profile_scope(history: list[tuple[str, str]], question: str) -> bool:
    """Keep saved-profile relevance across a genuine personal follow-up only.

    Example:
      "Can I take aspirin?" -> "What about ibuprofen?"

    Third-person questions such as "Can a pregnant woman take aspirin?" do not
    inherit the logged-in user's saved profile.
    """
    if not history or not _needs_history_resolution(question):
        return False

    for user_q, _assistant_a in reversed(history[-6:]):
        historical_drugs = extract_drugs(user_q).drugs
        if not historical_drugs:
            continue
        return _is_personal_suitability_query(user_q) or _references_user(user_q)

    return False


def _profile_context_tokens(profile_context: str) -> list[str]:
    if not profile_context:
        return []
    raw = profile_context.split(":", 1)[-1]
    tokens = [t.casefold() for t in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", raw)]
    return list(dict.fromkeys(t for t in tokens if t not in _PROFILE_CONTEXT_STOPWORDS))


def _chunks_matching_profile_context(chunks: list[RetrievedChunk], profile_context: str) -> list[RetrievedChunk]:
    tokens = _profile_context_tokens(profile_context)
    if not tokens:
        return chunks
    matched: list[RetrievedChunk] = []
    for chunk in chunks:
        haystack = f"{chunk.section} {chunk.text}".casefold()
        if any(token in haystack for token in tokens):
            matched.append(chunk)
    return matched


def _relevant_profile(profile: UserProfile | None, question: str, *, personal_suitability: bool = False) -> str:
    if not profile:
        return ""
    q = question.casefold()
    parts: list[str] = []
    notes, age = _profile_values(profile)
    personal_reference = personal_suitability or _references_user(question)
    if notes and personal_reference:
        parts.append(f"Health notes supplied by user: {notes}")
    if age and personal_reference and any(term in q for term in ("age", "dose", "child", "elderly", "years old", "how much")):
        parts.append(f"Age supplied by user: {age}")
    return "\n".join(parts)


def _augment_retrieval_with_profile(question: str, profile_context: str) -> str:
    if not profile_context:
        return question
    return (
        question
        + "\nUser-provided health context to match against this drug's contraindications, "
          "warnings, precautions, and dose-adjustment guidance: "
        + profile_context
    )


def _fda_fallback(question: str, local_drugs: list[str], unknown_candidates: list[str]) -> list[RetrievedChunk]:
    client = FDAClient()
    chunks: list[RetrievedChunk] = []
    targets = list(dict.fromkeys(local_drugs + unknown_candidates))
    labels: dict[str, list[RetrievedChunk]] = {}
    for drug in targets:
        try:
            result = client.fetch_label(drug)
        except Exception:
            result = None
        if result:
            labels[drug] = result.chunks

    if len(targets) == 2:
        a, b = targets
        for source_drug, other in ((a, b), (b, a)):
            candidate_chunks = labels.get(source_drug, [])
            if label_mentions(candidate_chunks, other):
                for chunk in candidate_chunks:
                    if "interaction" in chunk.section.casefold() and other.casefold() in chunk.text.casefold():
                        chunk.metadata["mentioned_drugs"] = [a, b]
                        chunks.append(chunk)
        return chunks

    for drug_chunks in labels.values():
        chunks.extend(drug_chunks)
    if len(targets) == 1 and any(term in question.casefold() for term in ("side effect", "adverse", "reaction")):
        try:
            events = client.fetch_reported_events(targets[0])
        except Exception:
            events = []
        if events:
            chunks.append(
                RetrievedChunk(
                    id=f"fda-event:{targets[0].casefold()}",
                    text="Reported reaction terms from openFDA drug/event records: " + ", ".join(events),
                    source_type="openfda_event",
                    source_title=f"openFDA Drug Event — {targets[0]}",
                    source_locator=f"FDA event query for {targets[0]}",
                    section="Reported reaction terms",
                    generic_name=targets[0],
                    metadata={"drug_a": targets[0]},
                    reranker_score=1.0,
                )
            )
    return chunks[:8]


def _filter_fda_chunks_for_question(question: str, intent: str, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    if intent not in {"patient_context_query", "single_drug_info", "unknown_drug"}:
        return chunks
    topics = detect_topics(question, "patient_context_query" if intent == "unknown_drug" else intent)
    if not topics:
        return chunks
    matched = [
        chunk for chunk in chunks
        if any(chunk_matches_topic(chunk.section, chunk.text, topic) for topic in topics)
    ]
    return matched or chunks


def _filter_chunks_for_profile_context(chunks: list[RetrievedChunk], profile_notes: str) -> list[RetrievedChunk]:
    if not profile_notes:
        return chunks
    contexts = detect_contexts(profile_notes, "profile")
    saved_profile_meds = extract_drugs(profile_notes).drugs
    fallback_terms = meaningful_profile_terms(profile_notes, saved_profile_meds)
    matched: list[RetrievedChunk] = []
    for chunk in chunks:
        if text_matches_context(f"{chunk.section}\n{chunk.text}", contexts, fallback_terms):
            chunk.metadata["context_match"] = True
            chunk.metadata["context_source"] = "profile"
            chunk.metadata["deterministic_match"] = True
            matched.append(chunk)
    return matched


_INTERNAL_EVIDENCE_TAG = re.compile(r"\s*\[EVIDENCE\s+\d+\]\s*", re.IGNORECASE)


def _sanitize_generated_answer(answer: str) -> str:
    """Remove internal evidence labels that belong in prompts, not the visible UI."""
    cleaned = _INTERNAL_EVIDENCE_TAG.sub(" ", answer or "")
    cleaned = re.sub(r"[ \t]+([,.;:])", r"\1", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    return cleaned.strip()


def _generate_safely(prompt: str) -> str | None:
    try:
        answer = get_llm().generate(prompt)
        return _sanitize_generated_answer(answer) if answer else None
    except Exception:
        return None


def answer_question(
    db: Session,
    question: str,
    history: list[tuple[str, str]],
    profile: UserProfile | None,
) -> AnswerResult:
    safety = detect_safety_signal(question)
    if safety["is_urgent"]:
        return AnswerResult(answer=urgent_response(), citations=[], route="unsafe_symptom")

    raw_extraction = extract_drugs(question)
    if not _is_medication_domain_query(question, raw_extraction, bool(history)):
        return AnswerResult(answer=OUT_OF_SCOPE, citations=[], route="out_of_scope")

    retrieval_question = _history_context(history, question)
    extraction = extract_drugs(retrieval_question)
    intent = detect_intent(retrieval_question, extraction)
    if (
        len(intent.drugs) == 1
        and intent.intent == "single_drug_info"
        and (detect_contexts(question, "question") or _has_explicit_patient_context_language(question))
    ):
        intent.intent = "patient_context_query"

    personal_suitability = _is_personal_suitability_query(question)
    personal_profile_scope = (
        personal_suitability
        or _references_user(question)
        or _inherits_personal_profile_scope(history, question)
    )

    # Pull only medication-relevant profile context. The user's name is intentionally
    # excluded from both retrieval and generation.
    profile_snapshot = read_profile_snapshot(profile)
    saved_profile_meds = list(profile_snapshot.medications) if personal_profile_scope else []
    retrieval_profile_context = (
        profile_snapshot.retrieval_context(question) if personal_profile_scope else ""
    )
    profile_context = (
        profile_snapshot.prompt_context(question) if personal_profile_scope else ""
    )

    # Personal suitability questions should become patient-context retrieval when a
    # saved condition/allergy/age context exists, even if the user did not repeat it.
    if (
        personal_profile_scope
        and retrieval_profile_context
        and len(intent.drugs) == 1
        and intent.intent == "single_drug_info"
    ):
        intent.intent = "patient_context_query"

    search_question = retrieval_question
    prompt_history: list[tuple[str, str]] = []

    if intent.intent == "multi_drug_query":
        lines = ["Pairwise DDInter check:"]
        citations: list[dict] = []
        for a, b in itertools.combinations(intent.drugs, 2):
            hit = ddi_pair_lookup(db, a, b)
            if hit:
                lines.append(f"- {a} + {b}: {hit.metadata.get('level', 'Unknown')} interaction risk. Source: {hit.source_locator}")
                citations.append(hit.to_citation())
            else:
                lines.append(f"- {a} + {b}: No documented DDInter pair was found in the provided local data; no interaction is inferred.")
        lines.append("This is not a substitute for professional medical advice.")
        return AnswerResult(answer="\n".join(lines), citations=citations, route="multi_drug_query")

    if intent.intent == "unknown_drug":
        fda_chunks = _filter_fda_chunks_for_question(
            question, intent.intent, _fda_fallback(question, intent.drugs, intent.unknown_candidates)
        )
        if not fda_chunks:
            return AnswerResult(answer=REFUSAL, citations=[], route="unknown_drug_refusal")
        all_named = intent.drugs + intent.unknown_candidates
        if len(all_named) == 2:
            confidence = score_retrieval_confidence(all_named, fda_chunks, [c.reranker_score for c in fda_chunks])
            if confidence.should_refuse_for_low_confidence:
                return AnswerResult(answer=REFUSAL, citations=[], route="low_confidence_refusal")
        prompt = build_prompt(retrieval_question, intent.intent, fda_chunks, prompt_history, profile_context)
        answer = _generate_safely(prompt)
        if not answer:
            return AnswerResult(
                answer="Source evidence was found, but the configured language model is unavailable, so I will not generate a medical answer. Please try again or consult a pharmacist or physician.",
                citations=[c.to_citation() for c in fda_chunks],
                route="generation_unavailable",
            )
        return AnswerResult(answer=answer, citations=[c.to_citation() for c in fda_chunks], route="fda_fallback")

    if intent.intent == "patient_context_query" and len(intent.drugs) == 1:
        chunks = retrieve_owned_patient_context(db, search_question, intent.drugs[0], retrieval_profile_context, saved_profile_meds)
    else:
        chunks = retrieve(db, search_question, intent.drugs, intent.intent)

    if personal_profile_scope and retrieval_profile_context and intent.intent == "patient_context_query":
        if has_patient_context_match(chunks):
            chunks = [c for c in chunks if c.metadata.get("context_match")]
        else:
            fda_candidates = _filter_fda_chunks_for_question(
                search_question, intent.intent, _fda_fallback(question, intent.drugs, [])
            )
            chunks = _filter_chunks_for_profile_context(fda_candidates, retrieval_profile_context)

    if not chunks and intent.intent in {"single_drug_info", "patient_context_query"} and intent.drugs:
        chunks = _filter_fda_chunks_for_question(
            search_question, intent.intent, _fda_fallback(question, intent.drugs, [])
        )
        if personal_profile_scope and retrieval_profile_context and intent.intent == "patient_context_query":
            chunks = _filter_chunks_for_profile_context(chunks, retrieval_profile_context)

    if personal_profile_scope and saved_profile_meds and len(intent.drugs) == 1:
        target = intent.drugs[0]
        saved_meds = [d for d in saved_profile_meds if normalize_drug_name(d) != normalize_drug_name(target)]
        ddi_profile_hits = []
        for med in saved_meds:
            hit = ddi_pair_lookup(db, target, med)
            if hit:
                hit.metadata["profile_medication_match"] = True
                hit.metadata["deterministic_match"] = True
                ddi_profile_hits.append(hit)
        if ddi_profile_hits:
            hit_ids = {h.id for h in ddi_profile_hits}
            chunks = ddi_profile_hits + [c for c in chunks if c.id not in hit_ids]

    confidence = score_retrieval_confidence(
        intent.drugs,
        chunks,
        [c.reranker_score for c in chunks],
        question=search_question,
        intent=intent.intent,
    )
    if confidence.should_refuse_for_low_confidence:
        return AnswerResult(answer=REFUSAL, citations=[], route="low_confidence_refusal")

    if not chunks:
        return AnswerResult(answer=REFUSAL, citations=[], route="no_evidence_refusal")

    prompt = build_prompt(retrieval_question, intent.intent, chunks, prompt_history, profile_context)
    answer = _generate_safely(prompt)
    if not answer:
        return AnswerResult(
            answer="Source evidence was found, but the configured language model is unavailable, so I will not generate a medical answer. Please try again or consult a pharmacist or physician.",
            citations=[chunk.to_citation() for chunk in chunks],
            route="generation_unavailable",
        )
    return AnswerResult(
        answer=answer,
        citations=[chunk.to_citation() for chunk in chunks],
        route=intent.intent,
    )
