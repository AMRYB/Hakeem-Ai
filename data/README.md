# Put your medical data here

The repository intentionally does **not** include your large medical datasets.
Place them exactly like this before running ingestion:

```text
data/
├── ddinter/
│   ├── ddinter_downloads_code_A.csv
│   ├── ddinter_downloads_code_B.csv
│   ├── ddinter_downloads_code_D.csv
│   ├── ddinter_downloads_code_H.csv
│   ├── ddinter_downloads_code_L.csv
│   ├── ddinter_downloads_code_P.csv
│   ├── ddinter_downloads_code_R.csv
│   └── ddinter_downloads_code_V.csv
├── egypt/
│   └── eda_all_drug_monographs.csv
└── formulary/
    ├── <Egyptian National Formulary PDF 1>.pdf
    ├── <Egyptian National Formulary PDF 2>.pdf
    └── ...
```

You may add more `ddinter_downloads_code_*.csv` files; the glob picks them up automatically.
The formulary loader ingests every PDF directly inside `data/formulary/`.
