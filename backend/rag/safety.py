from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from backend.config import get_settings

settings = get_settings()


@lru_cache(maxsize=1)
def _patterns() -> dict[str, list[re.Pattern[str]]]:
    path = Path(settings.safety_patterns_file)
    if not path.exists():
        raise RuntimeError(f"Safety patterns file not found: {path}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        category: [re.compile(pattern, flags=re.IGNORECASE) for pattern in patterns]
        for category, patterns in raw.items()
    }


def detect_safety_signal(query: str) -> dict:
    matches: list[str] = []
    matched_category: str | None = None
    for category, patterns in _patterns().items():
        for pattern in patterns:
            if pattern.search(query):
                matches.append(pattern.pattern)
                matched_category = matched_category or category
    return {
        "is_urgent": bool(matches),
        "matched_patterns": matches,
        "category": matched_category,
    }


def urgent_response() -> str:
    return (
        "The symptom you described may require urgent medical attention. "
        "Please seek urgent/emergency medical care now or contact your local emergency service. "
        "I will not try to diagnose the cause or evaluate drug interactions in this turn. "
        "This system is not a substitute for professional medical care."
    )
