from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.ai_content_service import (
    AIContentError,
    AIContentService,
    ContentConstraints,
    GenerateHintFromDiagnosisRequest,
    GenerateQuestionVariantRequest,
    RewriteExplanationRequest,
)
from backend.app.data_loader import load_learning_package


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
ERROR_PATTERNS = [
    "ADD_DENOMINATORS",
    "SWAP_MULTIPLIERS",
    "CHANGE_DENOMINATOR_ONLY",
    "USES_PRODUCT_INSTEAD_OF_LCM",
]


def service(*, client=None, api_key: str | None = None) -> AIContentService:
    return AIContentService(
        load_learning_package(DATA_DIR), client=client, api_key=api_key
    )


def question_constraints() -> ContentConstraints:
    return ContentConstraints(
        questionType="multiple_choice",
        difficulty=2,
        denominatorMax=12,
        singleCorrectAnswer=True,
        mustIncludeValidation=True,
        mustIncludeErrorMappings=True,
        allowedPurpose="practice",
        allowedErrorPatterns=ERROR_PATTERNS,
    )


class MockAIClient:
    def __init__(self, response):
        self.response = response
        self.calls: list[tuple[str, dict, float]] = []

    def generate(self, operation, payload, *, timeout):
        self.calls.append((operation, payload, timeout))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_missing_api_key_uses_verified_explanation_fallback_without_calling_client() -> None:
    client = MockAIClient({"content": "AI content should not be used."})
    ai = service(client=client)
    source = ai.verified_explanation("EXP_F11_BASIC")

    result = ai.rewrite_explanation(
        RewriteExplanationRequest(
            skillId="F11",
            sourceContent=source,
            style="short",
            constraints=ContentConstraints(maxSentences=2),
        )
    )

    assert result.fallbackUsed is True
    assert result.generated is False
    assert result.content.startswith("Muốn cộng hoặc so sánh")
    assert client.calls == []


def test_explanation_fallback_respects_constraints() -> None:
    client = MockAIClient({"not_content": "Provider output is invalid."})
    ai = service(client=client, api_key="mock-key")

    result = ai.rewrite_explanation(
        RewriteExplanationRequest(
            skillId="F11",
            sourceContent=ai.verified_explanation("EXP_F11_BASIC"),
            style="short",
            constraints=ContentConstraints(maxWords=10, maxSentences=1),
        )
    )

    assert result.fallbackUsed is True
    assert len(result.content.split()) <= 10
    assert "quy đồng" in result.content.lower()
    assert "mẫu" in result.content.lower()
    assert "tính" in result.content.lower()
    assert client.calls[0][0] == "rewrite_explanation"


def test_mock_ai_question_is_structured_and_validated() -> None:
    client = MockAIClient(
        {
            "id": "AI_F11_VARIANT_001",
            "skillId": "F11",
            "purpose": "practice",
            "type": "multiple_choice",
            "difficulty": 2,
            "prompt": "Quy đồng 1/3 và 1/4 về mẫu số 12. Cặp phân số đúng là gì?",
            "options": [
                {"id": "A", "text": "4/12 và 3/12"},
                {"id": "B", "text": "3/12 và 4/12"},
                {"id": "C", "text": "1/12 và 1/12"},
                {"id": "D", "text": "2/12 và 2/12"},
            ],
            "validation": {"correctAnswer": "A"},
            "errorMappings": {
                "B": "SWAP_MULTIPLIERS",
                "C": "CHANGE_DENOMINATOR_ONLY",
                "D": "ADD_DENOMINATORS",
            },
        }
    )
    ai = service(client=client, api_key="mock-key")

    result = ai.generate_question_variant(
        GenerateQuestionVariantRequest(
            skillId="F11",
            sourceContent=ai.verified_question("P_F11_002"),
            style="step_by_step",
            constraints=question_constraints(),
        )
    )

    assert result.skillId == "F11"
    assert result.difficulty == 2
    assert result.validation["correctAnswer"] == "A"
    assert result.generated is True
    assert result.fallbackUsed is False
    assert client.calls[0][0] == "generate_question_variant"


@pytest.mark.parametrize(
    "response",
    [
        {
            "id": "bad-skill",
            "skillId": "F08",
            "purpose": "practice",
            "type": "multiple_choice",
            "difficulty": 2,
            "prompt": "Câu hỏi sai skill.",
            "options": [{"id": "A", "text": "1"}, {"id": "B", "text": "2"}],
            "validation": {"correctAnswer": "A"},
            "errorMappings": {"B": "ADD_DENOMINATORS"},
        },
        {
            "id": "bad-denominator",
            "skillId": "F11",
            "purpose": "practice",
            "type": "multiple_choice",
            "difficulty": 2,
            "prompt": "Quy đồng 1/13 và 1/2.",
            "options": [{"id": "A", "text": "2/26"}, {"id": "B", "text": "1/13"}],
            "validation": {"correctAnswer": "A"},
            "errorMappings": {"B": "ADD_DENOMINATORS"},
        },
    ],
)
def test_invalid_ai_question_falls_back_to_package_question(response) -> None:
    client = MockAIClient(response)
    ai = service(client=client, api_key="mock-key")

    result = ai.generate_question_variant(
        GenerateQuestionVariantRequest(
            skillId="F11",
            sourceContent=ai.verified_question("P_F11_002"),
            style="short",
            constraints=question_constraints(),
        )
    )

    assert result.fallbackUsed is True
    assert result.generated is False
    assert result.skillId == "F11"
    assert result.difficulty == 2
    assert result.validation["correctAnswer"] == "A"


def test_equivalent_fraction_options_are_rejected_as_multiple_correct_answers() -> None:
    client = MockAIClient(
        {
            "id": "two-correct",
            "skillId": "F11",
            "purpose": "practice",
            "type": "multiple_choice",
            "difficulty": 2,
            "prompt": "Phân số nào tương đương với 1/2?",
            "options": [
                {"id": "A", "text": "2/4"},
                {"id": "B", "text": "3/6"},
                {"id": "C", "text": "1/3"},
                {"id": "D", "text": "2/3"},
            ],
            "validation": {"correctAnswer": "A"},
            "errorMappings": {
                "B": "SWAP_MULTIPLIERS",
                "C": "CHANGE_DENOMINATOR_ONLY",
                "D": "ADD_DENOMINATORS",
            },
        }
    )
    ai = service(client=client, api_key="mock-key")

    result = ai.generate_question_variant(
        GenerateQuestionVariantRequest(
            skillId="F11",
            sourceContent=ai.verified_question("P_F11_002"),
            style="short",
            constraints=question_constraints(),
        )
    )

    assert result.fallbackUsed is True
    assert result.id == "P_F11_002"


def test_timeout_and_invalid_hint_fall_back_to_diagnostic_template() -> None:
    client = MockAIClient(TimeoutError("provider timed out"))
    ai = service(client=client, api_key="mock-key")
    source = ai.verified_diagnosis(
        "diag-001",
        skill_id="F11",
        confidence=0.87,
        root_gap_skill_id="F11",
        last_error_pattern="ADD_DENOMINATORS",
        evidence=[
            {
                "type": "incorrect_diagnostic_answer",
                "skillId": "F11",
                "message": "Học sinh tìm sai mẫu số chung.",
            }
        ],
    )

    result = ai.generate_hint_from_diagnosis(
        GenerateHintFromDiagnosisRequest(
            skillId="F11",
            sourceContent=source,
            style="short",
            constraints=ContentConstraints(maxSentences=2),
        )
    )

    assert result.fallbackUsed is True
    assert result.message == (
        "Hãy thử tìm mẫu số chung trước, rồi đổi từng phân số về mẫu số đó."
    )


def test_hint_fallback_respects_constraints() -> None:
    client = MockAIClient({"not_message": "Provider output is invalid."})
    ai = service(client=client, api_key="mock-key")
    source = ai.verified_diagnosis(
        "diag-constrained",
        skill_id="F11",
        confidence=0.87,
        root_gap_skill_id="F11",
        evidence=[
            {
                "type": "incorrect_diagnostic_answer",
                "skillId": "F11",
                "message": "Học sinh tìm sai mẫu số chung.",
            }
        ],
    )

    result = ai.generate_hint_from_diagnosis(
        GenerateHintFromDiagnosisRequest(
            skillId="F11",
            sourceContent=source,
            style="short",
            constraints=ContentConstraints(maxWords=9, maxSentences=1),
        )
    )

    assert result.fallbackUsed is True
    assert len(result.message.split()) <= 9
    assert "mẫu chung" in result.message.lower()
    assert "đổi" in result.message.lower()
    assert client.calls[0][0] == "generate_hint_from_diagnosis"


def test_hint_without_skill_template_uses_verified_skill_explanation() -> None:
    ai = service(api_key="")
    source = ai.verified_diagnosis(
        "diag-f08-fallback",
        skill_id="F08",
        confidence=0.82,
        root_gap_skill_id="F08",
        evidence=[
            {
                "type": "incorrect_diagnostic_answer",
                "skillId": "F08",
                "message": "Học sinh chưa chắc cách tạo phân số tương đương.",
            }
        ],
    )

    result = ai.generate_hint_from_diagnosis(
        GenerateHintFromDiagnosisRequest(
            skillId="F08",
            sourceContent=source,
            style="short",
            constraints=ContentConstraints(maxWords=30, maxSentences=2),
        )
    )

    assert result.generated is False
    assert result.fallbackUsed is True
    assert result.skillId == "F08"
    assert "phân số tương đương" in result.message.lower()


def test_tampered_source_is_rejected_before_provider_call() -> None:
    ai = service()
    source = ai.verified_explanation("EXP_F11_BASIC").model_copy(
        update={"content": "Nội dung đã bị sửa."}
    )

    with pytest.raises(AIContentError, match="chưa được xác thực"):
        ai.rewrite_explanation(
            RewriteExplanationRequest(
                skillId="F11",
                sourceContent=source,
                style="short",
                constraints=ContentConstraints(),
            )
        )
