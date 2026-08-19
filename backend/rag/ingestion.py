from __future__ import annotations

import glob
import hashlib
import json
import re
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError:  # compatibility with older environments
    import fitz  # type: ignore
import pandas as pd
from sqlalchemy import delete
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.models import DdiPair, RagChunk
from backend.rag.drug_names import refresh_known_drugs
from backend.rag.embeddings import get_embedding_provider
from backend.rag.monograph_parser import SECTION_TO_FIELD, split_for_rag
from backend.rag.normalization import canonical_pair
from backend.rag.vector_store import get_vector_store

settings = get_settings()

SECTION_FIELDS = {field: section for section, field in SECTION_TO_FIELD.items()}


def _stable_id(*parts: str) -> str:
    return hashlib.sha256("||".join(parts).encode("utf-8")).hexdigest()[:40]


def _clean(value) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _eda_csv_path() -> Path:
    cleaned = Path(settings.eda_monographs_cleaned_csv)
    if cleaned.exists():
        return cleaned
    return Path(settings.eda_monographs_csv)


def ingest_ddinter(db: Session, reset: bool = False) -> int:
    if reset:
        db.execute(delete(DdiPair))
        db.commit()
    count = 0
    for file_name in sorted(glob.glob(settings.ddinter_glob)):
        path = Path(file_name)
        frame = pd.read_csv(path)
        required = {"DDInterID_A", "Drug_A", "DDInterID_B", "Drug_B", "Level"}
        missing = required - set(frame.columns)
        if missing:
            raise ValueError(f"{path.name} is missing columns: {sorted(missing)}")
        for idx, row in frame.iterrows():
            a, b = canonical_pair(str(row["Drug_A"]), str(row["Drug_B"]))
            exists = db.query(DdiPair.id).filter(DdiPair.normalized_a == a, DdiPair.normalized_b == b).first()
            if exists:
                continue
            db.add(
                DdiPair(
                    ddinter_id_a=str(row["DDInterID_A"]),
                    drug_a=str(row["Drug_A"]),
                    ddinter_id_b=str(row["DDInterID_B"]),
                    drug_b=str(row["Drug_B"]),
                    level=str(row["Level"]),
                    normalized_a=a,
                    normalized_b=b,
                    source_file=path.name,
                    source_row=int(idx) + 2,
                )
            )
            count += 1
            if count % 5000 == 0:
                db.commit()
        db.commit()
    refresh_known_drugs()
    return count


def csv_monograph_chunks() -> list[RagChunk]:
    path = _eda_csv_path()
    if not path.exists():
        return []
    frame = pd.read_csv(path)
    if "generic_name" not in frame.columns:
        raise ValueError("EDA monograph CSV must contain generic_name")
    chunks: list[RagChunk] = []
    for row_index, row in frame.iterrows():
        generic = _clean(row.get("generic_name"))
        if not generic:
            continue

        source_title = _clean(row.get("source_title")) or "EDA Drug Monographs"
        source_pdf = _clean(row.get("source_pdf"))
        source_year = _clean(row.get("source_year"))
        page_start = _clean(row.get("source_page_start"))
        page_end = _clean(row.get("source_page_end"))
        source_path = source_pdf or str(path)

        populated_sections: set[str] = set()
        for field, section in SECTION_FIELDS.items():
            value = _clean(row.get(field))
            if value:
                populated_sections.add(section)
                metadata = {
                    "row": int(row_index) + 2,
                    "field": field,
                    "source_year": source_year,
                    "source_pdf": source_pdf,
                    "source_page_start": page_start,
                    "source_page_end": page_end,
                }
                chunks.append(
                    RagChunk(
                        id=_stable_id(path.name, str(row_index), generic, section, value[:120]),
                        source_type="eda_csv",
                        source_title=source_title,
                        source_path=source_path,
                        page_number=int(float(page_start)) if page_start and page_start.replace('.', '', 1).isdigit() else None,
                        generic_name=generic,
                        section=section,
                        text=value,
                        metadata_json=json.dumps(metadata),
                    )
                )

        raw = str(row.get("raw_monograph_text") or "")
        if raw and raw.lower() != "nan":
            for section, body in split_for_rag(raw):
                # The cleaner fills structured columns from raw text. Do not index a
                # duplicate raw chunk when the same clinical section is already
                # represented structurally; this reduces retrieval noise.
                if section in populated_sections:
                    continue
                chunks.append(
                    RagChunk(
                        id=_stable_id(path.name, str(row_index), generic, "raw", section, body[:120]),
                        source_type="eda_csv_raw",
                        source_title=f"{source_title} — Raw Monograph",
                        source_path=source_path,
                        page_number=int(float(page_start)) if page_start and page_start.replace('.', '', 1).isdigit() else None,
                        generic_name=generic,
                        section=section,
                        text=body,
                        metadata_json=json.dumps(
                            {
                                "row": int(row_index) + 2,
                                "field": "raw_monograph_text",
                                "source_year": source_year,
                                "source_pdf": source_pdf,
                                "source_page_start": page_start,
                                "source_page_end": page_end,
                            }
                        ),
                    )
                )
    return chunks


def pdf_chunks() -> list[RagChunk]:
    root = Path(settings.formulary_dir)
    eda_pdf_root = Path(settings.eda_monographs_csv).parent
    paths = set()
    if root.exists():
        paths.update(root.glob("*.pdf"))
    if eda_pdf_root.exists():
        paths.update(eda_pdf_root.glob("*.pdf"))
    if not paths:
        return []
    chunks: list[RagChunk] = []
    for path in sorted(paths):
        doc = fitz.open(path)
        current_section = "General"
        for page_index, page in enumerate(doc):
            page_text = page.get_text("text") or ""
            split = split_for_rag(page_text)
            for section, body in split:
                if section != "General":
                    current_section = section
                effective = current_section if section == "General" else section
                if len(body.strip()) < 25:
                    continue
                chunks.append(
                    RagChunk(
                        id=_stable_id(path.name, str(page_index + 1), effective, body[:160]),
                        source_type="formulary_pdf",
                        source_title=path.stem,
                        source_path=str(path),
                        page_number=page_index + 1,
                        generic_name=None,
                        section=effective,
                        text=body.strip(),
                        metadata_json=json.dumps({"pdf": path.name}),
                    )
                )
        doc.close()
    return chunks


def _infer_generic_names(db: Session, chunks: list[RagChunk]) -> None:
    names = sorted(
        {x for row in db.query(DdiPair.drug_a, DdiPair.drug_b).all() for x in row if x},
        key=len,
        reverse=True,
    )
    for chunk in chunks:
        if chunk.generic_name:
            continue
        lowered = chunk.text.casefold()
        title = chunk.source_title.casefold()
        for name in names:
            n = name.casefold()
            if re.search(rf"(?<![\w-]){re.escape(n)}(?![\w-])", lowered) or n in title:
                chunk.generic_name = name
                meta = json.loads(chunk.metadata_json or "{}")
                meta["inferred_generic_name"] = name
                chunk.metadata_json = json.dumps(meta)
                break


def ingest_chunks(db: Session, reset: bool = False) -> int:
    store = get_vector_store()
    if reset:
        db.execute(delete(RagChunk))
        db.commit()
        store.reset()
    chunks = csv_monograph_chunks() + pdf_chunks()
    _infer_generic_names(db, chunks)
    new_chunks: list[RagChunk] = []
    for chunk in chunks:
        if db.get(RagChunk, chunk.id):
            continue
        db.add(chunk)
        new_chunks.append(chunk)
    db.commit()

    provider = get_embedding_provider()
    batch_size = settings.embedding_batch_size
    total = len(new_chunks)
    for i in range(0, total, batch_size):
        batch = new_chunks[i : i + batch_size]
        embeddings = provider.embed([c.text for c in batch])
        store.upsert(batch, embeddings)
        done = min(i + len(batch), total)
        if total:
            print(f"Embedding RAG chunks: {done}/{total} ({done / total:.0%})", flush=True)
    refresh_known_drugs()
    return len(new_chunks)
