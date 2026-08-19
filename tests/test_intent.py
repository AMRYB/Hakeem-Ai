from backend.rag.drug_names import DrugExtraction
from backend.rag.intent import detect_intent


def test_two_drugs_is_ddi():
    result = detect_intent("Can I take A with B?", DrugExtraction(["Warfarin", "Aspirin"], []))
    assert result.intent == "ddi_query"


def test_three_drugs_is_multi():
    result = detect_intent("A B C", DrugExtraction(["Warfarin", "Aspirin", "Ibuprofen"], []))
    assert result.intent == "multi_drug_query"


def test_patient_context():
    result = detect_intent("Can I take metformin with kidney disease?", DrugExtraction(["Metformin"], []))
    assert result.intent == "patient_context_query"


def test_unknown_candidate():
    result = detect_intent("Can I take madeupdrug?", DrugExtraction([], ["madeupdrug"]))
    assert result.intent == "unknown_drug"
