from __future__ import annotations

from dataclasses import dataclass

from backend.rag.drug_names import DrugExtraction


@dataclass
class IntentResult:
    intent: str
    drugs: list[str]
    unknown_candidates: list[str]


def detect_intent(query: str, extraction: DrugExtraction) -> IntentResult:
    q = query.casefold()
    drugs = extraction.drugs
    if extraction.unknown_candidates:
        return IntentResult("unknown_drug", drugs, extraction.unknown_candidates)
    if len(drugs) >= 3:
        return IntentResult("multi_drug_query", drugs, [])
    if len(drugs) == 2:
        return IntentResult("ddi_query", drugs, [])
    patient_terms = (
        "pregnan", "breastfeed", "kidney", "renal", "liver", "hepatic", "allerg", "age ",
        "years old", "child", "elderly", "condition", "disease"
    )
    if len(drugs) == 1 and any(term in q for term in patient_terms):
        return IntentResult("patient_context_query", drugs, [])
    if len(drugs) == 1:
        return IntentResult("single_drug_info", drugs, [])
    return IntentResult("general_knowledge", [], [])
