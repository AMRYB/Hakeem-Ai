from backend.rag.confidence import score_retrieval_confidence
from backend.rag.types import RetrievedChunk


def make(section: str, text: str):
    return RetrievedChunk(
        id=section,
        text=text,
        source_type="eda_csv",
        source_title="EDA",
        source_locator="row",
        section=section,
        generic_name="Warfarin",
        metadata={"mentioned_drugs": ["Warfarin"]},
        reranker_score=1.0,
    )


def test_pregnancy_question_requires_pregnancy_relevant_evidence():
    unrelated = make("Adverse Reactions", "Warfarin may cause nausea.")
    result = score_retrieval_confidence(
        ["Warfarin"], [unrelated], [1.0],
        question="Can a pregnant woman take warfarin?",
        intent="patient_context_query",
    )
    assert result.should_refuse_for_low_confidence is True


def test_pregnancy_question_passes_with_pregnancy_section():
    pregnancy = make("Pregnancy and Lactation", "Warfarin is contraindicated in the first trimester.")
    result = score_retrieval_confidence(
        ["Warfarin"], [pregnancy], [1.0],
        question="Can a pregnant woman take warfarin?",
        intent="patient_context_query",
    )
    assert result.should_refuse_for_low_confidence is False
