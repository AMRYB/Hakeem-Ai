from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.config import get_settings
from backend.rag.eda_cleaning import clean_eda_csv, write_cleaning_report


def main():
    settings = get_settings()
    report = clean_eda_csv(settings.eda_monographs_csv, settings.eda_monographs_cleaned_csv)
    write_cleaning_report(report, "./outputs/eda_cleaning_report.json")
    print(f"Wrote: {report.output_path}")
    print("Fields filled from raw_monograph_text:")
    for field, count in report.fields_filled_from_raw.items():
        print(f"  {field}: {count}")
    print("Existing structured fields rebuilt from raw_monograph_text:")
    for field, count in report.fields_rebuilt_from_raw.items():
        print(f"  {field}: {count}")


if __name__ == "__main__":
    main()
