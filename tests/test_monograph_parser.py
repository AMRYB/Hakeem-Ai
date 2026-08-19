from backend.rag.monograph_parser import parse_monograph_sections


def test_split_eda_headings_capture_pregnancy_and_not_following_sections():
    raw = """
Indications      Test indication
Dosage           Adult dosing
Regimen
Contra-          Do not use in allergy
Indications
Drug             Risk X: Avoid combination
Interactions     ExampleDrug
Pregnancy and    Pregnancy
Lactation        Contraindicated in the first trimester. May be considered for a specific exception.
Administration   Oral with water.
Warnings/        Monitor closely.
Storage          Store below 30 C.
"""
    parsed = parse_monograph_sections(raw)
    pregnancy = parsed.sections["Pregnancy and Lactation"]
    assert "first trimester" in pregnancy
    assert "Oral with water" not in pregnancy
    assert parsed.sections["Administration"].startswith("Oral with water")


def test_page_code_is_removed():
    raw = """
Drug Interactions  Risk D: Consider modification
Pregnancy          Pregnancy advice.
62 Code: EDA.DUPP. Formulary.005
Administration     Oral.
"""
    parsed = parse_monograph_sections(raw)
    assert "Code: EDA" not in parsed.sections["Pregnancy and Lactation"]
