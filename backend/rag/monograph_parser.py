from __future__ import annotations

import re
from dataclasses import dataclass

SECTION_ORDER = {
    "Indications": 1,
    "Dosage Regimen": 2,
    "Dosage Adjustment": 3,
    "Contraindications": 4,
    "Adverse Reactions": 5,
    "Monitoring Parameters": 6,
    "Drug Interactions": 7,
    "Pregnancy and Lactation": 8,
    "Administration": 9,
    "Warnings/Precautions": 10,
    "Storage": 11,
}

SECTION_TO_FIELD = {
    "Indications": "indications",
    "Dosage Regimen": "dosage_regimen",
    "Dosage Adjustment": "dosage_adjustment",
    "Contraindications": "contraindications",
    "Adverse Reactions": "adverse_reactions",
    "Monitoring Parameters": "monitoring_parameters",
    "Drug Interactions": "drug_interactions",
    "Pregnancy and Lactation": "pregnancy_lactation",
    "Administration": "administration",
    "Warnings/Precautions": "warnings_precautions",
    "Storage": "storage",
}

_PAGE_JUNK = (
    re.compile(r"^\s*(?:\d{1,4}\s+)?Code:\s*EDA(?:\.|\s)", re.I),
    re.compile(r"^\s*Egyptian\s*$", re.I),
    re.compile(r"^\s*Formulary\s*$", re.I),
    re.compile(r"^\s*\d{1,4}\s*$"),
)


@dataclass
class ParsedMonograph:
    sections: dict[str, str]
    general: str


def _clean_line(line: str) -> str:
    return re.sub(r"[ \t]+", " ", line).strip()


def _is_junk(line: str, next_line: str = "") -> bool:
    if not line:
        return False
    # Standalone "Drug" is usually the recurring page header "Egyptian Drug
    # Formulary". Keep it only when it is clearly the split heading
    # "Drug / Interactions".
    if re.fullmatch(r"Drug", line, flags=re.I) and not re.match(r"Interactions\b", next_line, flags=re.I):
        return True
    return any(p.search(line) for p in _PAGE_JUNK)


def _strip_prefix(line: str, pattern: str) -> str:
    return re.sub(pattern, "", line, count=1, flags=re.I).strip(" :-\t")


def _detect_section(lines: list[str], i: int, current_order: int) -> tuple[str | None, str, int]:
    """Detect a section heading in EDA table-extracted text.

    Returns (canonical_section, remainder_on_heading_line, continuation_lines_to_skip).
    The parser is deliberately deterministic. It understands headings split by PDF
    table extraction such as "Contra- ... / Indications" and
    "Pregnancy and ... / Lactation" without using an LLM.
    """
    line = lines[i]
    nxt = lines[i + 1] if i + 1 < len(lines) else ""

    # Indications is the first true clinical section. Avoid lower-case body uses.
    if re.match(r"^Indications\b", line) and current_order <= SECTION_ORDER["Indications"]:
        return "Indications", _strip_prefix(line, r"^Indications\b"), 0

    # Dosage form/strength also begins with "Dosage" near the top. Only treat as
    # regimen after indications, or when the split heading explicitly says Regimen.
    if current_order <= SECTION_ORDER["Dosage Regimen"]:
        if re.match(r"^Dosage\s+Regimen\b", line, re.I):
            return "Dosage Regimen", _strip_prefix(line, r"^Dosage\s+Regimen\b"), 0
        if re.fullmatch(r"Dosage", line, re.I) and re.match(r"^Regimen\b", nxt, re.I):
            return "Dosage Regimen", "", 1
        if current_order >= SECTION_ORDER["Indications"] and re.match(r"^Dosage\b", line, re.I):
            # Explicit renal/hepatic adjustment is handled below.
            if not re.search(r"form|strength", line[:60], re.I):
                remainder = _strip_prefix(line, r"^Dosage\b")
                if not re.match(r"^(?:Form|Strength)\b", remainder, re.I):
                    return "Dosage Regimen", remainder, 0

    # Dosage Adjustment is frequently split vertically: "Dosage <renal text>" then "Adjustment".
    if current_order <= SECTION_ORDER["Dosage Adjustment"]:
        if re.match(r"^Dosage\s+Adjustment\b", line, re.I):
            return "Dosage Adjustment", _strip_prefix(line, r"^Dosage\s+Adjustment\b"), 0
        if re.match(r"^Dosage\b", line, re.I) and re.match(r"^Adjustment\b", nxt, re.I):
            return "Dosage Adjustment", _strip_prefix(line, r"^Dosage\b"), 1
        if current_order >= SECTION_ORDER["Dosage Regimen"] and re.match(r"^Adjustment\b", line, re.I):
            return "Dosage Adjustment", _strip_prefix(line, r"^Adjustment\b"), 0

    # Table extraction commonly produces "Contra- <body>" on one line and
    # "Indications" on the next.
    if current_order <= SECTION_ORDER["Contraindications"] and re.match(r"^Contra-", line, re.I):
        skip = 1 if re.match(r"^Indications\b", nxt, re.I) else 0
        remainder = _strip_prefix(line, r"^Contra-\s*")
        if skip:
            nxt_remainder = _strip_prefix(nxt, r"^Indications\b")
            if nxt_remainder:
                remainder = (remainder + " " + nxt_remainder).strip()
        return "Contraindications", remainder, skip
    if current_order <= SECTION_ORDER["Contraindications"] and re.match(r"^Contraindications\b", line, re.I):
        return "Contraindications", _strip_prefix(line, r"^Contraindications\b"), 0

    if current_order <= SECTION_ORDER["Adverse Reactions"] and re.match(r"^Adverse\s+(?:Drug\s+)?", line, re.I):
        # Prefer the recognizable EDA heading "Adverse Drug / Reactions".
        if re.match(r"^Adverse\s+Drug\b", line, re.I):
            skip = 1 if re.match(r"^Reactions\b", nxt, re.I) else 0
            remainder = _strip_prefix(line, r"^Adverse\s+Drug\b")
            if skip:
                nxt_remainder = _strip_prefix(nxt, r"^Reactions\b")
                if nxt_remainder:
                    remainder = (remainder + " " + nxt_remainder).strip()
            return "Adverse Reactions", remainder, skip
        if re.match(r"^Adverse\s+Reactions?\b", line, re.I):
            return "Adverse Reactions", _strip_prefix(line, r"^Adverse\s+Reactions?\b"), 0

    if current_order <= SECTION_ORDER["Monitoring Parameters"] and re.match(r"^Monitoring\b", line, re.I):
        skip = 1 if re.match(r"^Parameters\b", nxt, re.I) else 0
        remainder = _strip_prefix(line, r"^Monitoring\b")
        if skip:
            nxt_remainder = _strip_prefix(nxt, r"^Parameters\b")
            if nxt_remainder:
                remainder = (remainder + " " + nxt_remainder).strip()
        return "Monitoring Parameters", remainder, skip

    if current_order <= SECTION_ORDER["Drug Interactions"]:
        if re.match(r"^Drug\s+Interactions\b", line, re.I):
            return "Drug Interactions", _strip_prefix(line, r"^Drug\s+Interactions\b"), 0
        if re.match(r"^Drug\b", line, re.I) and (
            re.match(r"^Interactions\b", nxt, re.I)
            or re.search(r"\bRisk\s+[A-Z]\b|avoid combination|therapy modification", line, re.I)
        ):
            skip = 1 if re.match(r"^Interactions\b", nxt, re.I) else 0
            remainder = _strip_prefix(line, r"^Drug\b")
            if skip:
                nxt_remainder = _strip_prefix(nxt, r"^Interactions\b")
                if nxt_remainder:
                    remainder = (remainder + " " + nxt_remainder).strip()
            return "Drug Interactions", remainder, skip
        if current_order >= SECTION_ORDER["Monitoring Parameters"] and re.match(r"^Interactions\b", line, re.I):
            return "Drug Interactions", _strip_prefix(line, r"^Interactions\b"), 0

    if current_order <= SECTION_ORDER["Pregnancy and Lactation"]:
        if re.match(r"^Pregnancy\s+and\b", line, re.I):
            skip = 1 if re.match(r"^Lactation\b", nxt, re.I) else 0
            remainder = _strip_prefix(line, r"^Pregnancy\s+and\b")
            # In table extraction the word "Lactation" may be on the next line as
            # the second half of the heading; retain any content after it.
            if skip:
                nxt_remainder = _strip_prefix(nxt, r"^Lactation\b")
                if nxt_remainder:
                    remainder = (remainder + " " + nxt_remainder).strip()
            return "Pregnancy and Lactation", remainder, skip
        # Some source PDFs use a single Pregnancy heading followed later by Lactation.
        if current_order >= SECTION_ORDER["Drug Interactions"] and re.match(r"^Pregnancy\b", line, re.I):
            return "Pregnancy and Lactation", _strip_prefix(line, r"^Pregnancy\b"), 0

    # "Administration" near the top is often only the second half of "Route of
    # Administration". Only accept it after the middle clinical sections.
    if current_order <= SECTION_ORDER["Administration"] and current_order >= SECTION_ORDER["Monitoring Parameters"]:
        if re.match(r"^Administration\b", line, re.I):
            return "Administration", _strip_prefix(line, r"^Administration\b"), 0

    if current_order <= SECTION_ORDER["Warnings/Precautions"] and current_order >= SECTION_ORDER["Drug Interactions"]:
        if re.match(r"^Warnings?[/ ]", line, re.I) or re.match(r"^Warnings?:\b", line, re.I):
            remainder = re.sub(r"^Warnings?(?:/\s*(?:Prec(?:autions?)?)?)?\s*:?-?\s*", "", line, count=1, flags=re.I)
            skip = 1 if re.match(r"^Precautions?\b", nxt, re.I) else 0
            if skip:
                nxt_remainder = _strip_prefix(nxt, r"^Precautions?\b")
                if nxt_remainder:
                    remainder = (remainder + " " + nxt_remainder).strip()
            return "Warnings/Precautions", remainder.strip(), skip

    if current_order <= SECTION_ORDER["Storage"] and current_order >= SECTION_ORDER["Drug Interactions"]:
        if re.match(r"^Storage\b", line, re.I):
            return "Storage", _strip_prefix(line, r"^Storage\b"), 0

    return None, "", 0


def parse_monograph_sections(text: str) -> ParsedMonograph:
    if not text or not str(text).strip() or str(text).strip().casefold() == "nan":
        return ParsedMonograph(sections={}, general="")

    raw_lines = [_clean_line(x) for x in str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    lines = [x for x in raw_lines if x]
    sections: dict[str, list[str]] = {}
    general: list[str] = []
    current_section: str | None = None
    current_order = 0

    i = 0
    while i < len(lines):
        line = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if _is_junk(line, nxt):
            i += 1
            continue

        section, remainder, skip = _detect_section(lines, i, current_order)
        if section:
            order = SECTION_ORDER[section]
            # Monographs are ordered tables. Reject backwards jumps caused by body
            # words that happen to look like headings.
            if order >= current_order:
                current_section = section
                current_order = order
                sections.setdefault(section, [])
                if remainder:
                    sections[section].append(remainder)
                i += 1 + skip
                continue

        if current_section:
            # Suppress split-heading continuation words when they were not consumed
            # by the lookahead logic.
            if re.fullmatch(r"(?:Indications|Reactions|Parameters|Interactions|Lactation|Precautions?)", line, flags=re.I):
                i += 1
                continue
            sections.setdefault(current_section, []).append(line)
        else:
            general.append(line)
        i += 1

    def collapse(parts: list[str]) -> str:
        text_value = "\n".join(p.strip() for p in parts if p.strip())
        # Preserve bullets/newline structure while removing excessive spacing.
        text_value = re.sub(r"[ \t]+", " ", text_value)
        text_value = re.sub(r"\n{3,}", "\n\n", text_value)
        return text_value.strip()

    cleaned = {section: collapse(parts) for section, parts in sections.items() if collapse(parts)}
    return ParsedMonograph(sections=cleaned, general=collapse(general))


def split_for_rag(text: str) -> list[tuple[str, str]]:
    parsed = parse_monograph_sections(text)
    result: list[tuple[str, str]] = []
    if parsed.general:
        result.append(("General", parsed.general))
    result.extend((section, body) for section, body in parsed.sections.items() if body)
    if not result and text and str(text).strip():
        result.append(("General", re.sub(r"\s+", " ", str(text)).strip()))
    return result
