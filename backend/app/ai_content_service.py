"""Internal, guarded AI content generation for the learning package.

The diagnostic engine remains the owner of diagnosis state; this service can
only rewrite or generate content for a skill that the caller has already
selected and the API layer has verified.
"""

from __future__ import annotations

import os
import re
from copy import deepcopy
from fractions import Fraction
from typing import Any, Literal, Mapping, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .data_loader import validate_learning_package
from .models import LearningPackage, Question


QuestionType = Literal["multiple_choice", "numeric"]
QuestionPurpose = Literal["target", "diagnostic", "practice", "checkpoint"]
SourceContentType = Literal["explanation", "question", "diagnosis"]


class AIClient(Protocol):
    """Small provider boundary so tests can inject a mock and stay offline."""

    def generate(
        self,
        operation: str,
        payload: dict[str, Any],
        *,
        timeout: float,
    ) -> Any:
        """Return provider JSON-like output for one content operation."""


class AIContentError(RuntimeError):
    """Raised when neither a provider response nor a safe fallback is usable."""


class AIModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContentConstraints(AIModel):
    """Constraints shared by all internal content requests.

    Question-only fields are optional because the same request shape is used by
    explanation and hint operations.  The question operation merges omitted
    values with the validated package template and source question.
    """

    questionType: QuestionType | None = None
    difficulty: int | None = Field(default=None, ge=1)
    denominatorMax: int | None = Field(default=None, ge=1)
    singleCorrectAnswer: bool | None = None
    mustIncludeValidation: bool | None = None
    mustIncludeErrorMappings: bool | None = None
    allowedPurpose: QuestionPurpose | None = None
    allowedErrorPatterns: list[str] = Field(default_factory=list)
    maxSentences: int | None = Field(default=None, ge=1)
    maxWords: int | None = Field(default=None, ge=1)


class ExplanationSource(AIModel):
    contentId: str
    skillId: str
    contentType: Literal["explanation"] = "explanation"
    content: str = Field(min_length=1)
    verified: Literal[True] = True


class QuestionSource(AIModel):
    contentId: str
    skillId: str
    contentType: Literal["question"] = "question"
    content: Question
    verified: Literal[True] = True


class DiagnosisEvidence(AIModel):
    type: str
    skillId: str | None = None
    message: str = Field(min_length=1)


class DiagnosisSourceContent(AIModel):
    """Snapshot produced by the deterministic diagnostic engine.

    rootGapSkillId and confidence are accepted as provenance only.  They are
    never copied to an AI output and never recalculated here.
    """

    rootGapSkillId: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: list[DiagnosisEvidence] = Field(min_length=1)
    lastErrorPattern: str | None = None


class DiagnosisSource(AIModel):
    contentId: str
    skillId: str
    contentType: Literal["diagnosis"] = "diagnosis"
    content: DiagnosisSourceContent
    verified: Literal[True] = True


class RewriteExplanationRequest(AIModel):
    skillId: str
    sourceContent: ExplanationSource
    style: str = Field(min_length=1)
    constraints: ContentConstraints


class GenerateQuestionVariantRequest(AIModel):
    skillId: str
    sourceContent: QuestionSource
    style: str = Field(min_length=1)
    constraints: ContentConstraints


class GenerateHintFromDiagnosisRequest(AIModel):
    skillId: str
    sourceContent: DiagnosisSource
    style: str = Field(min_length=1)
    constraints: ContentConstraints


class ExplanationResult(AIModel):
    id: str
    skillId: str
    sourceContentId: str
    style: str
    content: str = Field(min_length=1)
    generated: bool
    fallbackUsed: bool


class QuestionVariantResult(AIModel):
    id: str
    skillId: str
    sourceQuestionId: str
    purpose: QuestionPurpose
    type: QuestionType
    difficulty: int = Field(ge=1)
    prompt: str = Field(min_length=1)
    options: list[dict[str, str]] = Field(default_factory=list)
    validation: dict[str, Any]
    errorMappings: dict[str, str] = Field(default_factory=dict)
    style: str
    generated: bool
    fallbackUsed: bool


class HintResult(AIModel):
    id: str
    skillId: str
    sourceContentId: str
    style: str
    message: str = Field(min_length=1)
    generated: bool
    fallbackUsed: bool


class _ExplanationDraft(AIModel):
    content: str = Field(min_length=1)
    id: str | None = None
    skillId: str | None = None
    style: str | None = None


class _HintDraft(AIModel):
    message: str = Field(min_length=1)
    id: str | None = None
    skillId: str | None = None
    style: str | None = None


_COMPACT_EXPLANATIONS: dict[str, tuple[str, ...]] = {
    "EXP_F08_BASIC": (
        "Phân số tương đương cùng giá trị; nhân tử và mẫu cùng số khác 0.",
        "Phân số tương đương cùng giá trị; nhân tử và mẫu nhân cùng số.",
    ),
    "EXP_F11_BASIC": (
        "Quy đồng về mẫu chung nhỏ nhất trước khi tính.",
        "Tìm mẫu chung; quy đồng trước khi tính.",
    ),
    "EXP_F14_BASIC": (
        "Quy đồng trước; cộng hoặc trừ tử số, giữ mẫu chung.",
        "Quy đồng trước rồi tính với mẫu chung.",
    ),
    "EXP_R02_SIGN": (
        "Xử lý dấu trước, rồi tính phần phân số.",
        "Xử lý dấu trước khi tính.",
    ),
}

_COMPACT_HINTS: tuple[str, ...] = (
    "Tìm mẫu chung; đổi phân số về mẫu đó.",
    "Tìm mẫu chung, rồi quy đồng từng phân số.",
)


class _QuestionDraft(BaseModel):
    """Provider envelope; the service applies the non-negotiable invariants."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    skillId: str
    purpose: QuestionPurpose
    type: QuestionType
    difficulty: int = Field(ge=1)
    prompt: str = Field(min_length=1)
    options: list[dict[str, Any]] = Field(default_factory=list)
    validation: dict[str, Any]
    errorMappings: dict[str, str] = Field(default_factory=dict)


class AIContentService:
    """Generate guarded learning content with deterministic offline fallback."""

    def __init__(
        self,
        package: LearningPackage | Mapping[str, Any],
        *,
        client: AIClient | None = None,
        api_key: str | None = None,
        timeout_seconds: float = 8.0,
    ) -> None:
        if isinstance(package, LearningPackage):
            self.package = package
        else:
            self.package = validate_learning_package(dict(package))
        self.client = client
        self.api_key = (
            api_key
            if api_key is not None
            else os.getenv("FPT_AI_API_KEY") or os.getenv("PEERSTUDY_AI_API_KEY")
        )
        self.timeout_seconds = timeout_seconds

        package_data = self.package.model_dump(mode="python")
        self._package_data = package_data
        self._questions = {item["id"]: item for item in package_data["questions"]}
        self._explanations = {item["id"]: item for item in package_data["explanations"]}
        self._templates = package_data.get("aiTemplates", [])

    def verified_explanation(self, content_id: str) -> ExplanationSource:
        """Build a source object from package data rather than caller text."""

        source = self._explanations.get(content_id)
        if source is None:
            raise AIContentError(f"Không tìm thấy explanation source: {content_id}")
        return ExplanationSource(
            contentId=content_id,
            skillId=source["skillId"],
            content=source["content"],
        )

    def verified_question(self, question_id: str) -> QuestionSource:
        """Build a question source from the validated learning package."""

        source = self._questions.get(question_id)
        if source is None:
            raise AIContentError(f"Không tìm thấy question source: {question_id}")
        return QuestionSource(
            contentId=question_id,
            skillId=source["skillId"],
            content=source,
        )

    @staticmethod
    def verified_diagnosis(
        content_id: str,
        *,
        skill_id: str,
        confidence: float,
        evidence: list[dict[str, Any]],
        root_gap_skill_id: str | None = None,
        last_error_pattern: str | None = None,
    ) -> DiagnosisSource:
        """Wrap diagnostic-engine evidence without deriving diagnosis state."""

        return DiagnosisSource(
            contentId=content_id,
            skillId=skill_id,
            content=DiagnosisSourceContent(
                rootGapSkillId=root_gap_skill_id,
                confidence=confidence,
                evidence=evidence,
                lastErrorPattern=last_error_pattern,
            ),
        )

    def rewrite_explanation(self, request: RewriteExplanationRequest) -> ExplanationResult:
        self._verify_explanation_source(request.skillId, request.sourceContent)
        template = self._template_for(
            "rewrite_explanation", request.skillId, request.sourceContent.contentId
        )

        raw = self._provider_call("rewrite_explanation", request)
        if raw is not None:
            try:
                draft = _ExplanationDraft.model_validate(raw)
                content = self._post_process_text(
                    draft.content,
                    request.constraints,
                    content_id=request.sourceContent.contentId,
                    kind="explanation",
                )
                if draft.skillId not in (None, request.skillId):
                    raise ValueError("AI đã thay đổi skillId.")
                if draft.style not in (None, request.style):
                    raise ValueError("AI đã thay đổi style.")
                return ExplanationResult(
                    id=draft.id or f"{request.sourceContent.contentId}__{request.style}",
                    skillId=request.skillId,
                    sourceContentId=request.sourceContent.contentId,
                    style=request.style,
                    content=content,
                    generated=True,
                    fallbackUsed=False,
                )
            except (ValidationError, ValueError, TypeError):
                pass

        fallback_id = (template or {}).get("fallbackContentId", request.sourceContent.contentId)
        fallback = self._explanations.get(fallback_id) or self._explanations.get(
            request.sourceContent.contentId
        )
        if fallback is None:
            raise AIContentError("Không có explanation fallback hợp lệ.")
        content = self._post_process_text(
            fallback["content"],
            request.constraints,
            content_id=request.sourceContent.contentId,
            kind="explanation",
        )
        return ExplanationResult(
            id=fallback["id"],
            skillId=request.skillId,
            sourceContentId=request.sourceContent.contentId,
            style=request.style,
            content=content,
            generated=False,
            fallbackUsed=True,
        )

    def generate_question_variant(
        self, request: GenerateQuestionVariantRequest
    ) -> QuestionVariantResult:
        self._verify_question_source(request.skillId, request.sourceContent)
        source_question = request.sourceContent.content
        template = self._template_for(
            "generate_question_variant", request.skillId, request.sourceContent.contentId
        )
        effective = self._question_constraints(request.constraints, source_question, template)

        raw = self._provider_call("generate_question_variant", request)
        if raw is not None:
            try:
                candidate = _QuestionDraft.model_validate(raw)
                result = self._validated_question_result(
                    candidate.model_dump(mode="python"), request, effective, generated=True
                )
                return result
            except (ValidationError, ValueError, TypeError):
                pass

        fallback_ids = (template or {}).get("fallbackQuestionIds", [])
        fallback_ids = [*fallback_ids, request.sourceContent.contentId]
        for question_id in fallback_ids:
            fallback = self._questions.get(question_id)
            if fallback is None:
                continue
            try:
                candidate = _QuestionDraft.model_validate(fallback)
                return self._validated_question_result(
                    candidate.model_dump(mode="python"), request, effective, generated=False
                )
            except (ValidationError, ValueError, TypeError):
                continue
        raise AIContentError("Không có question fallback vượt qua validator.")

    def generate_hint_from_diagnosis(
        self, request: GenerateHintFromDiagnosisRequest
    ) -> HintResult:
        self._verify_diagnosis_source(request.skillId, request.sourceContent)
        template = self._template_for("generate_hint", request.skillId, None)

        raw = self._provider_call("generate_hint_from_diagnosis", request)
        if raw is not None:
            try:
                draft = _HintDraft.model_validate(raw)
                message = self._post_process_text(
                    draft.message,
                    request.constraints,
                    content_id=request.sourceContent.contentId,
                    kind="hint",
                )
                if draft.skillId not in (None, request.skillId):
                    raise ValueError("AI đã thay đổi skillId.")
                if draft.style not in (None, request.style):
                    raise ValueError("AI đã thay đổi style.")
                return HintResult(
                    id=draft.id or f"HINT_{request.sourceContent.contentId}__{request.style}",
                    skillId=request.skillId,
                    sourceContentId=request.sourceContent.contentId,
                    style=request.style,
                    message=message,
                    generated=True,
                    fallbackUsed=False,
                )
            except (ValidationError, ValueError, TypeError):
                pass

        fallback_message = (template or {}).get("fallbackMessage")
        if not fallback_message:
            raise AIContentError("Không có hint fallback hợp lệ.")
        message = self._post_process_text(
            fallback_message,
            request.constraints,
            content_id=request.sourceContent.contentId,
            kind="hint",
        )
        return HintResult(
            id=f"HINT_{request.sourceContent.contentId}",
            skillId=request.skillId,
            sourceContentId=request.sourceContent.contentId,
            style=request.style,
            message=message,
            generated=False,
            fallbackUsed=True,
        )

    def _provider_call(self, operation: str, request: AIModel) -> Any | None:
        # An injected client is still required to declare a credential.  This
        # makes a missing key fail closed and keeps accidental network calls out
        # of offline/MVP execution.
        if self.client is None or not self.api_key:
            return None
        try:
            return self.client.generate(
                operation,
                request.model_dump(mode="json"),
                timeout=self.timeout_seconds,
            )
        except Exception:
            # Timeout, transport, provider, and malformed-response failures all
            # use the same deterministic fallback path.
            return None

    def _template_for(
        self, template_type: str, skill_id: str, source_id: str | None
    ) -> dict[str, Any] | None:
        for template in self._templates:
            if template.get("type") != template_type or template.get("skillId") != skill_id:
                continue
            if source_id is not None:
                expected = template.get("inputContentId", template.get("baseQuestionId"))
                if expected != source_id:
                    continue
            return template
        return None

    def _verify_explanation_source(self, skill_id: str, source: ExplanationSource) -> None:
        expected = self._explanations.get(source.contentId)
        if expected is None or expected["skillId"] != skill_id:
            raise AIContentError("Explanation source không thuộc skillId đã yêu cầu.")
        if source.skillId != skill_id or source.content != expected["content"]:
            raise AIContentError("Explanation source chưa được xác thực từ learning package.")

    def _verify_question_source(self, skill_id: str, source: QuestionSource) -> None:
        expected = self._questions.get(source.contentId)
        if expected is None or expected["skillId"] != skill_id:
            raise AIContentError("Question source không thuộc skillId đã yêu cầu.")
        if source.skillId != skill_id:
            raise AIContentError("Question source skillId không khớp.")
        if source.content.model_dump(mode="python") != expected:
            raise AIContentError("Question source chưa được xác thực từ learning package.")

    @staticmethod
    def _verify_diagnosis_source(skill_id: str, source: DiagnosisSource) -> None:
        if source.skillId != skill_id:
            raise AIContentError("Diagnosis source skillId không khớp.")
        if source.content.rootGapSkillId not in (None, skill_id):
            raise AIContentError("Diagnosis source không thuộc skillId đã yêu cầu.")

    @staticmethod
    def _post_process_text(
        text: str,
        constraints: ContentConstraints,
        *,
        content_id: str,
        kind: Literal["explanation", "hint"],
    ) -> str:
        """Normalize and validate provider and fallback text identically.

        When a package fallback is too long, only curated compact forms are
        considered.  This avoids arbitrary truncation that could remove the
        learning rule or the diagnostic action from a hint.
        """

        candidates = [re.sub(r"\s+", " ", text).strip()]
        if kind == "explanation":
            candidates.extend(_COMPACT_EXPLANATIONS.get(content_id, ()))
        else:
            candidates.extend(_COMPACT_HINTS)

        for candidate in candidates:
            if not candidate:
                continue
            if constraints.maxWords is not None and len(candidate.split()) > constraints.maxWords:
                continue
            if constraints.maxSentences is not None:
                sentence_count = len(re.findall(r"[^.!?]+(?:[.!?]|$)", candidate))
                if sentence_count > constraints.maxSentences:
                    continue
            return candidate
        raise ValueError("Nội dung không vượt qua text constraints.")

    @staticmethod
    def _question_constraints(
        constraints: ContentConstraints,
        source: Question,
        template: dict[str, Any] | None,
    ) -> dict[str, Any]:
        template_constraints = (template or {}).get("constraints", {})
        validator = (template or {}).get("validator", {})
        return {
            "questionType": constraints.questionType
            or template_constraints.get("questionType", source.type),
            "difficulty": constraints.difficulty
            or source.difficulty,
            "denominatorMax": constraints.denominatorMax
            or template_constraints.get("denominatorMax"),
            "singleCorrectAnswer": (
                constraints.singleCorrectAnswer
                if constraints.singleCorrectAnswer is not None
                else template_constraints.get("singleCorrectAnswer", True)
            ),
            "mustIncludeValidation": (
                constraints.mustIncludeValidation
                if constraints.mustIncludeValidation is not None
                else template_constraints.get("mustIncludeValidation", True)
            ),
            "mustIncludeErrorMappings": (
                constraints.mustIncludeErrorMappings
                if constraints.mustIncludeErrorMappings is not None
                else template_constraints.get("mustIncludeErrorMappings", False)
            ),
            "allowedPurpose": constraints.allowedPurpose
            or validator.get("allowedPurpose", "practice"),
            "allowedErrorPatterns": constraints.allowedErrorPatterns
            or validator.get("allowedErrorPatterns", []),
        }

    def _validated_question_result(
        self,
        candidate: dict[str, Any],
        request: GenerateQuestionVariantRequest,
        constraints: dict[str, Any],
        *,
        generated: bool,
    ) -> QuestionVariantResult:
        question_type = constraints["questionType"]
        if candidate["skillId"] != request.skillId:
            raise ValueError("Question skillId không khớp.")
        if candidate["purpose"] != constraints["allowedPurpose"]:
            raise ValueError("Question purpose không đúng constraint.")
        if candidate["type"] != question_type:
            raise ValueError("Question type không đúng constraint.")
        if candidate["difficulty"] != constraints["difficulty"]:
            raise ValueError("Question difficulty không đúng constraint.")
        if constraints["mustIncludeValidation"] and not candidate.get("validation"):
            raise ValueError("Question thiếu validation.")

        if question_type == "multiple_choice":
            options = candidate.get("options", [])
            option_ids = [str(option.get("id", "")) for option in options]
            option_texts = [str(option.get("text", "")).strip() for option in options]
            if len(option_ids) < 2 or any(not value for value in option_ids):
                raise ValueError("Options không hợp lệ.")
            if len(set(option_ids)) != len(option_ids):
                raise ValueError("Option id bị trùng.")
            if any(not text for text in option_texts):
                raise ValueError("Option text bị trùng hoặc rỗng.")
            semantic_options = [_option_semantic_key(text) for text in option_texts]
            if len(set(semantic_options)) != len(semantic_options):
                raise ValueError("Có nhiều hơn một option đúng về mặt nội dung.")
            validation = candidate["validation"]
            correct_answer = validation.get("correctAnswer")
            if correct_answer not in option_ids:
                raise ValueError("correctAnswer không tồn tại trong options.")
            incorrect_ids = set(option_ids) - {correct_answer}
            mappings = candidate.get("errorMappings", {})
            if correct_answer in mappings:
                raise ValueError("Đáp án đúng không được có error mapping.")
            if not set(mappings).issubset(incorrect_ids):
                raise ValueError("errorMappings chứa option không hợp lệ.")
            allowed_errors = set(constraints["allowedErrorPatterns"])
            if allowed_errors and not set(mappings.values()).issubset(allowed_errors):
                raise ValueError("errorMappings chứa pattern ngoài allowlist.")
            if constraints["mustIncludeErrorMappings"] and set(mappings) != incorrect_ids:
                raise ValueError("Question thiếu error mapping cho đáp án sai.")
        elif candidate.get("options"):
            raise ValueError("Numeric question không được có options.")
        elif "correctAnswer" not in candidate["validation"]:
            raise ValueError("Numeric question thiếu correctAnswer.")

        denominator_max = constraints.get("denominatorMax")
        if denominator_max is not None:
            all_text = " ".join(
                [candidate["prompt"], *[str(option.get("text", "")) for option in candidate.get("options", [])]]
            )
            denominators = _extract_denominators(all_text)
            if denominators and max(denominators) > denominator_max:
                raise ValueError("Question vượt denominatorMax.")

        options = [
            {"id": str(option["id"]), "text": str(option["text"])}
            for option in candidate.get("options", [])
        ]
        return QuestionVariantResult(
            id=candidate["id"],
            skillId=request.skillId,
            sourceQuestionId=request.sourceContent.contentId,
            purpose=candidate["purpose"],
            type=candidate["type"],
            difficulty=candidate["difficulty"],
            prompt=candidate["prompt"],
            options=options,
            validation=deepcopy(candidate["validation"]),
            errorMappings=deepcopy(candidate.get("errorMappings", {})),
            style=request.style,
            generated=generated,
            fallbackUsed=not generated,
        )


def _extract_denominators(text: str) -> list[int]:
    """Extract explicit fraction and Vietnamese 'mẫu số' denominators."""

    denominators = [int(value) for value in re.findall(r"(?<!\d)-?\d+\s*/\s*(\d+)", text)]
    denominators.extend(
        int(value)
        for value in re.findall(r"mẫu\s+số(?:\s+chung)?(?:\s*(?:là|=))?\s*(\d+)", text.lower())
    )
    return denominators


def _option_semantic_key(text: str) -> tuple[Any, ...]:
    """Normalize common numeric/fraction forms to catch duplicate answers."""

    fractions = re.findall(r"(-?\d+)\s*/\s*(\d+)", text)
    if fractions:
        values = []
        for numerator, denominator in fractions:
            if int(denominator) == 0:
                return ("invalid-fraction", text.strip().lower())
            values.append(Fraction(int(numerator), int(denominator)))
        return ("fractions", tuple(values))

    normalized = re.sub(r"\s+", " ", text.strip().lower())
    try:
        return ("number", Fraction(normalized))
    except (ValueError, ZeroDivisionError):
        return ("text", normalized)


def rewrite_explanation(
    service: AIContentService, request: RewriteExplanationRequest
) -> ExplanationResult:
    """Convenience function for internal callers that keep a service instance."""

    return service.rewrite_explanation(request)


def generate_question_variant(
    service: AIContentService, request: GenerateQuestionVariantRequest
) -> QuestionVariantResult:
    """Convenience function for internal callers that keep a service instance."""

    return service.generate_question_variant(request)


def generate_hint_from_diagnosis(
    service: AIContentService, request: GenerateHintFromDiagnosisRequest
) -> HintResult:
    """Convenience function for internal callers that keep a service instance."""

    return service.generate_hint_from_diagnosis(request)
