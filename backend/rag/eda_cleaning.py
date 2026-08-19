from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
import json
import re

import pandas as pd

from backend.config import get_settings
from backend.rag.monograph_parser import SECTION_TO_FIELD, parse_monograph_sections

settings = get_settings()


@dataclass
class CleaningReport:
    input_rows: int
    fields_filled_from_raw: dict[str, int]
    fields_rebuilt_from_raw: dict[str, int]
    fields_nonempty_after: dict[str, int]
    output_path: str

    def to_dict(self) -> dict:
        return asdict(self)


def _is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and pd.isna(value):
        return True
    text = str(value).strip()
    return not text or text.casefold() == "nan"


def _normalize_cell(value) -> str:
    if _is_blank(value):
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _prefer_parsed(existing, parsed: str) -> tuple[str, str]:
    """Choose the deterministic raw-text parser when it produced a section.

    The original CSV's structured columns were produced from PDF tables and are
    often empty or accidentally contain following sections. raw_monograph_text is
    retained untouched, so rebuilding a structured field does not discard source
    evidence.
    Returns (value, action) where action is filled/rebuilt/kept.
    """
    existing_norm = _normalize_cell(existing)
    parsed_norm = _normalize_cell(parsed)
    if parsed_norm:
        if not existing_norm:
            return parsed_norm, "filled"
        if parsed_norm != existing_norm:
            return parsed_norm, "rebuilt"
        return existing_norm, "kept"
    return existing_norm, "kept"


def clean_eda_csv(source_path: str | Path, output_path: str | Path) -> CleaningReport:
    source = Path(source_path)
    output = Path(output_path)
    if not source.exists():
        raise FileNotFoundError(source)

    frame = pd.read_csv(source)
    if "generic_name" not in frame.columns or "raw_monograph_text" not in frame.columns:
        raise ValueError("EDA monograph CSV must contain generic_name and raw_monograph_text")

    for field in SECTION_TO_FIELD.values():
        if field not in frame.columns:
            frame[field] = ""

    filled = {field: 0 for field in SECTION_TO_FIELD.values()}
    rebuilt = {field: 0 for field in SECTION_TO_FIELD.values()}

    for idx, row in frame.iterrows():
        parsed = parse_monograph_sections(str(row.get("raw_monograph_text") or ""))
        for section, field in SECTION_TO_FIELD.items():
            value, action = _prefer_parsed(row.get(field), parsed.sections.get(section, ""))
            frame.at[idx, field] = value
            if action == "filled":
                filled[field] += 1
            elif action == "rebuilt":
                rebuilt[field] += 1

        # Normalize key identity/source fields without changing their meaning.
        for col in ("generic_name", "source_title", "source_pdf", "source_url"):
            if col in frame.columns and not _is_blank(row.get(col)):
                frame.at[idx, col] = re.sub(r"\s+", " ", str(row.get(col))).strip()

    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False)
    nonempty = {
        field: int((~frame[field].isna() & frame[field].astype(str).str.strip().ne("") & frame[field].astype(str).str.casefold().ne("nan")).sum())
        for field in SECTION_TO_FIELD.values()
    }
    return CleaningReport(
        input_rows=len(frame),
        fields_filled_from_raw=filled,
        fields_rebuilt_from_raw=rebuilt,
        fields_nonempty_after=nonempty,
        output_path=str(output),
    )


def ensure_cleaned_eda_csv() -> CleaningReport | None:
    source = Path(settings.eda_monographs_csv)
    output = Path(settings.eda_monographs_cleaned_csv)
    if not source.exists():
        return None

    if output.exists() and output.stat().st_mtime >= source.stat().st_mtime:
        frame = pd.read_csv(output)
        nonempty = {
            field: int((~frame[field].isna() & frame[field].astype(str).str.strip().ne("") & frame[field].astype(str).str.casefold().ne("nan")).sum())
            for field in SECTION_TO_FIELD.values() if field in frame.columns
        }
        empty_counts = {f: 0 for f in SECTION_TO_FIELD.values()}
        return CleaningReport(len(frame), empty_counts.copy(), empty_counts.copy(), nonempty, str(output))
    return clean_eda_csv(source, output)


def write_cleaning_report(report: CleaningReport, path: str | Path) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
