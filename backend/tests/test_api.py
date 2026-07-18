from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import main


def reset_runtime_state() -> None:
    main.mastery_state = main._initial_mastery()
    main.attempts_by_event_id.clear()
    main.attempt_event_snapshots.clear()
    main.diagnosis_sessions.clear()
    main.sync_event_ids.clear()
    main.sync_event_state.clear()
    main.runtime_event_state.clear()


@pytest.fixture(autouse=True)
def reset_state() -> None:
    reset_runtime_state()


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def attempt_payload(
    *,
    event_id: str,
    student_id: str = "student-001",
    question_id: str = "Q_E01_001",
    purpose: str = "target",
    answer_type: str = "multiple_choice",
    answer_value: str = "B",
    diagnosis_session_id: str | None = None,
    response_time_ms: int = 4200,
) -> dict:
    return {
        "eventId": event_id,
        "studentId": student_id,
        "classId": "class-7a",
        "packageId": "math-fractions-v1",
        "questionId": question_id,
        "purpose": purpose,
        "context": {
            "diagnosisSessionId": diagnosis_session_id,
            "learningPathId": None,
            "learningStepId": None,
        },
        "answer": {"type": answer_type, "value": answer_value},
        "responseTimeMs": response_time_ms,
        "attemptNumber": 1,
        "deviceTimestamp": "2026-07-17T10:15:24Z",
        "offlineCreated": False,
    }


def post_attempt(client: TestClient, payload: dict) -> dict:
    response = client.post("/api/v1/attempts", json=payload)
    assert response.status_code == 200, response.json()
    return response.json()["data"]


def test_get_learning_package_success_and_not_found(client: TestClient) -> None:
    response = client.get("/api/v1/learning-packages/math-fractions-v1")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["packageId"] == "math-fractions-v1"
    assert body["data"]["version"] == 3
    assert body["data"]["diagnosticRulesVersion"] == 2

    missing = client.get("/api/v1/learning-packages/missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PACKAGE_NOT_FOUND"


def test_timestamps_require_utc_and_normalize_to_utc() -> None:
    payload = attempt_payload(event_id="evt-utc", response_time_ms=0)
    payload["deviceTimestamp"] = "2026-07-17T10:15:24+00:00"
    request = main.AttemptRequest.model_validate(payload)
    assert request.deviceTimestamp == datetime(2026, 7, 17, 10, 15, 24, tzinfo=UTC)
    assert request.model_dump(mode="json")["deviceTimestamp"].endswith("Z")

    event = main.SyncEvent(
        eventId="sync-utc",
        type="learning_path_completed",
        createdAt="2026-07-17T10:15:24Z",
        payload={},
    )
    assert event.createdAt.tzinfo is UTC

    for timestamp in (
        "2026-07-17T10:15:24",
        "2026-07-17T10:15:24+07:00",
    ):
        with pytest.raises(ValidationError):
            main.AttemptRequest.model_validate(
                {**payload, "deviceTimestamp": timestamp}
            )
        with pytest.raises(ValidationError):
            main.SyncEvent(
                eventId="sync-invalid",
                type="learning_path_completed",
                createdAt=timestamp,
                payload={},
            )


def assert_invalid_request_response(response) -> dict:
    assert response.status_code == 422
    body = response.json()
    json.dumps(body)
    assert body["success"] is False
    assert body["error"]["code"] == "INVALID_REQUEST"
    assert isinstance(body["error"]["message"], str)
    assert isinstance(body["error"]["details"], dict)
    return body


def sync_question_payload(created_at: str) -> dict:
    return {
        "deviceId": "device-001",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [
            {
                "eventId": "sync-malformed",
                "type": "question_attempted",
                "createdAt": created_at,
                "payload": {
                    "questionId": "Q_E01_001",
                    "purpose": "target",
                    "answer": {"type": "multiple_choice", "value": "B"},
                    "responseTimeMs": 4200,
                },
            }
        ],
    }


def test_attempt_missing_timezone_returns_contract_422(client: TestClient) -> None:
    payload = attempt_payload(event_id="evt-missing-timezone")
    payload["deviceTimestamp"] = "2026-07-17T10:15:24"

    body = assert_invalid_request_response(
        client.post("/api/v1/attempts", json=payload)
    )
    assert body["error"]["details"]["errors"][0]["type"] == "value_error"


def test_attempt_bad_response_time_returns_contract_422(client: TestClient) -> None:
    payload = attempt_payload(event_id="evt-bad-response-time")
    payload["responseTimeMs"] = "bad"

    assert_invalid_request_response(client.post("/api/v1/attempts", json=payload))


def test_sync_missing_timezone_returns_contract_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/sync",
        json=sync_question_payload("2026-07-17T10:15:24"),
    )

    assert_invalid_request_response(response)


def test_endpoint_accepts_utc_timestamps(client: TestClient) -> None:
    attempt = attempt_payload(event_id="evt-valid-utc")
    attempt["deviceTimestamp"] = "2026-07-17T10:15:24+00:00"
    attempt_response = client.post("/api/v1/attempts", json=attempt)
    assert attempt_response.status_code == 200
    assert attempt_response.json()["success"] is True

    sync_response = client.post(
        "/api/v1/sync",
        json=sync_question_payload("2026-07-17T10:15:24+00:00"),
    )
    assert sync_response.status_code == 200
    assert sync_response.json()["success"] is True


def test_wrong_target_attempt_starts_diagnostic_and_is_idempotent(
    client: TestClient,
) -> None:
    payload = attempt_payload(event_id="evt-trigger")

    first = post_attempt(client, payload)
    second = post_attempt(client, payload)

    assert first == second
    assert first["correct"] is False
    assert first["detectedErrorPattern"]["code"] == "ADD_DENOMINATORS"
    assert first["diagnosisSession"]["status"] == "in_progress"
    assert first["next"]["action"] == "continue_diagnostic"
    assert first["next"]["questionId"] == "DQ_F08_001"
    assert [item["skillId"] for item in first["candidateSkills"]] == ["F11", "F08"]


def test_attempt_event_id_replay_and_payload_conflict_are_state_safe(
    client: TestClient,
) -> None:
    payload_a = attempt_payload(event_id="evt-attempt-payload-collision", answer_value="B")

    first = client.post("/api/v1/attempts", json=payload_a)
    assert first.status_code == 200
    first_body = first.json()

    mastery_after_a = main._copy(main.mastery_state)
    sessions_after_a = main._copy(main.diagnosis_sessions)
    runtime_after_a = main._copy(main.runtime_event_state)
    dashboard_after_a = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    replay = client.post("/api/v1/attempts", json=payload_a)
    assert replay.status_code == 200
    assert replay.json() == first_body

    payload_b = {
        **payload_a,
        "answer": {**payload_a["answer"], "value": "A"},
    }
    conflict = client.post("/api/v1/attempts", json=payload_b)
    assert conflict.status_code == 422
    conflict_body = conflict.json()
    assert conflict_body["success"] is False
    assert conflict_body["error"]["code"] == "INVALID_REQUEST"
    assert conflict_body["error"]["details"] == {
        "eventId": "evt-attempt-payload-collision"
    }

    assert main.mastery_state == mastery_after_a
    assert main.diagnosis_sessions == sessions_after_a
    assert main.runtime_event_state == runtime_after_a
    assert client.get("/api/v1/classes/class-7a/insights").json()["data"] == (
        dashboard_after_a
    )


def test_attempt_rejects_question_source_of_truth_mismatches(
    client: TestClient,
) -> None:
    wrong_purpose = attempt_payload(event_id="evt-wrong-purpose", purpose="diagnostic")
    response = client.post("/api/v1/attempts", json=wrong_purpose)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert response.json()["error"]["details"]["expectedPurpose"] == "target"

    wrong_answer_type = attempt_payload(
        event_id="evt-wrong-type", answer_type="numeric", answer_value="1"
    )
    response = client.post("/api/v1/attempts", json=wrong_answer_type)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert response.json()["error"]["details"]["expectedAnswerType"] == "multiple_choice"


def test_missing_session_does_not_mutate_mastery(client: TestClient) -> None:
    before = dict(main.mastery_state["student-001"]["F08"])
    response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(
            event_id="evt-missing-session",
            question_id="DQ_F08_001",
            purpose="diagnostic",
            answer_value="A",
        ),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "SESSION_NOT_FOUND"
    assert main.mastery_state["student-001"]["F08"] == before
    assert main.diagnosis_sessions == {}


def test_session_belongs_to_student(client: TestClient) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-owner-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]
    before = dict(main.mastery_state["student-002"]["F08"])

    response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(
            event_id="evt-wrong-owner",
            student_id="student-002",
            question_id="DQ_F08_001",
            purpose="diagnostic",
            answer_value="A",
            diagnosis_session_id=session_id,
        ),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert main.mastery_state["student-002"]["F08"] == before
    assert main.diagnosis_sessions[session_id]["answeredCount"] == 0


def test_diagnostic_attempt_must_match_next_question(client: TestClient) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-next-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]
    before = dict(main.mastery_state["student-001"]["F11"])

    response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(
            event_id="evt-wrong-next",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"]["expectedQuestionId"] == "DQ_F08_001"
    assert main.mastery_state["student-001"]["F11"] == before
    assert main.diagnosis_sessions[session_id]["answeredCount"] == 0


def test_duplicate_question_does_not_update_mastery_twice(client: TestClient) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-duplicate-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]
    diagnostic_payload = attempt_payload(
        event_id="evt-duplicate-first",
        question_id="DQ_F08_001",
        purpose="diagnostic",
        answer_value="A",
        diagnosis_session_id=session_id,
    )

    first = post_attempt(client, diagnostic_payload)
    after_first = dict(main.mastery_state["student-001"]["F08"])
    duplicate = client.post(
        "/api/v1/attempts",
        json={**diagnostic_payload, "eventId": "evt-duplicate-second"},
    )

    assert first["correct"] is True
    assert duplicate.status_code == 422
    assert main.mastery_state["student-001"]["F08"] == after_first
    assert main.diagnosis_sessions[session_id]["answeredCount"] == 1


def test_completed_session_rejects_new_attempt(client: TestClient) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-completed-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]
    post_attempt(
        client,
        attempt_payload(
            event_id="evt-completed-f08",
            question_id="DQ_F08_001",
            purpose="diagnostic",
            answer_value="A",
            diagnosis_session_id=session_id,
        ),
    )
    post_attempt(
        client,
        attempt_payload(
            event_id="evt-completed-f11-2",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )
    post_attempt(
        client,
        attempt_payload(
            event_id="evt-completed-f11-3",
            question_id="DQ_F11_003",
            purpose="diagnostic",
            answer_value="D",
            diagnosis_session_id=session_id,
        ),
    )
    before = dict(main.mastery_state["student-001"]["F14"])

    response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(
            event_id="evt-after-completed",
            question_id="DQ_F14_001",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )

    assert response.status_code == 422
    assert main.mastery_state["student-001"]["F14"] == before
    assert main.diagnosis_sessions[session_id]["status"] == "completed"


def test_minhs_diagnostic_completes_with_f11_learning_path(client: TestClient) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-minh-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]

    post_attempt(
        client,
        attempt_payload(
            event_id="evt-minh-dq-f08",
            question_id="DQ_F08_001",
            purpose="diagnostic",
            answer_value="A",
            diagnosis_session_id=session_id,
        ),
    )
    post_attempt(
        client,
        attempt_payload(
            event_id="evt-minh-dq-f11-2",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )
    final_attempt = post_attempt(
        client,
        attempt_payload(
            event_id="evt-minh-dq-f11-3",
            question_id="DQ_F11_003",
            purpose="diagnostic",
            answer_value="D",
            diagnosis_session_id=session_id,
        ),
    )

    assert final_attempt["diagnosisSession"]["status"] == "completed"
    assert final_attempt["next"] == {
        "action": "start_learning_path",
        "learningPathId": "lp-001",
    }

    response = client.get(f"/api/v1/diagnosis-sessions/{session_id}")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "completed"
    assert data["diagnosis"]["classification"] == "knowledge_gap"
    assert data["diagnosis"]["rootGap"]["skillId"] == "F11"
    assert data["diagnosis"]["confidence"] >= 0.8
    assert data["learningPath"]["id"] == "lp-001"


def test_diagnosis_scores_include_graph_candidate_and_update_from_answers(
    client: TestClient,
) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-score-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]

    initial = client.get(f"/api/v1/diagnosis-sessions/{session_id}").json()["data"]
    assert [candidate["skillId"] for candidate in initial["candidates"]] == [
        "F11",
        "F08",
        "F14",
    ]
    initial_scores = {
        candidate["skillId"]: candidate["score"]
        for candidate in initial["candidates"]
    }

    post_attempt(
        client,
        attempt_payload(
            event_id="evt-score-f08",
            question_id="DQ_F08_001",
            purpose="diagnostic",
            answer_value="A",
            diagnosis_session_id=session_id,
        ),
    )
    after_f08 = client.get(f"/api/v1/diagnosis-sessions/{session_id}").json()["data"]
    after_f08_scores = {
        candidate["skillId"]: candidate["score"]
        for candidate in after_f08["candidates"]
    }
    assert after_f08_scores["F08"] < initial_scores["F08"]

    post_attempt(
        client,
        attempt_payload(
            event_id="evt-score-f11",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )
    after_f11 = client.get(f"/api/v1/diagnosis-sessions/{session_id}").json()["data"]
    after_f11_scores = {
        candidate["skillId"]: candidate["score"]
        for candidate in after_f11["candidates"]
    }
    assert after_f11_scores["F11"] > initial_scores["F11"]


def test_unknown_error_completes_as_insufficient_evidence(
    client: TestClient,
) -> None:
    trigger = post_attempt(
        client,
        attempt_payload(
            event_id="evt-insufficient-trigger",
            question_id="P_F11_003",
            purpose="practice",
            answer_type="numeric",
            answer_value="20",
        ),
    )
    session_id = trigger["next"]["diagnosisSessionId"]
    assert trigger["detectedErrorPattern"]["code"] == "UNKNOWN_ERROR"

    post_attempt(
        client,
        attempt_payload(
            event_id="evt-insufficient-f11",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="C",
            diagnosis_session_id=session_id,
        ),
    )
    final = post_attempt(
        client,
        attempt_payload(
            event_id="evt-insufficient-f14",
            question_id="DQ_F14_001",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )

    assert final["next"] == {
        "action": "continue_practice",
        "questionId": "Q_E01_002",
    }
    diagnosis = client.get(f"/api/v1/diagnosis-sessions/{session_id}").json()[
        "data"
    ]["diagnosis"]
    assert diagnosis["classification"] == "insufficient_evidence"
    assert diagnosis["rootGap"] is None


def test_careless_fast_recovery_has_no_learning_path(client: TestClient) -> None:
    trigger = post_attempt(
        client,
        attempt_payload(
            event_id="evt-nam-trigger",
            student_id="student-003",
            answer_value="C",
            response_time_ms=900,
        ),
    )
    session_id = trigger["next"]["diagnosisSessionId"]
    assert trigger["detectedErrorPattern"]["code"] == "CARELESS_FAST_ANSWER"

    post_attempt(
        client,
        attempt_payload(
            event_id="evt-nam-dq-f11",
            student_id="student-003",
            question_id="DQ_F11_002",
            purpose="diagnostic",
            answer_value="C",
            diagnosis_session_id=session_id,
        ),
    )
    final_attempt = post_attempt(
        client,
        attempt_payload(
            event_id="evt-nam-dq-f14",
            student_id="student-003",
            question_id="DQ_F14_001",
            purpose="diagnostic",
            answer_value="B",
            diagnosis_session_id=session_id,
        ),
    )

    assert final_attempt["next"] == {
        "action": "continue_practice",
        "questionId": "Q_E01_002",
    }

    response = client.get(f"/api/v1/diagnosis-sessions/{session_id}")
    data = response.json()["data"]
    assert data["diagnosis"]["classification"] == "careless_mistake"
    assert data["diagnosis"]["rootGap"] is None
    assert data["learningPath"] is None


def test_numeric_practice_answer_uses_numeric_validation(client: TestClient) -> None:
    result = post_attempt(
        client,
        attempt_payload(
            event_id="evt-numeric",
            question_id="P_F11_003",
            purpose="practice",
            answer_type="numeric",
            answer_value="10",
        ),
    )

    assert result["correct"] is True
    assert result["skillUpdate"]["skillId"] == "F11"


def test_class_insights_and_sync_contract(client: TestClient) -> None:
    insights = client.get(
        "/api/v1/classes/class-7a/insights",
        params={"packageId": "math-fractions-v1"},
    )
    assert insights.status_code == 200
    assert insights.json()["data"]["class"]["id"] == "class-7a"
    insights_data = insights.json()["data"]
    assert insights_data["commonGaps"]
    assert insights_data["groups"]
    assert insights_data["priorityStudents"]
    assert insights_data["reteachSuggestions"]

    sync_payload = {
        "deviceId": "device-001",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [
            {
                "eventId": "sync-evt-1",
                "type": "question_attempted",
                "createdAt": "2026-07-17T10:15:24Z",
                "payload": {
                    "questionId": "Q_E01_001",
                    "purpose": "target",
                    "answer": {"type": "multiple_choice", "value": "C"},
                    "responseTimeMs": 4200,
                },
            },
            {
                "eventId": "sync-evt-bad",
                "type": "not_real",
                "createdAt": "2026-07-17T10:18:00Z",
                "payload": {},
            },
        ],
    }
    first = client.post("/api/v1/sync", json=sync_payload)
    assert first.status_code == 200
    first_data = first.json()["data"]
    assert first_data["acceptedEventIds"] == ["sync-evt-1"]
    assert first_data["rejectedEvents"][0]["code"] == "INVALID_EVENT"

    second = client.post("/api/v1/sync", json=sync_payload)
    second_data = second.json()["data"]
    assert second_data["acceptedEventIds"] == []
    assert second_data["duplicateEventIds"] == ["sync-evt-1"]
    assert second_data["rejectedEvents"][0]["eventId"] == "sync-evt-bad"


def test_sync_applies_valid_event_once_and_reports_duplicate(
    client: TestClient,
) -> None:
    payload = {
        "deviceId": "device-001",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [
            {
                "eventId": "sync-once",
                "type": "question_attempted",
                "createdAt": "2026-07-17T10:15:24Z",
                "payload": {
                    "questionId": "Q_E01_001",
                    "purpose": "target",
                    "answer": {"type": "multiple_choice", "value": "B"},
                    "responseTimeMs": 4200,
                },
            }
        ],
    }

    first = client.post("/api/v1/sync", json=payload)
    assert first.status_code == 200
    assert first.json()["data"]["acceptedEventIds"] == ["sync-once"]
    assert main.mastery_state["student-001"]["E01"]["masteryScore"] == 0.34

    second = client.post("/api/v1/sync", json=payload)
    assert second.status_code == 200
    assert second.json()["data"]["duplicateEventIds"] == ["sync-once"]
    assert main.mastery_state["student-001"]["E01"]["masteryScore"] == 0.34


def test_online_and_offline_paths_share_attempt_idempotency(client: TestClient) -> None:
    event_id = "cross-path-idempotency"
    online_payload = attempt_payload(event_id=event_id, answer_value="B")
    first = client.post("/api/v1/attempts", json=online_payload)
    assert first.status_code == 200
    mastery_after_online = main.mastery_state["student-001"]["E01"]["masteryScore"]

    sync = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-cross-path",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": [
                {
                    "eventId": event_id,
                    "type": "question_attempted",
                    "createdAt": online_payload["deviceTimestamp"],
                    "payload": {
                        "questionId": "Q_E01_001",
                        "purpose": "target",
                        "answer": {"type": "multiple_choice", "value": "B"},
                        "responseTimeMs": 4200,
                    },
                }
            ],
        },
    )

    assert sync.status_code == 200
    assert sync.json()["data"]["duplicateEventIds"] == [event_id]
    assert main.mastery_state["student-001"]["E01"]["masteryScore"] == mastery_after_online


def test_offline_then_online_attempt_is_not_applied_twice(client: TestClient) -> None:
    event_id = "offline-then-online-idempotency"
    sync = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-cross-path",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": [
                {
                    "eventId": event_id,
                    "type": "question_attempted",
                    "createdAt": "2026-07-17T10:15:24Z",
                    "payload": {
                        "questionId": "Q_E01_001",
                        "purpose": "target",
                        "answer": {"type": "multiple_choice", "value": "B"},
                        "responseTimeMs": 4200,
                    },
                }
            ],
        },
    )
    assert sync.status_code == 200
    mastery_after_sync = main.mastery_state["student-001"]["E01"]["masteryScore"]

    online = client.post(
        "/api/v1/attempts",
        json=attempt_payload(event_id=event_id, answer_value="B"),
    )
    assert online.status_code == 200
    assert main.mastery_state["student-001"]["E01"]["masteryScore"] == mastery_after_sync

def test_sync_rejects_invalid_event_without_updating_state(client: TestClient) -> None:
    payload = {
        "deviceId": "device-001",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [
            {
                "eventId": "sync-invalid-answer",
                "type": "question_attempted",
                "createdAt": "2026-07-17T10:15:24Z",
                "payload": {
                    "questionId": "DQ_F11_002",
                    "purpose": "diagnostic",
                    "answer": {"type": "multiple_choice", "value": "Z"},
                },
            }
        ],
    }

    response = client.post("/api/v1/sync", json=payload)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acceptedEventIds"] == []
    assert data["duplicateEventIds"] == []
    assert data["rejectedEvents"][0]["eventId"] == "sync-invalid-answer"
    assert data["rejectedEvents"][0]["code"] == "INVALID_EVENT"
    assert data["rejectedEvents"][0]["retryable"] is False
    assert "sync-invalid-answer" not in main.sync_event_state
    assert main.mastery_state["student-001"]["F11"]["masteryScore"] == 0.35


def test_class_insights_rejects_unknown_class(client: TestClient) -> None:
    response = client.get("/api/v1/classes/missing/insights")

    assert response.status_code == 404
    assert response.json()["success"] is False
    assert response.json()["error"]["code"] == "CLASS_NOT_FOUND"


def test_sync_question_attempt_updates_diagnostic_session_like_online_attempt(
    client: TestClient,
) -> None:
    trigger = post_attempt(client, attempt_payload(event_id="evt-sync-session-trigger"))
    session_id = trigger["next"]["diagnosisSessionId"]
    events = [
        {
            "eventId": "sync-diagnostic-f08",
            "type": "question_attempted",
            "createdAt": "2026-07-17T10:16:00Z",
            "payload": {
                "questionId": "DQ_F08_001",
                "purpose": "diagnostic",
                "diagnosisSessionId": session_id,
                "answer": {"type": "multiple_choice", "value": "A"},
                "responseTimeMs": 4200,
            },
        },
        {
            "eventId": "sync-diagnostic-f11-2",
            "type": "question_attempted",
            "createdAt": "2026-07-17T10:17:00Z",
            "payload": {
                "questionId": "DQ_F11_002",
                "purpose": "diagnostic",
                "diagnosisSessionId": session_id,
                "answer": {"type": "multiple_choice", "value": "B"},
                "responseTimeMs": 4200,
            },
        },
        {
            "eventId": "sync-diagnostic-f11-3",
            "type": "question_attempted",
            "createdAt": "2026-07-17T10:18:00Z",
            "payload": {
                "questionId": "DQ_F11_003",
                "purpose": "diagnostic",
                "diagnosisSessionId": session_id,
                "answer": {"type": "multiple_choice", "value": "D"},
                "responseTimeMs": 4200,
            },
        },
    ]

    response = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-001",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": events,
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["acceptedEventIds"] == [
        "sync-diagnostic-f08",
        "sync-diagnostic-f11-2",
        "sync-diagnostic-f11-3",
    ]
    session = main.diagnosis_sessions[session_id]
    assert session["answeredCount"] == 3
    assert session["status"] == "completed"
    assert len(session["evidence"]) >= 4
    assert session["learningPath"]["id"] == "lp-001"
    last_response = main.sync_event_state["sync-diagnostic-f11-3"]["attemptResponse"]
    assert last_response["diagnosisSession"]["status"] == "completed"
    assert last_response["next"] == {
        "action": "start_learning_path",
        "learningPathId": "lp-001",
    }


def test_sync_rejects_missing_references_without_mutation_and_keeps_batch_independent(
    client: TestClient,
) -> None:
    before_f11 = dict(main.mastery_state["student-001"]["F11"])
    response = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-001",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": [
                {
                    "eventId": "sync-valid-in-batch",
                    "type": "question_attempted",
                    "createdAt": "2026-07-17T10:15:24Z",
                    "payload": {
                        "questionId": "Q_E01_001",
                        "purpose": "target",
                        "answer": {"type": "multiple_choice", "value": "A"},
                    },
                },
                {
                    "eventId": "sync-missing-session",
                    "type": "question_attempted",
                    "createdAt": "2026-07-17T10:15:25Z",
                    "payload": {
                        "questionId": "DQ_F11_002",
                        "purpose": "diagnostic",
                        "diagnosisSessionId": "diag-missing",
                        "answer": {"type": "multiple_choice", "value": "C"},
                    },
                },
                {
                    "eventId": "sync-wrong-step",
                    "type": "learning_step_completed",
                    "createdAt": "2026-07-17T10:15:26Z",
                    "payload": {
                        "learningPathId": "lp-001",
                        "learningStepId": "step-r02-1",
                    },
                },
            ],
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["acceptedEventIds"] == ["sync-valid-in-batch"]
    assert {item["eventId"] for item in data["rejectedEvents"]} == {
        "sync-missing-session",
        "sync-wrong-step",
    }
    assert {
        item["code"] for item in data["rejectedEvents"]
    } == {"SESSION_NOT_FOUND", "INVALID_EVENT"}
    assert main.mastery_state["student-001"]["F11"] == before_f11
    assert "sync-missing-session" not in main.sync_event_ids
    assert "sync-wrong-step" not in main.sync_event_ids


def test_sync_same_event_id_with_different_payload_is_rejected(client: TestClient) -> None:
    base_event = {
        "eventId": "sync-payload-collision",
        "type": "question_attempted",
        "createdAt": "2026-07-17T10:15:24Z",
        "payload": {
            "questionId": "Q_E01_001",
            "purpose": "target",
            "answer": {"type": "multiple_choice", "value": "A"},
        },
    }
    sync_request = {
        "deviceId": "device-001",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [base_event],
    }

    first = client.post("/api/v1/sync", json=sync_request)
    assert first.json()["data"]["acceptedEventIds"] == ["sync-payload-collision"]
    mastery_after_first = main.mastery_state["student-001"]["E01"]["masteryScore"]

    duplicate = client.post("/api/v1/sync", json=sync_request)
    assert duplicate.json()["data"]["duplicateEventIds"] == ["sync-payload-collision"]

    changed = {**base_event, "payload": {**base_event["payload"]}}
    changed["payload"]["answer"] = {"type": "multiple_choice", "value": "B"}
    changed_request = {**sync_request, "events": [changed]}
    rejected = client.post("/api/v1/sync", json=changed_request)
    rejected_data = rejected.json()["data"]
    assert rejected_data["acceptedEventIds"] == []
    assert rejected_data["duplicateEventIds"] == []
    assert rejected_data["rejectedEvents"][0]["code"] == "INVALID_EVENT"
    assert main.mastery_state["student-001"]["E01"]["masteryScore"] == mastery_after_first


def test_dashboard_changes_after_online_attempt(client: TestClient) -> None:
    before = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(event_id="dashboard-online", answer_value="B"),
    )
    assert response.status_code == 200

    after = client.get("/api/v1/classes/class-7a/insights").json()["data"]
    assert after != before
    assert after["syncStatus"]["syncedStudents"] == before["syncStatus"]["syncedStudents"] + 1
    assert after["syncStatus"]["lastUpdatedAt"] == "2026-07-17T10:15:24Z"
    assert after["priorityStudents"] != before["priorityStudents"]


def test_dashboard_changes_after_sync(client: TestClient) -> None:
    before = client.get("/api/v1/classes/class-7a/insights").json()["data"]
    response = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-dashboard",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": [
                {
                    "eventId": "dashboard-sync",
                    "type": "question_attempted",
                    "createdAt": "2026-07-17T10:15:24Z",
                    "payload": {
                        "questionId": "Q_E01_001",
                        "purpose": "target",
                        "answer": {"type": "multiple_choice", "value": "B"},
                    },
                }
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["acceptedEventIds"] == ["dashboard-sync"]

    after = client.get("/api/v1/classes/class-7a/insights").json()["data"]
    assert after != before
    assert after["syncStatus"]["lastUpdatedAt"] == "2026-07-17T10:15:24Z"
    assert after["commonGaps"] != before["commonGaps"] or after["priorityStudents"] != before[
        "priorityStudents"
    ]


def test_dashboard_online_offline_aggregate_consistency(client: TestClient) -> None:
    online_response = client.post(
        "/api/v1/attempts",
        json=attempt_payload(event_id="dashboard-consistent", answer_value="B"),
    )
    assert online_response.status_code == 200
    online = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    reset_runtime_state()
    offline_response = client.post(
        "/api/v1/sync",
        json={
            "deviceId": "device-dashboard",
            "studentId": "student-001",
            "packageId": "math-fractions-v1",
            "packageVersion": 3,
            "events": [
                {
                    "eventId": "dashboard-consistent",
                    "type": "question_attempted",
                    "createdAt": "2026-07-17T10:15:24Z",
                    "payload": {
                        "questionId": "Q_E01_001",
                        "purpose": "target",
                        "answer": {"type": "multiple_choice", "value": "B"},
                    },
                }
            ],
        },
    )
    assert offline_response.status_code == 200
    offline = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    assert offline == online


def test_duplicate_sync_does_not_double_count_dashboard(client: TestClient) -> None:
    payload = {
        "deviceId": "device-dashboard",
        "studentId": "student-001",
        "packageId": "math-fractions-v1",
        "packageVersion": 3,
        "events": [
            {
                "eventId": "dashboard-no-double-count",
                "type": "question_attempted",
                "createdAt": "2026-07-17T10:15:24Z",
                "payload": {
                    "questionId": "Q_E01_001",
                    "purpose": "target",
                    "answer": {"type": "multiple_choice", "value": "B"},
                },
            }
        ],
    }
    first = client.post("/api/v1/sync", json=payload)
    assert first.status_code == 200
    after_first = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    second = client.post("/api/v1/sync", json=payload)
    assert second.status_code == 200
    assert second.json()["data"]["duplicateEventIds"] == ["dashboard-no-double-count"]
    after_duplicate = client.get("/api/v1/classes/class-7a/insights").json()["data"]

    assert after_duplicate == after_first


def test_dashboard_initial_state_uses_seed_data(client: TestClient) -> None:
    response = client.get("/api/v1/classes/class-7a/insights")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data == main.class_insights_seed

    data["commonGaps"][0]["studentCount"] = 999
    again = client.get("/api/v1/classes/class-7a/insights").json()["data"]
    assert again == main.class_insights_seed
    assert main.class_insights == main.class_insights_seed
