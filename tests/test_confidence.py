from backend.rag.confidence import score_retrieval_confidence
from backend.rag.types import RetrievedChunk


def chunk(drugs):
    return RetrievedChunk(
        id="x",
        text="evidence",
        source_type="ddinter",
        source_title="test.csv",
        source_locator="row 2",
        metadata={"mentioned_drugs": drugs},
        reranker_score=1.0,
    )


def test_two_drug_cooccurrence_passes():
    c = chunk(["Warfarin", "Aspirin"])
    result = score_retrieval_confidence(["Warfarin", "Aspirin"], [c], [1.0])
    assert result.should_refuse_for_low_confidence is False


def test_two_unrelated_chunks_refuse():
    a = chunk(["Warfarin"])
    a.id = "a"
    b = chunk(["Aspirin"])
    b.id = "b"
    result = score_retrieval_confidence(["Warfarin", "Aspirin"], [a, b], [1.0, 1.0])
    assert result.should_refuse_for_low_confidence is True
    assert any("both named drugs" in reason for reason in result.reasons)
