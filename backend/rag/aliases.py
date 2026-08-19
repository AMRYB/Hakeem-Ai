from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

from backend.config import get_settings
from backend.rag.normalization import normalize_drug_name

settings = get_settings()


@lru_cache(maxsize=1)
def alias_map() -> dict[str, str]:
    """Return normalized alias -> canonical drug name.

    Aliases are a normalization aid only. They are never surfaced as clinical
    evidence and never replace the grounding requirements for the final answer.
    """
    path = Path(settings.drug_aliases_csv)
    result: dict[str, str] = {}
    if not path.exists():
        return result
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            alias = (row.get("alias") or "").strip()
            canonical = (row.get("canonical_name") or "").strip()
            if alias and canonical:
                result[normalize_drug_name(alias)] = canonical
    return result


def aliases_for_canonical(canonical_name: str) -> list[str]:
    canonical_norm = normalize_drug_name(canonical_name)
    values = [
        alias_norm
        for alias_norm, target in alias_map().items()
        if normalize_drug_name(target) == canonical_norm
    ]
    # Return normalized aliases because matching functions also normalize text.
    return sorted(set(values), key=len, reverse=True)


def refresh_aliases() -> None:
    alias_map.cache_clear()


def aliases_in_query(query: str) -> list[tuple[str, str]]:
    """Return (alias_text, canonical_name) pairs explicitly present in query."""
    import re
    from backend.rag.normalization import normalize_drug_name

    normalized_query = normalize_drug_name(query)
    matches: list[tuple[int, str, str]] = []
    for alias_norm, canonical in alias_map().items():
        m = re.search(rf"(?<![\w-]){re.escape(alias_norm)}(?![\w-])", normalized_query, flags=re.IGNORECASE)
        if m:
            matches.append((m.start(), alias_norm, canonical))
    matches.sort()
    return [(alias, canonical) for _, alias, canonical in matches]
