from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import argparse

from backend.db import SessionLocal, init_db
from backend.rag.eda_cleaning import ensure_cleaned_eda_csv, write_cleaning_report
from backend.rag.ingestion import ingest_chunks, ingest_ddinter


def main():
    parser = argparse.ArgumentParser(description="Ingest DDInter, cleaned EDA monographs and formulary PDFs")
    parser.add_argument("--reset", action="store_true", help="Clear existing corpus tables before ingesting")
    parser.add_argument("--skip-ddinter", action="store_true")
    parser.add_argument("--skip-rag", action="store_true")
    parser.add_argument("--skip-clean", action="store_true", help="Skip automatic EDA CSV preprocessing")
    args = parser.parse_args()

    init_db()
    if not args.skip_clean and not args.skip_rag:
        report = ensure_cleaned_eda_csv()
        if report:
            write_cleaning_report(report, "./outputs/eda_cleaning_report.json")
            filled = sum(report.fields_filled_from_raw.values())
            rebuilt = sum(report.fields_rebuilt_from_raw.values())
            print(f"EDA preprocessing ready: {report.output_path} (filled {filled} missing fields; rebuilt {rebuilt} noisy structured fields from raw text)")

    with SessionLocal() as db:
        if not args.skip_ddinter:
            count = ingest_ddinter(db, reset=args.reset)
            print(f"DDInter rows inserted: {count}")
        if not args.skip_rag:
            count = ingest_chunks(db, reset=args.reset)
            print(f"RAG chunks inserted + embedded: {count}")


if __name__ == "__main__":
    main()
