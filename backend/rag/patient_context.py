from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from backend.config import get_settings

settings = get_settings()


@dataclass(frozen=True)
class ClinicalContext:
    key: str
    aliases: tuple[str, ...]
    sections: tuple[str, ...]
    source: str  # "question" or "profile"


_STOPWORDS = {
    "i", "me", "my", "have", "has", "had", "with", "and", "the", "a", "an", "of", "to", "for",
    "condition", "conditions", "disease", "diseases", "medical", "history", "health", "note", "notes",
    "current", "currently", "taking", "take", "medication", "medications", "medicine", "medicines",
    "allergy", "allergies", "none", "no", "yes", "patient", "user", "supplied"
}


@lru_cache(maxsize=1)
def context_registry() -> dict[str, dict]:
    # Keep the registry configurable so adding a new patient context never requires
    # changing retrieval code. Fall back to an empty registry if the file is absent.
    path = Path("./config/clinical_contexts.json")
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _contains_alias(text: str, alias: str) -> bool:
    return bool(re.search(rf"(?<![\w-]){re.escape(alias.casefold())}(?![\w-])", text.casefold()))


def detect_contexts(text: str, source: str) -> list[ClinicalContext]:
    found: list[ClinicalContext] = []
    for key, spec in context_registry().items():
        aliases = tuple(str(x).casefold() for x in spec.get("aliases", []) if str(x).strip())
        if aliases and any(_contains_alias(text, alias) for alias in aliases):
            found.append(
                ClinicalContext(
                    key=key,
                    aliases=aliases,
                    sections=tuple(str(x).casefold() for x in spec.get("sections", []) if str(x).strip()),
                    source=source,
                )
            )
    return found


def meaningful_profile_terms(profile_notes: str, exclude_terms: list[str] | None = None) -> list[str]:
    """Return generic fallback terms for profile facts not in the registry.

    These terms are used only to FORCE-INCLUDE exact lexical evidence from the
    requested drug's own monograph. They never become medical facts themselves.
    Drug names are removed because current medications are handled separately by
    DDInter checks instead of being confused with medical conditions.
    """
    if not profile_notes:
        return []
    excluded_tokens: set[str] = set()
    for value in exclude_terms or []:
        excluded_tokens.update(re.findall(r"[a-z0-9-]+", value.casefold()))
    terms = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", profile_notes.casefold()):
        if token in _STOPWORDS or token in excluded_tokens:
            continue
        terms.append(token)
    return list(dict.fromkeys(terms))



def meaningful_question_context_terms(question: str, drug: str = "") -> list[str]:
    """Generic fallback for explicit conditions not yet in the context registry.

    Example: "Can I take X if I have psoriasis?" -> ["psoriasis"]. The drug
    name and conversational scaffolding are removed, so this remains a retrieval
    aid rather than a medical classifier.
    """
    stop = _STOPWORDS | {
        "can", "could", "should", "safe", "okay", "use", "start", "person", "patient",
        "woman", "women", "man", "men", "diagnosed", "suffer", "suffering", "because",
        "while", "about", "what", "does", "drug", "tablet", "capsule"
    }
    drug_tokens = set(re.findall(r"[a-z0-9-]+", (drug or "").casefold()))
    terms = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", question.casefold()):
        if token in stop or token in drug_tokens:
            continue
        terms.append(token)
    return list(dict.fromkeys(terms))


def context_aliases(contexts: list[ClinicalContext], fallback_terms: list[str] | None = None) -> list[str]:
    aliases: list[str] = []
    for context in contexts:
        aliases.extend(context.aliases)
    aliases.extend(fallback_terms or [])
    return list(dict.fromkeys(a.casefold() for a in aliases if a))


def context_sections(contexts: list[ClinicalContext]) -> set[str]:
    result: set[str] = set()
    for context in contexts:
        result.update(context.sections)
    return result


def text_matches_context(text: str, contexts: list[ClinicalContext], fallback_terms: list[str] | None = None) -> bool:
    haystack = text.casefold()
    aliases = context_aliases(contexts, fallback_terms)
    return any(_contains_alias(haystack, alias) for alias in aliases)


def section_matches_context(section: str, contexts: list[ClinicalContext]) -> bool:
    section_cf = (section or "").casefold()
    hints = context_sections(contexts)
    return any(hint in section_cf for hint in hints)
