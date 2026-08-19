from backend.rag.aliases import alias_map, aliases_for_canonical
from backend.rag.normalization import normalize_drug_name


def test_core_aliases_are_available():
    mapping = alias_map()
    assert mapping[normalize_drug_name("Panadol")] == "Acetaminophen"
    assert mapping[normalize_drug_name("Aspirin")] == "Acetylsalicylic acid"
    assert mapping[normalize_drug_name("Antinal")] == "Nifuroxazide"
    assert normalize_drug_name("Paracetamol") in aliases_for_canonical("Acetaminophen")
