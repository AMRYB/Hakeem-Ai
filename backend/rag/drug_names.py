from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import select

from backend.db import SessionLocal
from backend.models import DdiPair, RagChunk
from backend.rag.aliases import alias_map
from backend.rag.normalization import normalize_drug_name


@dataclass
class DrugExtraction:
    drugs: list[str]
    unknown_candidates: list[str]


@lru_cache(maxsize=1)
def known_drug_map() -> dict[str, str]:
    result: dict[str, str] = {}
    with SessionLocal() as db:
        for a, b in db.execute(select(DdiPair.drug_a, DdiPair.drug_b)).all():
            result.setdefault(normalize_drug_name(a), a)
            result.setdefault(normalize_drug_name(b), b)
        for (name,) in db.execute(select(RagChunk.generic_name).where(RagChunk.generic_name.is_not(None))).all():
            if name:
                result.setdefault(normalize_drug_name(name), name)

    # Curated aliases are normalization only. They allow Egyptian/common names to
    # resolve to the exact canonical name used by DDInter / local RAG.
    for alias_norm, canonical in alias_map().items():
        result[alias_norm] = canonical
    return result


def refresh_known_drugs() -> None:
    known_drug_map.cache_clear()


def _find_unknown_candidates(query: str, known_norms: set[str]) -> list[str]:
    candidates: list[str] = []
    patterns = [
        r"(?:can|could|should)\s+i\s+take\s+([a-zA-Z][\w\- ]{1,40}?)\s+(?:with|and)\s+([a-zA-Z][\w\- ]{1,40}?)(?:[?.!,]|$)",
        r"interaction\s+(?:between|of)\s+([a-zA-Z][\w\- ]{1,40}?)\s+(?:and|with)\s+([a-zA-Z][\w\- ]{1,40}?)(?:[?.!,]|$)",
        r"side effects?\s+(?:of|for)\s+([a-zA-Z][\w\- ]{1,40}?)(?:[?.!,]|$)",
        # Single unknown drug names are only extracted when the sentence itself
        # carries explicit medication context. This avoids treating "banana bread"
        # as a drug merely because it appears after "what is".
        r"(?:medicine|medication|drug)\s+(?:called\s+|named\s+)?([a-zA-Z][\w\- ]{1,40}?)(?:[?.!,]|$)",
        r"(?:can|could|should)\s+i\s+take\s+([a-zA-Z][\w\- ]{1,40}?)(?:[?.!,]|$)",
    ]
    stop = {"it", "this", "that", "medicine", "medication", "drug", "aspirin too"}
    for pattern in patterns:
        match = re.search(pattern, query, flags=re.IGNORECASE)
        if not match:
            continue
        for group in match.groups():
            if not group:
                continue
            cleaned = re.sub(r"\s+", " ", group).strip(" .?!,")
            norm = normalize_drug_name(cleaned)
            # The single-drug fallback pattern must not re-label an already parsed
            # two-drug phrase (e.g. "warfarin and aspirin") as one unknown drug.
            if re.search(r"\b(?:and|with)\b", cleaned, flags=re.IGNORECASE):
                continue
            if norm and norm not in known_norms and norm not in stop and len(cleaned) <= 40:
                candidates.append(cleaned)
    return list(dict.fromkeys(candidates))


def extract_drugs(query: str) -> DrugExtraction:
    mapping = known_drug_map()
    normalized_query = normalize_drug_name(query)
    found: list[tuple[int, int, str]] = []
    for norm, canonical in mapping.items():
        pattern = rf"(?<![\w-]){re.escape(norm)}(?![\w-])"
        match = re.search(pattern, normalized_query, flags=re.IGNORECASE)
        if match:
            found.append((match.start(), -len(norm), canonical))
    found.sort()
    drugs: list[str] = []
    seen: set[str] = set()
    for _, _, canonical in found:
        norm = normalize_drug_name(canonical)
        if norm not in seen:
            drugs.append(canonical)
            seen.add(norm)
    unknown = _find_unknown_candidates(query, set(mapping.keys()))
    return DrugExtraction(drugs=drugs, unknown_candidates=unknown)
