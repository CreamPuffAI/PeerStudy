from __future__ import annotations

import copy
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .ai_content_service import (
    AIContentError,
    AIContentService,
    ContentConstraints,
    GenerateHintFromDiagnosisRequest,
    GenerateQuestionVariantRequest,
    RewriteExplanationRequest,
)
from .data_loader import load_json_file, load_runtime_data
from .fpt_ai_client import FPTAIClient
from .models import ApiErrorResponse, ApiSuccess, UtcTimestamp


QuestionPurpose = Literal["target", "diagnostic", "practice", "checkpoint"]
AnswerType = Literal["multiple_choice", "numeric"]
SyncEventType = Literal[
    "question_attempted",
    "learning_step_completed",
    "checkpoint_completed",
    "learning_path_completed",
]


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PACKAGE_ID = "math-fractions-v1"
MAX_DIAGNOSTIC_QUESTIONS = 4

ERROR_LABELS = {
    "ADD_DENOMINATORS": "Cộng trực tiếp hai mẫu số",
    "EQUIVALENT_FRACTION_MISCONCEPTION": "Nhầm phân số tương đương",
    "ADD_NUMERATORS_AND_DENOMINATORS": "Cộng tử số và mẫu số",
    "SIGN_RULE_ERROR": "Sai quy tắc dấu",
    "CARELESS_FAST_ANSWER": "Khả năng lỗi bất cẩn",
    "UNKNOWN_ERROR": "Chưa xác định mẫu lỗi",
}


def _load_json(name: str) -> Any:
    return load_json_file(DATA_DIR / name)


runtime_data = load_runtime_data(DATA_DIR)
learning_package = runtime_data["learning_package"].model_dump(mode="json")
students = runtime_data["students.json"]
class_insights = runtime_data["classInsights.mock.json"]
class_insights_seed = copy.deepcopy(class_insights)

# Keep the runtime decision inputs in their source files, while rejecting drift
# against the aggregate package at startup.
questions = runtime_data["questions.json"]
skills = runtime_data["skills.json"]
edges = runtime_data["edges.json"]
diagnostic_rules = runtime_data["diagnosticRules.json"]
learning_paths = runtime_data["learningPaths.json"]

questions_by_id = {question["id"]: question for question in questions}
skills_by_id = {skill["id"]: skill for skill in skills}
rules_by_error = {rule["triggerErrorPattern"]: rule for rule in diagnostic_rules}
learning_paths_by_gap = {
    path["rootGapSkillId"]: path for path in learning_paths
}
learning_paths_by_id = {path["id"]: path for path in learning_paths}
students_by_id = {student["id"]: student for student in students}


def _ai_timeout_seconds() -> float:
    try:
        value = float(os.getenv("FPT_AI_TIMEOUT_SECONDS", "8"))
    except ValueError:
        return 8.0
    return value if value > 0 else 8.0


fpt_ai_client = FPTAIClient.from_env()
ai_content_service = AIContentService(
    runtime_data["learning_package"],
    client=fpt_ai_client,
    api_key=os.getenv("FPT_AI_API_KEY", ""),
    timeout_seconds=_ai_timeout_seconds(),
)


def _initial_mastery() -> dict[str, dict[str, dict[str, Any]]]:
    return {
        student["id"]: {
            item["skillId"]: {
                "masteryScore": item["masteryScore"],
                "status": item["status"],
            }
            for item in student.get("mastery", [])
        }
        for student in students
    }


mastery_state = _initial_mastery()
attempts_by_event_id: dict[str, dict[str, Any]] = {}
attempt_event_snapshots: dict[str, dict[str, Any]] = {}
diagnosis_sessions: dict[str, dict[str, Any]] = {}
sync_event_ids: set[str] = set()
sync_event_state: dict[str, dict[str, Any]] = {}
runtime_event_state: dict[str, dict[str, Any]] = {}


app = FastAPI(
    title="PeerStudy API",
    description="Backend MVP for adaptive learning with offline deterministic diagnosis.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://localhost:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class AttemptContext(BaseModel):
    diagnosisSessionId: str | None = None
    learningPathId: str | None = None
    learningStepId: str | None = None


class AnswerPayload(BaseModel):
    type: AnswerType
    value: str


class AttemptRequest(BaseModel):
    eventId: str
    studentId: str
    classId: str
    packageId: str
    questionId: str
    purpose: QuestionPurpose
    context: AttemptContext = Field(default_factory=AttemptContext)
    answer: AnswerPayload
    responseTimeMs: int = Field(ge=0)
    attemptNumber: int = Field(ge=1)
    deviceTimestamp: UtcTimestamp
    offlineCreated: bool = False


class SyncEvent(BaseModel):
    eventId: str
    type: str
    createdAt: UtcTimestamp
    payload: dict[str, Any]


class SyncRequest(BaseModel):
    deviceId: str
    studentId: str
    packageId: str
    packageVersion: int
    events: list[SyncEvent]


class AIRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RewriteExplanationApiRequest(AIRequestModel):
    packageId: str
    skillId: str
    contentId: str
    style: str = Field(default="short", min_length=1, max_length=32)
    constraints: ContentConstraints = Field(default_factory=ContentConstraints)


class GenerateQuestionVariantApiRequest(AIRequestModel):
    packageId: str
    skillId: str
    questionId: str
    style: str = Field(default="step_by_step", min_length=1, max_length=32)
    constraints: ContentConstraints = Field(default_factory=ContentConstraints)


class GenerateDiagnosisHintApiRequest(AIRequestModel):
    packageId: str
    diagnosisSessionId: str
    style: str = Field(default="short", min_length=1, max_length=32)
    constraints: ContentConstraints = Field(
        default_factory=lambda: ContentConstraints(maxSentences=2)
    )


def success_response(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    response = {"success": True, "data": data}
    if meta is not None:
        response["meta"] = meta
    return response


def error_response(
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }


def _json_safe(value: Any) -> Any:
    """Convert validation details to values accepted by JSONResponse."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _validation_error_details(exc: RequestValidationError) -> dict[str, Any]:
    try:
        errors = exc.errors(include_context=False)
    except TypeError:
        errors = exc.errors()
    return {"errors": _json_safe(errors)}


def create_app(
    data_dir: Path | None = None,
    package_filename: str = "learning-package.math-fractions-v1.json",
) -> FastAPI:
    """Create an API app backed by one validated offline learning package."""

    runtime_data = load_runtime_data(data_dir or DATA_DIR, package_filename)
    package = runtime_data["learning_package"]
    package_data = package.model_dump(mode="json")
    factory_app = FastAPI(
        title="PeerStudy API",
        description="Backend MVP for the shared learning-package API contract.",
        version="0.1.0",
    )
    factory_app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:4173", "http://localhost:5173"],
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["*"],
    )

    @factory_app.exception_handler(ApiError)
    async def factory_api_error_handler(
        _request: Request, exc: ApiError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response(exc.code, exc.message, exc.details),
        )

    @factory_app.exception_handler(RequestValidationError)
    async def factory_validation_error_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_response(
                "INVALID_REQUEST",
                "Dữ liệu gửi lên không hợp lệ.",
                _validation_error_details(exc),
            ),
        )

    @factory_app.exception_handler(HTTPException)
    async def factory_http_error_handler(
        _request: Request, exc: HTTPException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_response("HTTP_ERROR", str(exc.detail)),
        )

    @factory_app.get(
        "/api/v1/learning-packages/{package_id}",
        response_model=ApiSuccess,
        responses={404: {"model": ApiErrorResponse}},
    )
    async def factory_get_learning_package(package_id: str) -> dict[str, Any]:
        if package_id != package.packageId:
            raise ApiError("PACKAGE_NOT_FOUND", "Không tìm thấy gói học tập.", 404)
        return success_response(_copy(package_data))

    return factory_app


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(exc.code, exc.message, exc.details),
    )


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response("HTTP_ERROR", str(exc.detail)),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_response(
            "INVALID_REQUEST",
            "Dữ liệu gửi lên không hợp lệ.",
            _validation_error_details(exc),
        ),
    )


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _copy(value: Any) -> Any:
    return copy.deepcopy(value)


def _timestamp_string(value: datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _record_runtime_event(
    *,
    event_id: str,
    student_id: str,
    event_type: str,
    occurred_at: datetime,
    question_id: str | None = None,
    response: dict[str, Any] | None = None,
    source: Literal["online", "offline"],
) -> None:
    """Record one accepted event for read-time aggregation only once."""

    if event_id in runtime_event_state:
        return

    question = questions_by_id.get(question_id) if question_id else None
    runtime_event_state[event_id] = {
        "eventId": event_id,
        "studentId": student_id,
        "eventType": event_type,
        "source": source,
        "occurredAt": _timestamp_string(occurred_at),
        "questionId": question_id,
        "skillId": question["skillId"] if question else None,
        "correct": response.get("correct") if response else None,
    }


def _require_package(package_id: str) -> dict[str, Any]:
    if package_id != learning_package["packageId"]:
        raise ApiError("PACKAGE_NOT_FOUND", "Không tìm thấy gói học tập.", 404)
    return learning_package


def _require_question(question_id: str) -> dict[str, Any]:
    question = questions_by_id.get(question_id)
    if question is None:
        raise ApiError("QUESTION_NOT_FOUND", "Không tìm thấy câu hỏi.", 404)
    return question


def _require_student(student_id: str) -> dict[str, Any]:
    student = students_by_id.get(student_id)
    if student is None:
        raise ApiError("STUDENT_NOT_FOUND", "Không tìm thấy học sinh.", 404)
    return student


def _strip_question(question: dict[str, Any]) -> dict[str, Any]:
    visible = _copy(question)
    visible.pop("validation", None)
    visible.pop("errorMappings", None)
    visible.pop("difficulty", None)
    return visible


def _student_mastery(student_id: str, skill_id: str) -> tuple[float, str]:
    state = mastery_state.get(student_id, {}).get(skill_id)
    if state is None:
        return 0.0, "unknown"
    return float(state["masteryScore"]), str(state["status"])


def _status_for_score(score: float, threshold: float) -> str:
    if score >= threshold:
        return "mastered"
    if score >= 0.5:
        return "learning"
    return "needs_support"


def _update_mastery(
    student_id: str, skill_id: str, correct: bool
) -> dict[str, Any]:
    threshold = float(skills_by_id[skill_id]["masteryThreshold"])
    previous, _status = _student_mastery(student_id, skill_id)
    delta = 0.13 if correct else -0.08
    current = min(1.0, max(0.0, round(previous + delta, 2)))
    status = _status_for_score(current, threshold)
    mastery_state.setdefault(student_id, {})[skill_id] = {
        "masteryScore": current,
        "status": status,
    }
    return {
        "skillId": skill_id,
        "previousMastery": previous,
        "currentMastery": current,
        "status": status,
    }


def _is_correct(question: dict[str, Any], answer: AnswerPayload) -> bool:
    validation = question["validation"]
    if question["type"] == "multiple_choice":
        return answer.value == validation["correctAnswer"]

    accepted = validation.get("acceptedAnswers") or [validation["correctAnswer"]]
    if answer.value in accepted:
        return True

    try:
        expected = float(validation["correctAnswer"])
        actual = float(answer.value)
    except ValueError:
        return False
    return abs(actual - expected) <= float(validation.get("tolerance", 0))


def _validate_attempt_source_of_truth(
    request: AttemptRequest, question: dict[str, Any]
) -> None:
    if request.purpose != question["purpose"]:
        raise ApiError(
            "INVALID_REQUEST",
            "purpose không khớp với questionId.",
            422,
            {
                "questionId": request.questionId,
                "expectedPurpose": question["purpose"],
                "receivedPurpose": request.purpose,
            },
        )
    if request.answer.type != question["type"]:
        raise ApiError(
            "INVALID_REQUEST",
            "answer.type không khớp với questionId.",
            422,
            {
                "questionId": request.questionId,
                "expectedAnswerType": question["type"],
                "receivedAnswerType": request.answer.type,
            },
        )

    if question["type"] == "multiple_choice":
        option_ids = {option["id"] for option in question.get("options", [])}
        if request.answer.value not in option_ids:
            raise ApiError(
                "INVALID_REQUEST",
                "Đáp án multiple_choice không tồn tại trong options.",
                422,
                {"questionId": request.questionId, "answer": request.answer.value},
            )


def _all_core_skills_mastered(student_id: str) -> bool:
    core_skill_ids = ["F08", "F11", "F14", "R02", "E01"]
    return all(_student_mastery(student_id, skill_id)[0] >= 0.8 for skill_id in core_skill_ids)


def _detect_error_pattern(
    student_id: str,
    question: dict[str, Any],
    answer: AnswerPayload,
    response_time_ms: int,
) -> str:
    if _all_core_skills_mastered(student_id) and response_time_ms <= 1500:
        return "CARELESS_FAST_ANSWER"
    return question.get("errorMappings", {}).get(answer.value, "UNKNOWN_ERROR")


def _related_skill_ids(
    skill_ids: set[str], anchor_skill_id: str | None = None
) -> list[str]:
    """Return graph neighbours that are explicitly commonly confused."""

    related: list[str] = []
    for edge in edges:
        if edge.get("type") != "COMMONLY_CONFUSED_WITH":
            continue
        if edge.get("from") not in skill_ids:
            continue
        if anchor_skill_id is not None and edge.get("from") != anchor_skill_id:
            continue
        if edge.get("to") in skills_by_id:
            skill_id = edge["to"]
            if skill_id not in skill_ids and skill_id not in related:
                related.append(skill_id)
    return related


def _candidate_skill_ids(rule: dict[str, Any] | None) -> list[str]:
    direct_ids = [
        candidate["skillId"]
        for candidate in (rule or {}).get("candidateSkills", [])
        if candidate["skillId"] in skills_by_id
    ]
    return [
        *direct_ids,
        *_related_skill_ids(set(direct_ids), direct_ids[0] if direct_ids else None),
    ]


def _candidate_scores(
    rule: dict[str, Any] | None,
    student_id: str,
) -> dict[str, float]:
    if not rule:
        return {}
    direct_candidates = {
        candidate["skillId"]: float(candidate["weight"])
        for candidate in rule.get("candidateSkills", [])
        if candidate["skillId"] in skills_by_id
    }
    scores: dict[str, float] = {}
    for candidate in rule.get("candidateSkills", []):
        skill_id = candidate["skillId"]
        if skill_id not in skills_by_id:
            continue
        mastery_score, _status = _student_mastery(student_id, skill_id)
        score = 0.5 * float(candidate["weight"]) + 0.5 * (1 - mastery_score)
        scores[skill_id] = round(min(1.0, max(0.0, score)), 2)

    # The rule owns the initial hypothesis.  The graph only adds a weak,
    # explainable alternative (for example F14 next to F11); it never replaces
    # or overrides a rule candidate.
    primary_skill_id = next(iter(direct_candidates), None)
    for skill_id in _related_skill_ids(
        set(direct_candidates), primary_skill_id
    ):
        mastery_score, _status = _student_mastery(student_id, skill_id)
        scores[skill_id] = round(0.25 * (1 - mastery_score), 2)
    return scores


def _recommended_questions(
    rule: dict[str, Any] | None, trigger_question_id: str
) -> list[str]:
    if rule and rule.get("recommendedDiagnosticQuestionIds"):
        question_ids = list(rule["recommendedDiagnosticQuestionIds"])
    elif rule and rule.get("triggerErrorPattern") == "CARELESS_FAST_ANSWER":
        question_ids = ["DQ_F11_002", "DQ_F14_001"]
    else:
        question_ids = ["DQ_F11_002", "DQ_F14_001"]

    if trigger_question_id in question_ids:
        question_ids = [
            question_id for question_id in question_ids if question_id != trigger_question_id
        ] + [trigger_question_id]
    return question_ids[:MAX_DIAGNOSTIC_QUESTIONS]


def _new_session_id(preferred_id: str | None) -> str:
    if preferred_id and preferred_id not in diagnosis_sessions:
        return preferred_id
    return f"diag-{len(diagnosis_sessions) + 1:03d}"


def _start_diagnosis_session(
    request: AttemptRequest,
    question: dict[str, Any],
    error_pattern: str,
) -> dict[str, Any]:
    rule = rules_by_error.get(error_pattern)
    session_id = _new_session_id(request.context.diagnosisSessionId)
    session = {
        "id": session_id,
        "studentId": request.studentId,
        "triggerQuestionId": request.questionId,
        "triggerSkillId": question["skillId"],
        "targetSkillId": question["skillId"],
        "status": "in_progress",
        "answeredCount": 0,
        "maxQuestions": MAX_DIAGNOSTIC_QUESTIONS,
        "candidateScores": _candidate_scores(rule, request.studentId),
        "directCandidateSkillIds": [
            candidate["skillId"]
            for candidate in (rule or {}).get("candidateSkills", [])
            if candidate["skillId"] in skills_by_id
        ],
        "recommendedQuestionIds": _recommended_questions(rule, request.questionId),
        "answeredQuestionIds": [],
        "answers": [],
        "triggerErrorPattern": error_pattern,
        "classification": (
            rule.get("classification", "knowledge_gap")
            if rule
            else "insufficient_evidence"
        ),
        "evidence": [
            {
                "type": "trigger_error_pattern",
                "skillId": question["skillId"],
                "message": rule.get("evidenceMessage", ERROR_LABELS.get(error_pattern, error_pattern))
                if rule
                else ERROR_LABELS.get(error_pattern, error_pattern),
            }
        ],
        "diagnosis": None,
        "learningPath": None,
    }
    diagnosis_sessions[session_id] = session
    return session


def _get_next_diagnostic_question(session: dict[str, Any]) -> dict[str, Any] | None:
    answered = set(session["answeredQuestionIds"])
    for question_id in session["recommendedQuestionIds"]:
        if question_id not in answered:
            return _strip_question(questions_by_id[question_id])
    return None


def _record_diagnostic_answer(
    session: dict[str, Any],
    question: dict[str, Any],
    correct: bool,
    error_pattern: str | None,
) -> None:
    if question["id"] in session["answeredQuestionIds"]:
        return

    session["answeredQuestionIds"].append(question["id"])
    session["answeredCount"] = len(session["answeredQuestionIds"])
    session["answers"].append(
        {
            "questionId": question["id"],
            "skillId": question["skillId"],
            "correct": correct,
            "errorPattern": error_pattern,
        }
    )

    if question["skillId"] in session["candidateScores"]:
        score = session["candidateScores"][question["skillId"]]
        score += -0.15 if correct else 0.3
        session["candidateScores"][question["skillId"]] = round(
            min(1.0, max(0.0, score)), 2
        )
    evidence_type = (
        "correct_diagnostic_answer" if correct else "incorrect_diagnostic_answer"
    )
    message = (
        f"Học sinh trả lời {'đúng' if correct else 'sai'} câu chẩn đoán "
        f"cho kỹ năng {question['skillId']}."
    )
    session["evidence"].append(
        {"type": evidence_type, "skillId": question["skillId"], "message": message}
    )

    repeated_patterns = [
        answer["errorPattern"]
        for answer in session["answers"]
        if answer["errorPattern"] and answer["errorPattern"] == error_pattern
    ]
    if error_pattern and len(repeated_patterns) >= 2:
        session["evidence"].append(
            {
                "type": "repeated_error_pattern",
                "message": f"Lỗi {ERROR_LABELS.get(error_pattern, error_pattern)} xuất hiện lặp lại.",
            }
        )


def _should_complete(session: dict[str, Any]) -> bool:
    return (
        session["answeredCount"] >= len(session["recommendedQuestionIds"])
        or session["answeredCount"] >= session["maxQuestions"]
    )


def _complete_session(session: dict[str, Any]) -> None:
    if session["status"] == "completed":
        return

    if session["classification"] == "careless_mistake":
        incorrect_count = sum(not answer["correct"] for answer in session["answers"])
        if incorrect_count == 0:
            session["diagnosis"] = {
                "rootGap": None,
                "confidence": 0.81,
                "classification": "careless_mistake",
                "evidence": session["evidence"],
            }
            session["learningPath"] = None
            session["status"] = "completed"
            return
        session["classification"] = "knowledge_gap"

    if session["classification"] == "insufficient_evidence":
        session["diagnosis"] = {
            "rootGap": None,
            "confidence": 0.5,
            "classification": "insufficient_evidence",
            "evidence": session["evidence"],
        }
        session["learningPath"] = None
        session["status"] = "completed"
        return

    root_gap_skill_id = max(
        session["candidateScores"],
        key=lambda skill_id: session["candidateScores"][skill_id],
        default=None,
    )
    if not root_gap_skill_id:
        session["diagnosis"] = {
            "rootGap": None,
            "confidence": 0.5,
            "classification": "insufficient_evidence",
            "evidence": session["evidence"],
        }
        session["learningPath"] = None
        session["status"] = "completed"
        return

    root_skill = skills_by_id[root_gap_skill_id]
    confidence = round(max(0.55, session["candidateScores"][root_gap_skill_id]), 2)
    session["diagnosis"] = {
        "rootGap": {
            "skillId": root_skill["id"],
            "name": root_skill["name"],
            "grade": root_skill["grade"],
        },
        "confidence": confidence,
        "classification": "knowledge_gap",
        "evidence": session["evidence"],
    }
    path = learning_paths_by_gap.get(root_gap_skill_id)
    session["learningPath"] = _copy(path) if path else None
    session["status"] = "completed"


def _session_summary(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": session["id"],
        "status": session["status"],
        "answeredCount": session["answeredCount"],
        "maxQuestions": session["maxQuestions"],
    }


def _candidate_list(
    session: dict[str, Any], field_name: str, direct_only: bool = False
) -> list[dict[str, Any]]:
    candidate_scores = session["candidateScores"]
    if direct_only:
        direct_ids = set(session.get("directCandidateSkillIds", []))
        candidate_scores = {
            skill_id: score
            for skill_id, score in candidate_scores.items()
            if skill_id in direct_ids
        }
    return [
        {
            "skillId": skill_id,
            "name": skills_by_id[skill_id]["name"],
            field_name: score,
        }
        for skill_id, score in sorted(
            candidate_scores.items(), key=lambda item: item[1], reverse=True
        )
    ]


def _next_for_completed_session(session: dict[str, Any]) -> dict[str, Any]:
    if session["learningPath"]:
        return {
            "action": "start_learning_path",
            "learningPathId": session["learningPath"]["id"],
        }
    return {"action": "continue_practice", "questionId": "Q_E01_002"}


def _attempt_id() -> str:
    return f"attempt-{uuid4().hex[:8]}"


def _next_question_after_correct(question_id: str) -> dict[str, Any]:
    question = questions_by_id.get(question_id)
    if question is None:
        return {"action": "completed"}

    skill_id = question["skillId"]
    purpose = question["purpose"]
    current_index = next(
        (i for i, q in enumerate(questions) if q["id"] == question_id), None
    )
    if current_index is None:
        return {"action": "completed"}

    for candidate in questions[current_index + 1:]:
        if (
            candidate["skillId"] == skill_id
            and candidate["purpose"] == purpose
            and "RETRY" not in candidate["id"]
        ):
            return {
                "action": "continue_practice",
                "questionId": candidate["id"],
            }
    return {"action": "completed"}


def _feedback(correct: bool, question: dict[str, Any]) -> dict[str, str]:
    if correct:
        return {
            "type": "success",
            "message": "Em đã trả lời đúng.",
        }
    if question["purpose"] == "diagnostic":
        return {
            "type": "neutral",
            "message": "Hệ thống đã ghi nhận thêm bằng chứng chẩn đoán.",
        }
    return {
        "type": "neutral",
        "message": "Hãy trả lời một vài câu ngắn để hệ thống tìm phần kiến thức em cần củng cố.",
    }


def _validate_learning_context(request: AttemptRequest) -> None:
    """Validate learning path references before an attempt can mutate state."""

    path_id = request.context.learningPathId
    step_id = request.context.learningStepId
    if step_id is not None and path_id is None:
        raise ApiError(
            "INVALID_REQUEST",
            "learningStepId phải đi cùng learningPathId.",
            422,
            {"learningStepId": step_id},
        )

    if path_id is None:
        return

    path = learning_paths_by_id.get(path_id)
    if path is None:
        raise ApiError(
            "INVALID_REQUEST",
            "Không tìm thấy learning path.",
            422,
            {"learningPathId": path_id},
        )

    if step_id is not None and not any(
        step["id"] == step_id for step in path.get("steps", [])
    ):
        raise ApiError(
            "INVALID_REQUEST",
            "learningStepId không thuộc learningPathId.",
            422,
            {"learningPathId": path_id, "learningStepId": step_id},
        )


def _validate_diagnosis_session_reference(
    session_id: str | None, student_id: str
) -> dict[str, Any] | None:
    if session_id is None:
        return None
    session = diagnosis_sessions.get(session_id)
    if session is None:
        raise ApiError("SESSION_NOT_FOUND", "Không tìm thấy phiên chẩn đoán.", 404)
    if session["studentId"] != student_id:
        raise ApiError(
            "INVALID_REQUEST",
            "Phiên chẩn đoán không thuộc học sinh.",
            422,
            {
                "diagnosisSessionId": session_id,
                "expectedStudentId": session["studentId"],
                "receivedStudentId": student_id,
            },
        )
    return session


def _validate_diagnostic_session_attempt(
    request: AttemptRequest, question: dict[str, Any]
) -> dict[str, Any] | None:
    """Validate all session constraints before any attempt mutation."""

    _validate_learning_context(request)
    session_id = request.context.diagnosisSessionId
    if session_id is None:
        if question["purpose"] == "diagnostic":
            raise ApiError("SESSION_NOT_FOUND", "Không tìm thấy phiên chẩn đoán.", 404)
        return None

    session = _validate_diagnosis_session_reference(session_id, request.studentId)
    assert session is not None
    if session["status"] != "in_progress":
        raise ApiError(
            "INVALID_REQUEST",
            "Phiên chẩn đoán không còn hoạt động.",
            422,
            {"diagnosisSessionId": session_id, "status": session["status"]},
        )
    if question["purpose"] != "diagnostic":
        raise ApiError(
            "INVALID_REQUEST",
            "Chỉ câu hỏi diagnostic mới thuộc phiên chẩn đoán.",
            422,
            {"questionId": request.questionId},
        )
    if request.questionId in session["answeredQuestionIds"]:
        raise ApiError(
            "INVALID_REQUEST",
            "Câu hỏi diagnostic đã được ghi nhận trong phiên.",
            422,
            {"questionId": request.questionId, "diagnosisSessionId": session_id},
        )

    next_question = _get_next_diagnostic_question(session)
    if next_question is None or request.questionId != next_question["id"]:
        raise ApiError(
            "INVALID_REQUEST",
            "Câu hỏi không khớp câu diagnostic tiếp theo.",
            422,
            {
                "expectedQuestionId": next_question["id"] if next_question else None,
                "receivedQuestionId": request.questionId,
            },
        )
    return session


def _process_attempt(request: AttemptRequest) -> dict[str, Any]:
    """Process an attempt for both online requests and offline sync events."""

    _require_package(request.packageId)
    _require_student(request.studentId)
    question = _require_question(request.questionId)
    _validate_attempt_source_of_truth(request, question)

    # All validation, including session/path/step references, happens before
    # mastery, evidence, or session state is changed.
    session = _validate_diagnostic_session_attempt(request, question)
    correct = _is_correct(question, request.answer)
    detected_error_pattern = None
    if not correct:
        detected_error_pattern = _detect_error_pattern(
            request.studentId,
            question,
            request.answer,
            request.responseTimeMs,
        )

    skill_update = _update_mastery(request.studentId, question["skillId"], correct)
    response: dict[str, Any] = {
        "attemptId": _attempt_id(),
        "correct": correct,
        "skillUpdate": skill_update,
        "feedback": _feedback(correct, question),
    }

    if not correct:
        response["detectedErrorPattern"] = {
            "code": detected_error_pattern,
            "label": ERROR_LABELS.get(detected_error_pattern, detected_error_pattern),
            "confidence": 0.78 if detected_error_pattern != "UNKNOWN_ERROR" else 0.4,
        }

    if question["purpose"] == "diagnostic" and session is not None:
        _record_diagnostic_answer(session, question, correct, detected_error_pattern)
        if _should_complete(session):
            _complete_session(session)
        response["diagnosisSession"] = _session_summary(session)
        next_question = (
            None if session["status"] == "completed" else _get_next_diagnostic_question(session)
        )
        response["next"] = (
            _next_for_completed_session(session)
            if session["status"] == "completed"
            else {
                "action": "continue_diagnostic",
                "questionId": next_question["id"] if next_question else None,
                "diagnosisSessionId": session["id"],
            }
        )
    elif correct:
        response["next"] = _next_question_after_correct(request.questionId)
    else:
        session = _start_diagnosis_session(request, question, detected_error_pattern)
        next_question = _get_next_diagnostic_question(session)
        response["candidateSkills"] = _candidate_list(
            session, "suspicionScore", direct_only=True
        )
        response["diagnosisSession"] = _session_summary(session)
        response["next"] = {
            "action": "continue_diagnostic",
            "questionId": next_question["id"] if next_question else None,
            "diagnosisSessionId": session["id"],
        }

    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/learning-packages/{package_id}", response_model=ApiSuccess)
async def get_learning_package(package_id: str) -> dict[str, Any]:
    package = _require_package(package_id)
    return success_response(_copy(package))


@app.post("/api/v1/attempts")
async def submit_attempt(request: AttemptRequest) -> dict[str, Any]:
    if request.eventId in attempts_by_event_id:
        if not _same_attempt_event(
            attempt_event_snapshots.get(request.eventId),
            request.model_dump(mode="json"),
        ):
            raise ApiError(
                "INVALID_REQUEST",
                "eventId đã được sử dụng cho payload khác.",
                422,
                {"eventId": request.eventId},
            )
        return success_response(_copy(attempts_by_event_id[request.eventId]))

    response = _process_attempt(request)

    attempts_by_event_id[request.eventId] = _copy(response)
    attempt_event_snapshots[request.eventId] = request.model_dump(mode="json")
    _record_runtime_event(
        event_id=request.eventId,
        student_id=request.studentId,
        event_type="question_attempted",
        occurred_at=request.deviceTimestamp,
        question_id=request.questionId,
        response=response,
        source="online",
    )
    return success_response(response)


@app.get("/api/v1/diagnosis-sessions/{diagnosis_session_id}")
async def get_diagnosis_session(diagnosis_session_id: str) -> dict[str, Any]:
    session = diagnosis_sessions.get(diagnosis_session_id)
    if session is None:
        raise ApiError("SESSION_NOT_FOUND", "Không tìm thấy phiên chẩn đoán.", 404)

    if session["status"] == "completed":
        return success_response(
            {
                "id": session["id"],
                "status": session["status"],
                "diagnosis": session["diagnosis"],
                "learningPath": session["learningPath"],
                "next": _next_for_completed_session(session),
            }
        )

    return success_response(
        {
            "id": session["id"],
            "studentId": session["studentId"],
            "triggerQuestionId": session["triggerQuestionId"],
            "triggerSkillId": session["triggerSkillId"],
            "status": session["status"],
            "answeredCount": session["answeredCount"],
            "maxQuestions": session["maxQuestions"],
            "candidates": _candidate_list(session, "score"),
            "nextQuestion": _get_next_diagnostic_question(session),
        }
    )


@app.post("/api/v1/ai/rewrite-explanation")
async def rewrite_explanation_with_ai(
    payload: RewriteExplanationApiRequest,
) -> dict[str, Any]:
    _require_package(payload.packageId)
    try:
        source = ai_content_service.verified_explanation(payload.contentId)
        result = ai_content_service.rewrite_explanation(
            RewriteExplanationRequest(
                skillId=payload.skillId,
                sourceContent=source,
                style=payload.style,
                constraints=payload.constraints,
            )
        )
    except (AIContentError, ValueError) as exc:
        raise ApiError("AI_CONTENT_ERROR", str(exc), 422) from exc
    return success_response(result.model_dump(mode="json"))


@app.post("/api/v1/ai/generate-question-variant")
async def generate_question_variant_with_ai(
    payload: GenerateQuestionVariantApiRequest,
) -> dict[str, Any]:
    _require_package(payload.packageId)
    try:
        source = ai_content_service.verified_question(payload.questionId)
        result = ai_content_service.generate_question_variant(
            GenerateQuestionVariantRequest(
                skillId=payload.skillId,
                sourceContent=source,
                style=payload.style,
                constraints=payload.constraints,
            )
        )
    except (AIContentError, ValueError) as exc:
        raise ApiError("AI_CONTENT_ERROR", str(exc), 422) from exc
    return success_response(result.model_dump(mode="json"))


@app.post("/api/v1/ai/generate-diagnosis-hint")
async def generate_diagnosis_hint_with_ai(
    payload: GenerateDiagnosisHintApiRequest,
) -> dict[str, Any]:
    _require_package(payload.packageId)
    session = diagnosis_sessions.get(payload.diagnosisSessionId)
    if session is None:
        raise ApiError("SESSION_NOT_FOUND", "Không tìm thấy phiên chẩn đoán.", 404)
    if session["status"] != "completed":
        raise ApiError(
            "AI_HINT_NOT_READY",
            "Phiên chẩn đoán chưa hoàn tất.",
            409,
            {"diagnosisSessionId": payload.diagnosisSessionId},
        )

    diagnosis = session.get("diagnosis") or {}
    root_gap = diagnosis.get("rootGap")
    if not isinstance(root_gap, dict) or not root_gap.get("skillId"):
        raise ApiError(
            "AI_HINT_NOT_AVAILABLE",
            "Phiên chẩn đoán không có lỗ hổng kiến thức để tạo gợi ý.",
            409,
            {"diagnosisSessionId": payload.diagnosisSessionId},
        )

    skill_id = str(root_gap["skillId"])
    try:
        source = ai_content_service.verified_diagnosis(
            payload.diagnosisSessionId,
            skill_id=skill_id,
            confidence=float(diagnosis["confidence"]),
            evidence=diagnosis["evidence"],
            root_gap_skill_id=skill_id,
            last_error_pattern=session.get("triggerErrorPattern"),
        )
        result = ai_content_service.generate_hint_from_diagnosis(
            GenerateHintFromDiagnosisRequest(
                skillId=skill_id,
                sourceContent=source,
                style=payload.style,
                constraints=payload.constraints,
            )
        )
    except (AIContentError, ValueError, KeyError, TypeError) as exc:
        raise ApiError("AI_CONTENT_ERROR", str(exc), 422) from exc
    return success_response(result.model_dump(mode="json"))


def _runtime_student_ids(class_id: str) -> set[str]:
    return {
        record["studentId"]
        for record in runtime_event_state.values()
        if students_by_id.get(record["studentId"], {}).get("classId") == class_id
    }


def _seed_gap_members() -> dict[str, set[str]]:
    members: dict[str, set[str]] = {}
    for group in class_insights_seed.get("groups", []):
        members.setdefault(group["skillId"], set()).update(group["studentIds"])
    for student in class_insights_seed.get("priorityStudents", []):
        skill_id = student.get("rootGapSkillId")
        if skill_id:
            members.setdefault(skill_id, set()).add(student["studentId"])
    return members


def _runtime_support_for_student(student_id: str) -> dict[str, Any] | None:
    sessions = [
        session
        for session in diagnosis_sessions.values()
        if session.get("studentId") == student_id
    ]
    for session in reversed(sessions):
        if session.get("status") != "completed":
            continue
        diagnosis = session.get("diagnosis") or {}
        root_gap = diagnosis.get("rootGap")
        if diagnosis.get("classification") == "careless_mistake" and not root_gap:
            return None
        if root_gap:
            skill_id = root_gap["skillId"]
            mastery_score, _status = _student_mastery(student_id, skill_id)
            return _support_item(
                student_id,
                skill_id,
                mastery_score,
                [
                    "Đã hoàn tất chẩn đoán và xác định lỗ hổng gốc",
                    "Cần theo dõi lộ trình củng cố trước khi quay lại bài mục tiêu",
                ],
            )

    for session in reversed(sessions):
        if session.get("status") == "in_progress":
            candidates = session.get("candidateScores", {})
            if candidates:
                skill_id = max(candidates, key=candidates.get)
                mastery_score, _status = _student_mastery(student_id, skill_id)
                return _support_item(
                    student_id,
                    skill_id,
                    mastery_score,
                    ["Đang trong phiên chẩn đoán", "Cần hoàn tất bằng chứng hỗ trợ"],
                )

    core_skill_ids = ["F08", "F11", "F14", "R02", "E01"]
    available = [
        (skill_id, _student_mastery(student_id, skill_id)[0])
        for skill_id in core_skill_ids
        if skill_id in skills_by_id
    ]
    if not available:
        return None
    skill_id, mastery_score = min(available, key=lambda item: item[1])
    threshold = float(skills_by_id[skill_id]["masteryThreshold"])
    if mastery_score >= threshold:
        return None
    return _support_item(
        student_id,
        skill_id,
        mastery_score,
        ["Mastery hiện tại dưới ngưỡng hỗ trợ", "Cần theo dõi thêm trong lượt học tiếp theo"],
    )


def _support_item(
    student_id: str,
    skill_id: str,
    mastery_score: float,
    reasons: list[str],
) -> dict[str, Any]:
    priority_score = round(min(1.0, max(0.0, 1.0 - mastery_score)), 2)
    priority_level = (
        "high" if priority_score >= 0.8 else "medium" if priority_score >= 0.5 else "low"
    )
    student = students_by_id[student_id]
    return {
        "studentId": student_id,
        "studentName": student["name"],
        "priorityScore": priority_score,
        "priorityLevel": priority_level,
        "rootGapSkillId": skill_id,
        "rootGapSkillName": skills_by_id[skill_id]["name"],
        "reasons": reasons,
    }


def _affected_skill_ids(skill_id: str) -> list[str]:
    affected: list[str] = []
    pending = [skill_id]
    while pending:
        current = pending.pop(0)
        for edge in edges:
            if edge.get("from") != current or edge.get("type") not in {
                "PREREQUISITE_OF",
                "SUPPORTS",
            }:
                continue
            target = edge.get("to")
            if target in skills_by_id and target not in affected:
                affected.append(target)
                pending.append(target)
    return affected


def _gap_severity(percentage: float) -> str:
    if percentage >= 0.25:
        return "high"
    if percentage >= 0.1:
        return "medium"
    return "low"


def _runtime_common_gaps(
    support_by_student: dict[str, dict[str, Any] | None],
) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    seed_members = _seed_gap_members()
    updated_members = {skill_id: set(ids) for skill_id, ids in seed_members.items()}
    for student_id, support in support_by_student.items():
        for member_ids in updated_members.values():
            member_ids.discard(student_id)
        if support:
            updated_members.setdefault(support["rootGapSkillId"], set()).add(student_id)

    seed_gaps = {
        gap["skillId"]: gap for gap in class_insights_seed.get("commonGaps", [])
    }
    skill_ids = list(seed_gaps)
    for skill_id in updated_members:
        if skill_id not in skill_ids and updated_members[skill_id]:
            skill_ids.append(skill_id)

    class_size = class_insights_seed["class"]["studentCount"]
    gaps: list[dict[str, Any]] = []
    for skill_id in skill_ids:
        seed_gap = seed_gaps.get(skill_id)
        current_members = updated_members.get(skill_id, set())
        if seed_gap:
            baseline_known = seed_members.get(skill_id, set())
            count = seed_gap["studentCount"] + len(current_members - baseline_known)
            count -= len(baseline_known - current_members)
        else:
            count = len(current_members)
        if count <= 0:
            continue

        skill = skills_by_id[skill_id]
        gap = _copy(seed_gap) if seed_gap else {
            "skillId": skill_id,
            "skillName": skill["name"],
            "grade": skill["grade"],
            "affectedSkills": _affected_skill_ids(skill_id),
        }
        percentage = round(count / class_size, 2)
        gap.update(
            {
                "studentCount": count,
                "percentage": percentage,
                "severity": _gap_severity(percentage),
            }
        )
        gaps.append(gap)
    return gaps, updated_members


def _runtime_groups(
    updated_members: dict[str, set[str]],
) -> list[dict[str, Any]]:
    seed_groups = {
        group["skillId"]: group for group in class_insights_seed.get("groups", [])
    }
    groups: list[dict[str, Any]] = []
    for skill_id, seed_group in seed_groups.items():
        member_ids = sorted(updated_members.get(skill_id, set()))
        if not member_ids:
            continue
        group = _copy(seed_group)
        group["studentIds"] = member_ids
        group["studentCount"] = len(member_ids)
        groups.append(group)

    for skill_id, member_ids in updated_members.items():
        if skill_id in seed_groups or not member_ids:
            continue
        groups.append(
            {
                "id": f"group-{skill_id.lower()}",
                "name": f"Cần củng cố {skills_by_id[skill_id]['name'].lower()}",
                "skillId": skill_id,
                "studentCount": len(member_ids),
                "studentIds": sorted(member_ids),
                "recommendedAction": "small_group_reteach",
            }
        )
    return groups


def _runtime_priority_students(
    support_by_student: dict[str, dict[str, Any] | None],
) -> list[dict[str, Any]]:
    priority_by_student = {
        item["studentId"]: _copy(item)
        for item in class_insights_seed.get("priorityStudents", [])
    }
    for student_id, support in support_by_student.items():
        if support is None:
            priority_by_student.pop(student_id, None)
        else:
            priority_by_student[student_id] = support
    return sorted(
        priority_by_student.values(),
        key=lambda item: (-item["priorityScore"], item["studentId"]),
    )


def _runtime_reteach_suggestions(
    gaps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    seed_suggestions = {
        suggestion["skillId"]: suggestion
        for suggestion in class_insights_seed.get("reteachSuggestions", [])
    }
    suggestions: list[dict[str, Any]] = []
    for priority, gap in enumerate(
        sorted(gaps, key=lambda item: (-item["studentCount"], item["skillId"])),
        start=1,
    ):
        skill_id = gap["skillId"]
        suggestion = _copy(seed_suggestions.get(skill_id, {}))
        suggestion.setdefault("skillId", skill_id)
        suggestion.setdefault("title", f"Ôn lại {gap['skillName'].lower()}")
        suggestion.setdefault("estimatedMinutes", 8)
        suggestion.setdefault(
            "activities",
            ["Nhắc lại khái niệm cốt lõi", "Thực hiện một ví dụ trực quan", "Làm câu kiểm tra nhanh"],
        )
        suggestion["reason"] = f"{gap['studentCount']} học sinh đang gặp cùng một lỗ hổng."
        suggestion["priority"] = priority
        suggestions.append(suggestion)
    return suggestions


def _runtime_summary(
    support_by_student: dict[str, dict[str, Any] | None],
) -> dict[str, Any]:
    summary = _copy(class_insights_seed["summary"])
    seed_priority_ids = {
        item["studentId"] for item in class_insights_seed.get("priorityStudents", [])
    }
    support_delta = 0
    for student_id, support in support_by_student.items():
        before = student_id in seed_priority_ids
        after = support is not None
        support_delta += int(after) - int(before)
    summary["studentsNeedSupport"] = max(
        0, summary["studentsNeedSupport"] + support_delta
    )
    summary["studentsOnTrack"] = max(0, summary["studentsOnTrack"] - support_delta)
    return summary


def _runtime_sync_status(class_id: str) -> dict[str, Any]:
    status = _copy(class_insights_seed["syncStatus"])
    records = [
        record
        for record in runtime_event_state.values()
        if students_by_id.get(record["studentId"], {}).get("classId") == class_id
    ]
    if not records:
        return status
    runtime_students = {record["studentId"] for record in records}
    synced_students = status["syncedStudents"] + len(runtime_students)
    class_size = class_insights_seed["class"]["studentCount"]
    status["syncedStudents"] = min(class_size, synced_students)
    status["offlineStudents"] = max(0, class_size - status["syncedStudents"])
    status["lastUpdatedAt"] = max(record["occurredAt"] for record in records)
    return status


def _build_class_insights(class_id: str) -> dict[str, Any]:
    """Build a read-only dashboard snapshot from seed plus canonical runtime state."""

    data = _copy(class_insights_seed)
    runtime_students = _runtime_student_ids(class_id)
    if not runtime_students:
        return data

    support_by_student = {
        student_id: _runtime_support_for_student(student_id)
        for student_id in runtime_students
    }
    common_gaps, updated_members = _runtime_common_gaps(support_by_student)
    data["syncStatus"] = _runtime_sync_status(class_id)
    data["summary"] = _runtime_summary(support_by_student)
    data["commonGaps"] = common_gaps
    data["groups"] = _runtime_groups(updated_members)
    data["priorityStudents"] = _runtime_priority_students(support_by_student)
    data["reteachSuggestions"] = _runtime_reteach_suggestions(common_gaps)
    return data


@app.get("/api/v1/classes/{class_id}/insights")
async def get_class_insights(
    class_id: str, packageId: str | None = None
) -> dict[str, Any]:
    if packageId is not None:
        _require_package(packageId)
    if class_id != class_insights["class"]["id"]:
        raise ApiError("CLASS_NOT_FOUND", "Không tìm thấy lớp học.", 404)
    return success_response(_build_class_insights(class_id))


def _reject_event(
    event: SyncEvent, code: str, message: str, retryable: bool = False
) -> dict[str, Any]:
    return {
        "eventId": event.eventId,
        "code": code,
        "message": message,
        "retryable": retryable,
    }


def _sync_attempt_request(
    event: SyncEvent, student_id: str, package_id: str
) -> AttemptRequest:
    payload_context = event.payload.get("context")
    context = dict(payload_context) if isinstance(payload_context, dict) else {}
    for field_name in ("diagnosisSessionId", "learningPathId", "learningStepId"):
        if field_name in event.payload:
            context[field_name] = event.payload[field_name]

    return AttemptRequest.model_validate(
        {
            "eventId": event.eventId,
            "studentId": student_id,
            "classId": students_by_id[student_id]["classId"],
            "packageId": package_id,
            "questionId": event.payload.get("questionId"),
            "purpose": event.payload.get("purpose"),
            "context": context,
            "answer": event.payload.get("answer"),
            "responseTimeMs": event.payload.get("responseTimeMs", 0),
            "attemptNumber": event.payload.get("attemptNumber", 1),
            "deviceTimestamp": event.createdAt,
            "offlineCreated": True,
        }
    )


def _attempt_snapshot_for_idempotency(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Ignore only transport provenance when comparing one event across paths."""

    return {
        key: value for key, value in snapshot.items() if key != "offlineCreated"
    }


def _same_attempt_event(
    previous_snapshot: dict[str, Any] | None,
    incoming_snapshot: dict[str, Any],
) -> bool:
    if previous_snapshot is None:
        return False
    return _attempt_snapshot_for_idempotency(
        previous_snapshot
    ) == _attempt_snapshot_for_idempotency(incoming_snapshot)


def _validate_sync_learning_event(
    event: SyncEvent, student_id: str
) -> None:
    learning_path_id = event.payload.get("learningPathId")
    learning_step_id = event.payload.get("learningStepId")
    if not isinstance(learning_path_id, str) or not learning_path_id:
        raise ApiError("INVALID_EVENT", "Thiếu learningPathId.")
    if event.type == "learning_step_completed" and (
        not isinstance(learning_step_id, str) or not learning_step_id
    ):
        raise ApiError("INVALID_EVENT", "Thiếu learningStepId.")

    context = AttemptContext(
        diagnosisSessionId=event.payload.get("diagnosisSessionId"),
        learningPathId=learning_path_id,
        learningStepId=learning_step_id,
    )
    _validate_learning_context(
        AttemptRequest(
            eventId=event.eventId,
            studentId=student_id,
            classId=students_by_id[student_id]["classId"],
            packageId=learning_package["packageId"],
            questionId="sync-context",
            purpose="target",
            context=context,
            answer={"type": "multiple_choice", "value": ""},
            responseTimeMs=0,
            attemptNumber=1,
            deviceTimestamp=event.createdAt,
        )
    )
    _validate_diagnosis_session_reference(context.diagnosisSessionId, student_id)


def _validate_sync_event(
    event: SyncEvent, student_id: str, package_id: str
) -> dict[str, Any] | None:
    valid_types = set(SyncEventType.__args__)  # type: ignore[attr-defined]
    if event.type not in valid_types:
        return _reject_event(event, "INVALID_EVENT", "Loại event không hợp lệ.")

    if event.type == "question_attempted":
        question_id = event.payload.get("questionId")
        if not isinstance(question_id, str) or question_id not in questions_by_id:
            return _reject_event(event, "QUESTION_NOT_FOUND", "Không tìm thấy câu hỏi.")
        try:
            request = _sync_attempt_request(event, student_id, package_id)
            question = _require_question(request.questionId)
            _validate_attempt_source_of_truth(request, question)
        except ValidationError:
            return _reject_event(event, "INVALID_EVENT", "Payload question_attempted không hợp lệ.")
        except ApiError as exc:
            return _reject_event(
                event,
                exc.code if exc.code in {"INVALID_EVENT", "QUESTION_NOT_FOUND"} else "INVALID_EVENT",
                exc.message,
            )
        return None

    try:
        _validate_sync_learning_event(event, student_id)
    except ValidationError:
        return _reject_event(event, "INVALID_EVENT", "Payload learning event không hợp lệ.")
    except ApiError as exc:
        return _reject_event(
            event,
            exc.code if exc.code in {"INVALID_EVENT", "SESSION_NOT_FOUND"} else "INVALID_EVENT",
            exc.message,
        )

    return None


def _apply_sync_event(
    event: SyncEvent,
    student_id: str,
    attempt_response: dict[str, Any] | None = None,
    event_snapshot: dict[str, Any] | None = None,
) -> None:
    """Apply one already-validated event exactly once to MVP in-memory state."""

    if event.type == "question_attempted":
        sync_event_state[event.eventId] = {
            "type": event.type,
            "studentId": student_id,
            "attemptResponse": _copy(attempt_response),
            "event": _copy(event_snapshot),
        }
        return

    # The MVP has no persistence layer. Keep the accepted learning events in
    # memory so their successful application is observable and idempotent.
    sync_event_state[event.eventId] = {
        "type": event.type,
        "studentId": student_id,
        "learningPathId": event.payload["learningPathId"],
        "learningStepId": event.payload.get("learningStepId"),
        "event": _copy(event_snapshot),
    }


@app.post("/api/v1/sync")
async def sync(payload: SyncRequest) -> dict[str, Any]:
    _require_package(payload.packageId)
    _require_student(payload.studentId)

    accepted_event_ids: list[str] = []
    duplicate_event_ids: list[str] = []
    rejected_events: list[dict[str, Any]] = []

    if payload.packageVersion != learning_package["version"]:
        return success_response(
            {
                "acceptedEventIds": [],
                "duplicateEventIds": [],
                "rejectedEvents": [
                    _reject_event(
                        event,
                        "PACKAGE_VERSION_MISMATCH",
                        "Package version trên thiết bị đã cũ.",
                    )
                    for event in payload.events
                ],
                "serverTimestamp": _utc_now(),
            }
        )

    for event in payload.events:
        if event.type == "question_attempted" and event.eventId in attempts_by_event_id:
            try:
                incoming_attempt = _sync_attempt_request(
                    event, payload.studentId, payload.packageId
                )
            except (ValidationError, KeyError, TypeError):
                rejected_events.append(
                    _reject_event(event, "INVALID_EVENT", "Payload event không hợp lệ.")
                )
                continue

            if _same_attempt_event(
                attempt_event_snapshots.get(event.eventId),
                incoming_attempt.model_dump(mode="json"),
            ):
                duplicate_event_ids.append(event.eventId)
            else:
                rejected_events.append(
                    _reject_event(
                        event,
                        "INVALID_EVENT",
                        "eventId đã được sử dụng cho payload khác.",
                    )
                )
            continue

        if event.eventId in sync_event_ids:
            previous = sync_event_state.get(event.eventId, {})
            if previous.get("event") == event.model_dump(mode="json"):
                duplicate_event_ids.append(event.eventId)
            else:
                rejected_events.append(
                    _reject_event(
                        event,
                        "INVALID_EVENT",
                        "eventId đã được sử dụng cho payload khác.",
                    )
                )
            continue

        rejection = _validate_sync_event(event, payload.studentId, payload.packageId)
        if rejection:
            rejected_events.append(rejection)
            continue

        try:
            attempt_response = None
            attempt_request = None
            if event.type == "question_attempted":
                attempt_request = _sync_attempt_request(
                    event, payload.studentId, payload.packageId
                )
                attempt_response = _process_attempt(attempt_request)
            _apply_sync_event(
                event,
                payload.studentId,
                attempt_response,
                event.model_dump(mode="json"),
            )
            if attempt_request is not None and attempt_response is not None:
                attempts_by_event_id[event.eventId] = _copy(attempt_response)
                attempt_event_snapshots[event.eventId] = attempt_request.model_dump(
                    mode="json"
                )
            _record_runtime_event(
                event_id=event.eventId,
                student_id=payload.studentId,
                event_type=event.type,
                occurred_at=event.createdAt,
                question_id=event.payload.get("questionId"),
                response=attempt_response,
                source="offline",
            )
        except ValidationError:
            rejected_events.append(
                _reject_event(event, "INVALID_EVENT", "Payload event không hợp lệ.")
            )
            continue
        except ApiError as exc:
            rejected_events.append(
                _reject_event(
                    event,
                    exc.code
                    if exc.code in {"INVALID_EVENT", "QUESTION_NOT_FOUND", "SESSION_NOT_FOUND"}
                    else "INVALID_EVENT",
                    exc.message,
                )
            )
            continue

        sync_event_ids.add(event.eventId)
        accepted_event_ids.append(event.eventId)

    return success_response(
        {
            "acceptedEventIds": accepted_event_ids,
            "duplicateEventIds": duplicate_event_ids,
            "rejectedEvents": rejected_events,
            "serverTimestamp": _utc_now(),
        }
    )
