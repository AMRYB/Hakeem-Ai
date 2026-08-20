from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from backend.rag.drug_names import extract_drugs
from backend.security import decrypt_text


def _normalise(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(v).strip() for v in value if str(v).strip())
    if isinstance(value, dict):
        return "; ".join(f"{k}: {v}" for k, v in value.items() if str(v).strip())

    text = str(value).strip()
    if not text:
        return ""

    if text[:1] in {"[", "{"}:
        try:
            return _normalise(json.loads(text))
        except Exception:
            pass
    return text


def _encrypted(profile: Any, *names: str) -> str:
    for name in names:
        value = getattr(profile, name, None)
        if value in (None, ""):
            continue
        try:
            return _normalise(decrypt_text(value))
        except Exception:
            continue
    return ""


def _plain(profile: Any, *names: str) -> str:
    for name in names:
        value = getattr(profile, name, None)
        if value not in (None, ""):
            return _normalise(value)
    return ""


def _field(
    profile: Any,
    *,
    encrypted_names: tuple[str, ...] = (),
    plain_names: tuple[str, ...] = (),
) -> str:
    return _encrypted(profile, *encrypted_names) or _plain(profile, *plain_names)


@dataclass(frozen=True)
class ProfileSnapshot:
    """Medication-relevant profile state.

    Name is intentionally excluded: it belongs in the UI, not in medical retrieval
    or the LLM prompt.
    """

    age: str = ""
    conditions: str = ""
    allergies: str = ""
    health_notes: str = ""
    medication_text: str = ""
    medications: tuple[str, ...] = ()

    def age_context(self, question: str = "") -> str:
        if not self.age:
            return ""
        try:
            years = int(float(self.age))
        except Exception:
            return ""

        if years < 18:
            return f"pediatric patient, age {years}"
        if years >= 65:
            return f"older adult, age {years}"

        q = question.casefold()
        if any(x in q for x in ("age", "dose", "dosage", "dosing", "years old", "how much")):
            return f"adult patient, age {years}"
        return ""

    def retrieval_context(self, question: str = "") -> str:
        parts: list[str] = []
        if self.conditions:
            parts.append(f"Conditions supplied by user: {self.conditions}")
        if self.allergies:
            parts.append(f"Allergies supplied by user: {self.allergies}")
        if self.health_notes:
            parts.append(f"Additional health notes supplied by user: {self.health_notes}")

        age_ctx = self.age_context(question)
        if age_ctx:
            parts.append(f"Age context: {age_ctx}")

        return "\n".join(parts)

    def prompt_context(self, question: str = "") -> str:
        parts: list[str] = []
        if self.conditions:
            parts.append(f"User-provided conditions: {self.conditions}")
        if self.allergies:
            parts.append(f"User-provided allergies: {self.allergies}")
        if self.health_notes:
            parts.append(f"Additional user-provided health context: {self.health_notes}")

        age_ctx = self.age_context(question)
        if age_ctx:
            parts.append(f"Age context: {age_ctx}")

        if self.medications:
            parts.append("Current medications saved by user: " + ", ".join(self.medications))

        return "\n".join(parts)


def read_profile_snapshot(profile: Any | None) -> ProfileSnapshot:
    if profile is None:
        return ProfileSnapshot()

    age = _field(
        profile,
        encrypted_names=("encrypted_age",),
        plain_names=("age",),
    )

    # Original project's free-text field.
    health_notes = _field(
        profile,
        encrypted_names=("encrypted_health_notes", "encrypted_notes"),
        plain_names=("health_notes", "notes"),
    )

    # Compatible with newer split fields if your updated UserProfile model has them.
    conditions = _field(
        profile,
        encrypted_names=("encrypted_conditions", "encrypted_medical_conditions"),
        plain_names=("conditions", "medical_conditions"),
    )
    allergies = _field(
        profile,
        encrypted_names=("encrypted_allergies",),
        plain_names=("allergies",),
    )
    medication_text = _field(
        profile,
        encrypted_names=(
            "encrypted_current_medications",
            "encrypted_medications",
            "encrypted_current_meds",
        ),
        plain_names=("current_medications", "medications", "current_meds"),
    )

    # Current medications may be stored either in their own field or inside the
    # original health-notes field. Drug extraction remains deterministic.
    meds_source = "\n".join(x for x in (medication_text, health_notes) if x)
    medications = tuple(dict.fromkeys(extract_drugs(meds_source).drugs)) if meds_source else ()

    return ProfileSnapshot(
        age=age,
        conditions=conditions,
        allergies=allergies,
        health_notes=health_notes,
        medication_text=medication_text,
        medications=medications,
    )
