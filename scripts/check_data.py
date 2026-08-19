from __future__ import annotations

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import glob
import pandas as pd

from backend.config import get_settings

settings = get_settings()


def main() -> int:
    problems = []
    ddinter_files = sorted(glob.glob(settings.ddinter_glob))
    if not ddinter_files:
        problems.append(f"No DDInter CSV files found at: {settings.ddinter_glob}")
    else:
        print(f"DDInter files: {len(ddinter_files)}")
        for name in ddinter_files:
            df = pd.read_csv(name, nrows=5)
            required = {"DDInterID_A", "Drug_A", "DDInterID_B", "Drug_B", "Level"}
            missing = required - set(df.columns)
            print(f"  - {Path(name).name}: columns OK={not missing}")
            if missing:
                problems.append(f"{name}: missing {sorted(missing)}")

    eda = Path(settings.eda_monographs_csv)
    if not eda.exists():
        problems.append(f"EDA CSV not found: {eda}")
    else:
        df = pd.read_csv(eda, nrows=5)
        print(f"EDA CSV: {eda.name}; generic_name={'generic_name' in df.columns}; raw_monograph_text={'raw_monograph_text' in df.columns}")
        if "generic_name" not in df.columns or "raw_monograph_text" not in df.columns:
            problems.append("EDA CSV must contain generic_name and raw_monograph_text")

    cleaned = Path(settings.eda_monographs_cleaned_csv)
    print(f"Cleaned EDA CSV: {'present' if cleaned.exists() else 'will be generated automatically during ingestion'}")

    aliases = Path(settings.drug_aliases_csv)
    if not aliases.exists():
        problems.append(f"Drug alias CSV not found: {aliases}")
    else:
        alias_df = pd.read_csv(aliases)
        required_alias = {"alias", "canonical_name"}
        missing = required_alias - set(alias_df.columns)
        print(f"Drug aliases: {len(alias_df)} rows; columns OK={not missing}")
        if missing:
            problems.append(f"Alias CSV missing {sorted(missing)}")

    pdf_dir = Path(settings.formulary_dir)
    pdfs = list(pdf_dir.glob("*.pdf")) if pdf_dir.exists() else []
    print(f"Formulary PDFs: {len(pdfs)}")
    if not pdfs:
        problems.append(f"No formulary PDFs found in: {pdf_dir}")

    if problems:
        print("\nData check problems:")
        for p in problems:
            print(f"- {p}")
        return 1
    print("\nData layout looks ready for preprocessing + ingestion.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
