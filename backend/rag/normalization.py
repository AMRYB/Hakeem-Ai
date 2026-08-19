from __future__ import annotations

import re
import unicodedata


def normalize_drug_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").strip().casefold()
    value = re.sub(r"[®™]", "", value)
    value = re.sub(r"\s+", " ", value)
    return value


def canonical_pair(a: str, b: str) -> tuple[str, str]:
    na, nb = normalize_drug_name(a), normalize_drug_name(b)
    return (na, nb) if na <= nb else (nb, na)
