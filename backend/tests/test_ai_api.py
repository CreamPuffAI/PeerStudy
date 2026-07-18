from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.ai_content_service import AIContentService


class MockAIClient:
    def __init__(self, response: Any) -> None:
        self.response = response
        self.calls: list[tuple[str, dict[str, Any], float]] = []

    def generate(
        self, operation: str, payload: dict[str, Any], *, timeout: float
    ) -> Any:
        self.calls.append((operation, payload, timeout))
        return self.response


@pytest.fixture(autouse=True)
def reset_sessions() -> None:
    main.mastery_state = main._initial_mastery()
    main.attempts_by_event_id.clear()
    main.attempt_event_snapshots.clear()
    main.diagnosis_sessions.clear()
    main.sync_event_ids.clear()
    main.sync_event_state.clear()
    main.runtime_event_state.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def install_ai_service(
    monkeypatch: pytest.MonkeyPatch, response: Any
) -> MockAIClient:
    provider = MockAIClient(response)
    service = AIContentService(
        main.runtime_data["learning_package"],
        client=provider,
        api_key="test-key",
        timeout_seconds=3.0,
    )
    monkeypatch.setattr(main, "ai_content_service", service)
    return provider


def test_rewrite_explanation_endpoint_uses_contract_envelope(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = install_ai_service(
        monkeypatch,
        {
            "id": "AI_EXP_F11_SHORT",
            "skillId": "F11",
            "style": "short",
            "content": "Tìm mẫu chung rồi quy đồng từng phân số.",
        },
    )

    response = client.post(
        "/api/v1/ai/rewrite-explanation",
        json={
            "packageId": "math-fractions-v1",
            "skillId": "F11",
            "contentId": "EXP_F11_BASIC",
            "style": "short",
            "constraints": {"maxSentences": 2, "maxWords": 20},
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {
            "id": "AI_EXP_F11_SHORT",
            "skillId": "F11",
            "sourceContentId": "EXP_F11_BASIC",
            "style": "short",
            "content": "Tìm mẫu chung rồi quy đồng từng phân số.",
            "generated": True,
            "fallbackUsed": False,
        },
    }
    assert provider.calls[0][0] == "rewrite_explanation"


def test_question_variant_endpoint_validates_provider_output(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ai_service(
        monkeypatch,
        {
            "id": "AI_F11_VARIANT_001",
            "skillId": "F11",
            "purpose": "practice",
            "type": "multiple_choice",
            "difficulty": 2,
            "prompt": "Quy đồng 1/3 và 1/4 về mẫu số 12.",
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
        },
    )

    response = client.post(
        "/api/v1/ai/generate-question-variant",
        json={
            "packageId": "math-fractions-v1",
            "skillId": "F11",
            "questionId": "P_F11_002",
            "style": "step_by_step",
            "constraints": {
                "questionType": "multiple_choice",
                "difficulty": 2,
                "denominatorMax": 12,
                "singleCorrectAnswer": True,
                "mustIncludeValidation": True,
                "mustIncludeErrorMappings": True,
                "allowedPurpose": "practice",
                "allowedErrorPatterns": [
                    "ADD_DENOMINATORS",
                    "SWAP_MULTIPLIERS",
                    "CHANGE_DENOMINATOR_ONLY",
                    "USES_PRODUCT_INSTEAD_OF_LCM",
                ],
            },
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["generated"] is True
    assert data["fallbackUsed"] is False
    assert data["sourceQuestionId"] == "P_F11_002"
    assert data["validation"] == {"correctAnswer": "A"}


def test_diagnosis_hint_uses_only_completed_engine_diagnosis(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = install_ai_service(
        monkeypatch,
        {
            "id": "AI_HINT_DIAG_001",
            "skillId": "F11",
            "style": "short",
            "message": "Hãy tìm mẫu số chung trước rồi quy đồng.",
        },
    )
    main.diagnosis_sessions["diag-ai-001"] = {
        "id": "diag-ai-001",
        "status": "completed",
        "triggerErrorPattern": "ADD_DENOMINATORS",
        "diagnosis": {
            "rootGap": {"skillId": "F11", "name": "Quy đồng mẫu số", "grade": 5},
            "confidence": 0.87,
            "classification": "knowledge_gap",
            "evidence": [
                {
                    "type": "incorrect_diagnostic_answer",
                    "skillId": "F11",
                    "message": "Học sinh tìm sai mẫu số chung.",
                }
            ],
        },
    }

    response = client.post(
        "/api/v1/ai/generate-diagnosis-hint",
        json={
            "packageId": "math-fractions-v1",
            "diagnosisSessionId": "diag-ai-001",
            "style": "short",
            "constraints": {"maxSentences": 2, "maxWords": 20},
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["skillId"] == "F11"
    assert data["sourceContentId"] == "diag-ai-001"
    provider_payload = provider.calls[0][1]
    assert provider_payload["sourceContent"]["content"]["rootGapSkillId"] == "F11"
    assert "mastery" not in str(provider_payload).lower()


def test_invalid_provider_output_falls_back_without_breaking_response(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ai_service(monkeypatch, {"unexpected": "output"})

    response = client.post(
        "/api/v1/ai/rewrite-explanation",
        json={
            "packageId": "math-fractions-v1",
            "skillId": "F11",
            "contentId": "EXP_F11_BASIC",
            "style": "short",
            "constraints": {"maxSentences": 2},
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["generated"] is False
    assert data["fallbackUsed"] is True


def test_ai_source_mismatch_uses_contract_error_shape(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ai_service(monkeypatch, {"content": "Không được dùng."})

    response = client.post(
        "/api/v1/ai/rewrite-explanation",
        json={
            "packageId": "math-fractions-v1",
            "skillId": "F08",
            "contentId": "EXP_F11_BASIC",
            "style": "short",
            "constraints": {},
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "AI_CONTENT_ERROR"


def test_hint_rejects_in_progress_session_before_provider_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = install_ai_service(monkeypatch, {"message": "Không được gọi."})
    main.diagnosis_sessions["diag-in-progress"] = {
        "id": "diag-in-progress",
        "status": "in_progress",
    }

    response = client.post(
        "/api/v1/ai/generate-diagnosis-hint",
        json={
            "packageId": "math-fractions-v1",
            "diagnosisSessionId": "diag-in-progress",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AI_HINT_NOT_READY"
    assert provider.calls == []


def test_golden_flow_diagnosis_hint_learning_path_and_dashboard_without_provider(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def post_attempt(
        event_id: str,
        question_id: str,
        purpose: str,
        answer_type: str,
        answer_value: str,
        *,
        diagnosis_session_id: str | None = None,
        learning_path_id: str | None = None,
        learning_step_id: str | None = None,
    ) -> dict[str, Any]:
        response = client.post(
            "/api/v1/attempts",
            json={
                "eventId": event_id,
                "studentId": "student-001",
                "classId": "class-7a",
                "packageId": "math-fractions-v1",
                "questionId": question_id,
                "purpose": purpose,
                "context": {
                    "diagnosisSessionId": diagnosis_session_id,
                    "learningPathId": learning_path_id,
                    "learningStepId": learning_step_id,
                },
                "answer": {"type": answer_type, "value": answer_value},
                "responseTimeMs": 4200,
                "attemptNumber": 1,
                "deviceTimestamp": "2026-07-19T00:00:00Z",
                "offlineCreated": False,
            },
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    trigger = post_attempt(
        "golden-trigger",
        "Q_E01_001",
        "target",
        "multiple_choice",
        "B",
    )
    session_id = trigger["next"]["diagnosisSessionId"]
    post_attempt("golden-dq-f08", "DQ_F08_001", "diagnostic", "multiple_choice", "A", diagnosis_session_id=session_id)
    post_attempt("golden-dq-f11-2", "DQ_F11_002", "diagnostic", "multiple_choice", "B", diagnosis_session_id=session_id)
    post_attempt("golden-dq-f11-3", "DQ_F11_003", "diagnostic", "multiple_choice", "D", diagnosis_session_id=session_id)

    diagnosis = client.get(f"/api/v1/diagnosis-sessions/{session_id}").json()["data"]
    assert diagnosis["diagnosis"]["rootGap"]["skillId"] == "F11"
    assert diagnosis["next"] == {"action": "start_learning_path", "learningPathId": "lp-001"}

    fallback_service = AIContentService(
        main.runtime_data["learning_package"], client=None, api_key=""
    )
    monkeypatch.setattr(main, "ai_content_service", fallback_service)
    hint = client.post(
        "/api/v1/ai/generate-diagnosis-hint",
        json={
            "packageId": "math-fractions-v1",
            "diagnosisSessionId": session_id,
            "style": "short",
            "constraints": {"maxSentences": 2, "maxWords": 30},
        },
    )
    assert hint.status_code == 200
    assert hint.json()["data"]["fallbackUsed"] is True

    post_attempt(
        "golden-practice",
        "P_F11_001",
        "practice",
        "multiple_choice",
        "B",
        learning_path_id="lp-001",
        learning_step_id="step-3",
    )
    post_attempt(
        "golden-practice-2",
        "P_F11_002",
        "practice",
        "multiple_choice",
        "A",
        learning_path_id="lp-001",
        learning_step_id="step-3",
    )
    post_attempt(
        "golden-checkpoint",
        "CP_F11_001",
        "checkpoint",
        "multiple_choice",
        "A",
        learning_path_id="lp-001",
        learning_step_id="step-4",
    )
    post_attempt(
        "golden-return-target",
        "Q_E01_RETRY_001",
        "target",
        "multiple_choice",
        "A",
        learning_path_id="lp-001",
        learning_step_id="step-5",
    )

    dashboard = client.get(
        "/api/v1/classes/class-7a/insights",
        params={"packageId": "math-fractions-v1"},
    )
    assert dashboard.status_code == 200
    assert dashboard.json()["data"]["syncStatus"]["syncedStudents"] >= 32
