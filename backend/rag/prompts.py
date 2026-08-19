from __future__ import annotations

import re

from backend.rag.types import RetrievedChunk

REFUSAL = (
    "I don't have information on this in the provided data or the FDA database. "
    "Please consult a pharmacist or physician."
)


_PEDIATRIC_TERMS = (
    "pediatric", "paediatric", "child", "children", "infant", "infants",
    "adolescent", "adolescents", "teen", "teenager",
)
_ADULT_TERMS = ("adult", "adults", "elderly", "older adult", "older adults", "geriatric")


def _age_from_text(text: str) -> int | None:
    """Extract an explicitly stated age when the wording is unambiguous."""
    patterns = (
        r"\bage\s*[:=]?\s*(\d{1,3})\b",
        r"\b(\d{1,3})\s*[- ]?years?[- ]?old\b",
        r"\b(\d{1,3})\s*y/?o\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if 0 <= value <= 120:
                return value
    return None


def _population_scope(question: str, profile_context: str) -> str:
    """Return adult, pediatric, or unspecified without guessing.

    Current-turn wording wins. Profile age/context is used only when build_prompt
    was deliberately given relevant user context by the service layer.
    """
    q = question.casefold()
    age = _age_from_text(question)
    if age is not None:
        return "pediatric" if age < 18 else "adult"
    if any(term in q for term in _PEDIATRIC_TERMS):
        return "pediatric"
    if any(term in q for term in _ADULT_TERMS):
        return "adult"

    p = (profile_context or "").casefold()
    age = _age_from_text(profile_context or "")
    if age is not None:
        return "pediatric" if age < 18 else "adult"
    if any(term in p for term in _PEDIATRIC_TERMS):
        return "pediatric"
    if any(term in p for term in _ADULT_TERMS):
        return "adult"
    return "unspecified"


def _population_heading(line: str) -> str | None:
    """Recognize population section headings, not incidental clinical mentions."""
    stripped = " ".join(line.strip().split())
    if not stripped:
        return None
    cf = stripped.casefold()

    pediatric = any(re.search(rf"\b{re.escape(term)}\b", cf) for term in _PEDIATRIC_TERMS)
    adult = any(re.search(rf"\b{re.escape(term)}\b", cf) for term in _ADULT_TERMS)
    if pediatric == adult:  # both or neither: not a clean population boundary
        return None

    # Population labels in the formulary usually occur in short headings such as
    # "Dosing: Adult", "Dosing: Renal impairment Adult", or "Dosing: Pediatric".
    headingish = (
        len(stripped) <= 140
        and (
            cf.startswith(("dosing", "dosage", "dose", "adult", "pediatric", "paediatric", "children", "infant", "adolescent", "elderly"))
            or any(token in cf for token in ("dosing:", "dosage:", "regimen", "renal impairment", "kidney function", "hepatic impairment"))
        )
    )
    if not headingish:
        return None
    return "pediatric" if pediatric else "adult"


def _segment_population_text(text: str) -> list[tuple[str | None, list[str]]]:
    """Split one evidence chunk at explicit adult/pediatric section boundaries."""
    segments: list[tuple[str | None, list[str]]] = []
    current_label: str | None = None
    current_lines: list[str] = []

    for line in text.splitlines():
        label = _population_heading(line)
        if label is not None:
            if current_lines:
                segments.append((current_label, current_lines))
            current_label = label
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        segments.append((current_label, current_lines))
    return segments


def _scope_population_evidence(text: str, requested_scope: str) -> tuple[str, set[str]]:
    """Keep population evidence separated and optionally filter to an explicit group.

    This does not invent a default population. If the question gives no age/group,
    both groups remain available but are marked so the generator cannot merge a
    pediatric threshold into an adult recommendation (or vice versa).
    """
    segments = _segment_population_text(text)
    present = {label for label, _ in segments if label in {"adult", "pediatric"}}
    if not present:
        return text, set()

    rendered: list[str] = []
    for label, lines in segments:
        if label is not None and requested_scope in {"adult", "pediatric"} and label != requested_scope:
            continue
        block = "\n".join(lines).strip()
        if not block:
            continue
        if label == "adult":
            rendered.append("[ADULT-SPECIFIC EVIDENCE — DO NOT APPLY TO PEDIATRIC PATIENTS]\n" + block)
        elif label == "pediatric":
            rendered.append("[PEDIATRIC-SPECIFIC EVIDENCE — DO NOT APPLY TO ADULT PATIENTS]\n" + block)
        else:
            rendered.append("[GENERAL / SHARED EVIDENCE]\n" + block)

    return "\n\n".join(rendered) or text, present


def build_prompt(
    question: str,
    intent: str,
    chunks: list[RetrievedChunk],
    history: list[tuple[str, str]],
    relevant_profile_context: str = "",
) -> str:
    requested_population = _population_scope(question, relevant_profile_context)
    evidence_parts = []
    population_groups_seen: set[str] = set()

    for i, chunk in enumerate(chunks, start=1):
        scoped_text, groups = _scope_population_evidence(chunk.text, requested_population)
        population_groups_seen.update(groups)
        evidence_parts.append(
            f"[EVIDENCE {i}]\n"
            f"Drug this evidence belongs to: {chunk.generic_name or 'Not specified'}\n"
            f"Source: {chunk.source_title}\n"
            f"Locator: {chunk.source_locator}\n"
            f"Section: {chunk.section}\n"
            f"Population scope requested: {requested_population}\n"
            f"Text: {scoped_text}\n"
            f"Metadata: {chunk.metadata}\n"
        )
    history_text = "\n".join(f"User: {q}\nAssistant: {a}" for q, a in history[-6:]) or "None"
    profile_text = relevant_profile_context or "None"
    evidence_text = "\n".join(evidence_parts) or "None"

    if requested_population == "unspecified" and {"adult", "pediatric"}.issubset(population_groups_seen):
        population_instruction = (
            "The evidence contains separate ADULT and PEDIATRIC guidance, but the current question does not specify a population. "
            "Keep the two populations separate in the answer. Never combine their dose ranges, renal cutoffs, intervals, or monitoring rules. "
            "If an adult range is not supplied for a value covered only in the pediatric block, say the adult guidance is not specified for that range."
        )
    elif requested_population in {"adult", "pediatric"}:
        population_instruction = (
            f"The requested population is {requested_population}. Use only {requested_population}-applicable population-specific evidence. "
            "Do not borrow a threshold, dose, interval, or recommendation from the other population."
        )
    else:
        population_instruction = "No explicit adult/pediatric distinction is present or required in the supplied evidence."

    format_rules = {
        "ddi_query": """Use exactly this structure:
- Interaction: <grounded summary>
- Mechanism (if evidence supports it): <grounded mechanism OR \"Mechanism not specified in the available data.\">
- Severity / Risk level: <exact source value OR \"Not specified in the available data.\">
- Clinical recommendation: <exactly supported recommendation OR \"Not specified in the available data.\">
- Source: <source title and locator>
This is not a substitute for professional medical advice.""",
        "patient_context_query": """Do NOT force a DDI-only template. Use:
- Safety consideration: <answer only the patient factors actually supported by the requested drug's own evidence>
- Relevant guidance: <contraindication/warning/dose-adjustment/monitoring guidance supported by that evidence>
- Current-medication interaction (only if DDInter evidence is supplied): <pair + exact severity>
- Source: <source title, section and locator>
This is not a substitute for professional medical advice.
If the evidence explicitly says a drug is contraindicated for the stated context, say that plainly. Preserve every exception or qualification from the same evidence. If some saved profile facts are not addressed by evidence, do not invent an answer for them.""",
        "single_drug_info": """Answer the specific single-drug question concisely. Use evidence belonging to that drug, not another drug that merely mentions it. Include a Source line with source title, section and locator. Do not force an interaction template.""",
        "unknown_drug": """Answer only from the FDA evidence shown. If the evidence does not support the requested fact, state that it is not specified. Include a Source line.""",
        "general_knowledge": """Answer the general medication-safety question only from the supplied evidence and cite it. Do not introduce facts from training memory.""",
    }.get(intent, "Answer concisely using only the supplied evidence and cite it.")

    return f"""You are a medication-safety assistant operating under a strict evidence-only policy.

ABSOLUTE RULES:
1. Use ONLY EVIDENCE below. Never use medical facts from your training memory.
2. If a fact or mechanism is not explicitly supported by EVIDENCE, say it is not specified in the available data.
3. Never diagnose a condition.
4. Never invent a clinical recommendation.
5. Keep severity exactly as stated by the source.
6. For mechanisms, only state an enzyme/transporter/target/additive effect when it appears explicitly in EVIDENCE.
7. Conversation history is for resolving references only. It is NOT evidence for new medical claims.
8. User profile context is user-provided context, not medical evidence.
9. Cite evidence using [EVIDENCE n] after each material claim.
10. Do not infer that \"no retrieved mention\" means \"no interaction\" or \"safe\".
11. Do not say the evidence fails to address a topic when a supplied evidence chunk explicitly addresses that topic.
12. Preserve important exceptions, qualifiers, trimester/time-window restrictions, renal/hepatic qualifiers, and monitoring conditions found in the evidence.
13. For single-drug and patient-context questions, NEVER use a different drug's monograph merely because its text mentions the requested drug. The line \"Drug this evidence belongs to\" identifies ownership.
14. Do not convert an interaction mentioned in another drug's monograph into a contraindication, pregnancy warning, dose rule, or general safety statement for the requested drug.
15. If two evidence chunks conflict, do not reconcile them from memory. State the conflict and cite both.
16. The CURRENT QUESTION is authoritative. Never rewrite it using an old condition from conversation history.
17. Never assume pregnancy, kidney disease, liver disease, allergy, asthma, or any other patient condition unless it is stated in the CURRENT QUESTION or in Relevant user-provided context.
18. For a standalone personal question such as \"Can I take X?\", use Relevant user-provided context when it is supplied. If that context contains a condition such as asthma, answer only from evidence that explicitly addresses that condition or state that it is not specified.
19. Do not copy wording, risks, contraindications, or patient state from a previous answer unless the current turn is explicitly a follow-up and the supplied evidence supports the new claim.
20. Never present breastfeeding guidance as pregnancy guidance, or pregnancy guidance as breastfeeding guidance.
21. A profile fact is relevant only when EVIDENCE explicitly addresses it. Do not turn the profile itself into medical evidence.
22. Evidence with Metadata context_match=true was deterministically matched to the current question/profile and should be preferred over merely semantically similar evidence.
23. Evidence with Metadata profile_medication_match=true is an exact DDInter check against a medication saved in the user's profile. Report that pair separately; do not infer that the requested drug is globally safe or unsafe from unrelated factors.
24. Never answer a condition from conversation history. Conditions may come only from CURRENT QUESTION or Relevant user-provided context.
25. Adult, pediatric, infant, adolescent, elderly, pregnancy, renal, and hepatic qualifiers are clinical boundaries, not interchangeable wording. Never transfer a numeric cutoff, dose, interval, or recommendation from one population to another.
26. When EVIDENCE contains both ADULT-SPECIFIC and PEDIATRIC-SPECIFIC blocks and no population was requested, present them separately if both are needed. Never merge them into one dosing rule.
27. If the requested population's evidence does not cover a particular renal/hepatic range or age group, say it is not specified in the supplied evidence. Never fill the gap using another population's rule.

Population handling for this question: {population_instruction}

Intent: {intent}
CURRENT QUESTION: {question}
Relevant user-provided context: {profile_text}
Recent conversation history (reference resolution only; may be None):
{history_text}

EVIDENCE:
{evidence_text}

RESPONSE FORMAT FOR THIS INTENT:
{format_rules}
"""
