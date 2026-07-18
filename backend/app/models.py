from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from pydantic import BeforeValidator, BaseModel, ConfigDict, Field


def parse_utc_timestamp(value: Any) -> datetime:
    """Parse an ISO-8601 timestamp that explicitly identifies UTC."""

    if isinstance(value, str):
        if value.endswith("Z"):
            value = f"{value[:-1]}+00:00"
        elif not value.endswith("+00:00"):
            raise ValueError("Timestamp phải có timezone UTC (Z hoặc +00:00).")
        try:
            value = datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Timestamp không đúng định dạng ISO 8601.") from exc

    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("Timestamp không được là naive; phải có timezone UTC.")
    if value.utcoffset() != timedelta(0):
        raise ValueError("Timestamp chỉ được dùng timezone UTC.")
    return value.astimezone(UTC)


UtcTimestamp = Annotated[datetime, BeforeValidator(parse_utc_timestamp)]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class Skill(ApiModel):
    id: str
    name: str
    grade: int
    domain: str
    prerequisiteIds: list[str] = Field(default_factory=list)
    masteryThreshold: float


class QuestionOption(ApiModel):
    id: str
    text: str


class Question(ApiModel):
    id: str
    skillId: str
    purpose: Literal["target", "diagnostic", "practice", "checkpoint"]
    type: Literal["multiple_choice", "numeric"]
    difficulty: int
    prompt: str
    options: list[QuestionOption] = Field(default_factory=list)
    validation: dict[str, Any]
    errorMappings: dict[str, str] = Field(default_factory=dict)


class Explanation(ApiModel):
    id: str
    skillId: str
    style: str
    content: str


class WorkedExample(ApiModel):
    id: str
    skillId: str
    title: str
    steps: list[str]


class LearningStep(ApiModel):
    id: str
    order: int
    type: Literal[
        "micro_explanation",
        "worked_example",
        "practice",
        "checkpoint",
        "return_to_target",
    ]
    skillId: str
    contentId: str | None = None
    questionIds: list[str] = Field(default_factory=list)


class LearningPath(ApiModel):
    id: str
    targetSkillId: str
    rootGapSkillId: str
    status: Literal["not_started", "in_progress", "completed"]
    estimatedMinutes: int
    steps: list[LearningStep]


class LearningPackage(ApiModel):
    packageId: str
    version: int
    name: str
    updatedAt: str
    skills: list[Skill]
    questions: list[Question]
    explanations: list[Explanation] = Field(default_factory=list)
    workedExamples: list[WorkedExample] = Field(default_factory=list)
    learningPaths: list[LearningPath] = Field(default_factory=list)


class ApiSuccess(BaseModel):
    success: Literal[True] = True
    data: LearningPackage
    meta: dict[str, Any] | None = None


class ApiErrorBody(ApiModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ApiErrorResponse(BaseModel):
    success: Literal[False] = False
    error: ApiErrorBody
