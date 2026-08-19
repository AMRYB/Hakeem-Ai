from backend.rag.safety import detect_safety_signal


def test_warfarin_unusual_bleeding_routes_urgent():
    result = detect_safety_signal("I am taking warfarin and I have unusual bleeding. What should I do?")
    assert result["is_urgent"] is True
    assert result["category"] == "bleeding"


def test_normal_ddi_question_does_not_trigger_safety_gate():
    result = detect_safety_signal("Can I take warfarin with aspirin?")
    assert result["is_urgent"] is False
