import json
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.db import Base
from backend.models import RagChunk
from backend.rag.retrieval import retrieve_owned_patient_context, has_patient_context_match
from backend.rag.confidence import score_retrieval_confidence
from backend.rag.types import RetrievedChunk
from backend.rag.patient_context import detect_contexts


def _db():
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _add(db, id, owner, section, text):
    db.add(RagChunk(id=id, source_type='eda_csv', source_title='test', source_path='test', page_number=1,
                    generic_name=owner, section=section, text=text, metadata_json=json.dumps({})))
    db.commit()


def test_owner_is_hard_constraint_for_patient_context():
    db = _db()
    _add(db, 'fel-preg', 'Felodipine', 'Pregnancy and Lactation', 'Pregnancy: Avoid in pregnant women.')
    _add(db, 'keto-int', 'Ketoconazole', 'Drug Interactions', 'Ketoconazole interacts with felodipine.')
    chunks = retrieve_owned_patient_context(db, 'Can a pregnant woman take Felodipine?', 'Felodipine')
    assert chunks and all((c.generic_name or '').casefold() == 'felodipine' for c in chunks)


def test_profile_context_force_includes_matching_owner_evidence():
    db = _db()
    _add(db, 'prop-contra', 'Propranolol', 'Contraindications', 'Acute heart failure. Asthma. Severe bradycardia.')
    _add(db, 'prop-preg', 'Propranolol', 'Pregnancy and Lactation', 'Human data suggest risk in later pregnancy.')
    chunks = retrieve_owned_patient_context(db, 'Can I take propranolol?', 'Propranolol', 'I have asthma')
    assert chunks and has_patient_context_match(chunks)
    assert chunks[0].id == 'prop-contra'


def test_explicit_context_registry_is_drug_agnostic():
    contexts = detect_contexts('Can I take a medicine if I have asthma?', 'question')
    assert any(c.key == 'asthma' for c in contexts)


def test_deterministic_match_bypasses_reranker_threshold():
    c = RetrievedChunk(id='x', text='Asthma is contraindicated.', source_type='eda_csv', source_title='EDA',
                       source_locator='row', section='Contraindications', generic_name='Propranolol',
                       metadata={'deterministic_match': True, 'context_match': True}, reranker_score=0.01)
    result = score_retrieval_confidence(['Propranolol'], [c], [0.01],
                                        question='Can I take propranolol?', intent='patient_context_query')
    assert result.should_refuse_for_low_confidence is False


def test_unregistered_condition_can_force_exact_owner_evidence():
    db = _db()
    _add(db, 'drug-warn', 'ExampleDrug', 'Warnings/Precautions', 'Use caution in patients with psoriasis.')
    chunks = retrieve_owned_patient_context(db, 'Can I take ExampleDrug if I have psoriasis?', 'ExampleDrug')
    assert chunks and chunks[0].metadata.get('context_match') is True
