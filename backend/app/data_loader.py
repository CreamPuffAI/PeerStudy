from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import LearningPackage


RUNTIME_JSON_FILES = (
    "students.json",
    "classInsights.mock.json",
    "questions.json",
    "skills.json",
    "edges.json",
    "diagnosticRules.json",
    "learningPaths.json",
)


class DataIntegrityError(ValueError):
    """Raised when the offline learning package cannot be trusted."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


def load_json_file(path: Path) -> Any:
    """Read one UTF-8 JSON file and normalize read/parse errors."""

    try:
        with path.open(encoding="utf-8") as file:
            return json.load(file)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DataIntegrityError(
            "Không thể đọc file JSON.",
            {"path": str(path), "reason": str(exc)},
        ) from exc


def _ensure_unique_ids(
    package: dict[str, Any], collections: tuple[str, ...] | None = None
) -> None:
    collections = collections or (
        "skills",
        "questions",
        "explanations",
        "workedExamples",
        "learningPaths",
        "diagnosticRules",
        "aiTemplates",
    )
    for collection_name in collections:
        items = package.get(collection_name, [])
        seen: set[str] = set()
        for index, item in enumerate(items):
            item_id = item.get("id") if isinstance(item, dict) else None
            if not isinstance(item_id, str):
                raise DataIntegrityError(
                    "Mỗi phần tử dữ liệu phải có ID dạng string.",
                    {"collection": collection_name, "index": index},
                )
            if item_id in seen:
                raise DataIntegrityError(
                    "ID trong dữ liệu không được trùng.",
                    {"collection": collection_name, "id": item_id},
                )
            seen.add(item_id)


def _ensure_prerequisites_exist(package: dict[str, Any]) -> None:
    skill_ids = {skill["id"] for skill in package["skills"]}
    for skill in package["skills"]:
        for prerequisite_id in skill.get("prerequisiteIds", []):
            if prerequisite_id not in skill_ids:
                raise DataIntegrityError(
                    "Prerequisite skill không tồn tại.",
                    {"skillId": skill["id"], "prerequisiteId": prerequisite_id},
                )


def _ensure_runtime_collection_shapes(runtime_data: dict[str, Any]) -> None:
    for collection_name in RUNTIME_JSON_FILES:
        if collection_name == "classInsights.mock.json":
            if not isinstance(runtime_data[collection_name], dict):
                raise DataIntegrityError(
                    "Class insights runtime data phải là JSON object.",
                    {"file": collection_name},
                )
            continue
        if not isinstance(runtime_data[collection_name], list):
            raise DataIntegrityError(
                "Runtime data phải là JSON array.",
                {"file": collection_name},
            )


def _ensure_runtime_references(
    package: dict[str, Any], runtime_data: dict[str, Any]
) -> None:
    skills = runtime_data["skills.json"]
    questions = runtime_data["questions.json"]
    diagnostic_rules = runtime_data["diagnosticRules.json"]
    learning_paths = runtime_data["learningPaths.json"]
    skill_ids = {skill["id"] for skill in skills}
    question_ids = {question["id"] for question in questions}
    content_ids = {
        item["id"]
        for collection_name in ("explanations", "workedExamples", "contents")
        for item in package.get(collection_name, [])
    }

    for question in questions:
        if question.get("skillId") not in skill_ids:
            raise DataIntegrityError(
                "Question runtime tham chiếu skill không tồn tại.",
                {"questionId": question.get("id"), "skillId": question.get("skillId")},
            )

    for edge in runtime_data["edges.json"]:
        for field_name in ("from", "to"):
            if edge.get(field_name) not in skill_ids:
                raise DataIntegrityError(
                    "Knowledge graph runtime tham chiếu skill không tồn tại.",
                    {"edge": edge, "field": field_name},
                )

    for rule in diagnostic_rules:
        for candidate in rule.get("candidateSkills", []):
            if candidate.get("skillId") not in skill_ids:
                raise DataIntegrityError(
                    "Diagnostic rule runtime tham chiếu skill không tồn tại.",
                    {"ruleId": rule.get("id"), "skillId": candidate.get("skillId")},
                )
        for question_id in rule.get("recommendedDiagnosticQuestionIds", []):
            if question_id not in question_ids:
                raise DataIntegrityError(
                    "Diagnostic rule runtime tham chiếu question không tồn tại.",
                    {"ruleId": rule.get("id"), "questionId": question_id},
                )

    for path in learning_paths:
        for field_name in ("targetSkillId", "rootGapSkillId"):
            if path.get(field_name) not in skill_ids:
                raise DataIntegrityError(
                    "Learning path runtime tham chiếu skill không tồn tại.",
                    {"learningPathId": path.get("id"), "skillId": path.get(field_name)},
                )
        for step in path.get("steps", []):
            if step.get("skillId") not in skill_ids:
                raise DataIntegrityError(
                    "Learning step runtime tham chiếu skill không tồn tại.",
                    {"learningPathId": path.get("id"), "skillId": step.get("skillId")},
                )
            content_id = step.get("contentId")
            if content_id is not None and content_id not in content_ids:
                raise DataIntegrityError(
                    "Learning path runtime tham chiếu content không tồn tại.",
                    {"learningPathId": path.get("id"), "contentId": content_id},
                )
            for question_id in step.get("questionIds", []):
                if question_id not in question_ids:
                    raise DataIntegrityError(
                        "Learning path runtime tham chiếu question không tồn tại.",
                        {"learningPathId": path.get("id"), "questionId": question_id},
                    )

    _ensure_prerequisites_exist({"skills": skills})
    _ensure_no_prerequisite_cycle({"skills": skills})


def _canonical_json(value: Any) -> Any:
    if isinstance(value, list):
        normalized = [_canonical_json(item) for item in value]
        return sorted(normalized, key=lambda item: json.dumps(item, sort_keys=True))
    if isinstance(value, dict):
        return {key: _canonical_json(item) for key, item in sorted(value.items())}
    return value


def _ensure_runtime_matches_package(
    package: dict[str, Any], runtime_data: dict[str, Any]
) -> None:
    runtime_sources = {
        "questions": "questions.json",
        "skills": "skills.json",
        "edges": "edges.json",
        "diagnosticRules": "diagnosticRules.json",
        "learningPaths": "learningPaths.json",
    }
    for collection_name, filename in runtime_sources.items():
        if _canonical_json(package.get(collection_name, [])) != _canonical_json(
            runtime_data[filename]
        ):
            raise DataIntegrityError(
                "Runtime JSON bị drift so với aggregate learning package.",
                {"collection": collection_name, "runtimeFile": filename},
            )


def _ensure_learning_path_references_exist(package: dict[str, Any]) -> None:
    question_ids = {question["id"] for question in package["questions"]}
    content_ids = {
        item["id"]
        for collection_name in ("explanations", "workedExamples", "contents")
        for item in package.get(collection_name, [])
    }
    for path in package.get("learningPaths", []):
        for step in path.get("steps", []):
            content_id = step.get("contentId")
            if content_id is not None and content_id not in content_ids:
                raise DataIntegrityError(
                    "contentId trong learning path không tồn tại.",
                    {"learningPathId": path["id"], "contentId": content_id},
                )
            for question_id in step.get("questionIds", []):
                if question_id not in question_ids:
                    raise DataIntegrityError(
                        "questionId trong learning path không tồn tại.",
                        {"learningPathId": path["id"], "questionId": question_id},
                    )


def _ensure_no_prerequisite_cycle(package: dict[str, Any]) -> None:
    graph = {
        skill["id"]: set(skill.get("prerequisiteIds", []))
        for skill in package["skills"]
    }
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(skill_id: str, trail: list[str]) -> None:
        if skill_id in visiting:
            cycle_start = trail.index(skill_id) if skill_id in trail else 0
            cycle = trail[cycle_start:] + [skill_id]
            raise DataIntegrityError(
                "Knowledge graph có chu trình prerequisite.",
                {"cycle": cycle},
            )
        if skill_id in visited:
            return
        visiting.add(skill_id)
        for prerequisite_id in graph[skill_id]:
            visit(prerequisite_id, [*trail, skill_id])
        visiting.remove(skill_id)
        visited.add(skill_id)

    for skill_id in graph:
        visit(skill_id, [])


def validate_learning_package(raw_package: Any) -> LearningPackage:
    if not isinstance(raw_package, dict):
        raise DataIntegrityError("Learning package phải là một JSON object.")

    try:
        package = LearningPackage.model_validate(raw_package)
    except ValidationError as exc:
        raise DataIntegrityError(
            "Learning package không đúng API contract.",
            {"errors": exc.errors()},
        ) from exc

    package_data = package.model_dump(mode="python")
    _ensure_unique_ids({**raw_package, **package_data})
    _ensure_prerequisites_exist(package_data)
    _ensure_learning_path_references_exist({**raw_package, **package_data})
    _ensure_no_prerequisite_cycle(package_data)
    return package


def load_learning_package(
    data_dir: Path,
    filename: str = "learning-package.math-fractions-v1.json",
) -> LearningPackage:
    raw_package = load_json_file(data_dir / filename)
    return validate_learning_package(raw_package)


def load_runtime_data(
    data_dir: Path,
    package_filename: str = "learning-package.math-fractions-v1.json",
) -> dict[str, Any]:
    """Load and validate every JSON source used by the runtime."""

    raw_package = load_json_file(data_dir / package_filename)
    package = validate_learning_package(raw_package)
    runtime_data = {
        filename: load_json_file(data_dir / filename)
        for filename in RUNTIME_JSON_FILES
    }
    _ensure_runtime_collection_shapes(runtime_data)

    id_collections = {
        "students.json",
        "questions.json",
        "skills.json",
        "diagnosticRules.json",
        "learningPaths.json",
    }
    for filename in id_collections:
        if filename != "classInsights.mock.json":
            _ensure_unique_ids(
                {filename: runtime_data[filename]}, collections=(filename,)
            )

    _ensure_runtime_references(raw_package, runtime_data)
    _ensure_runtime_matches_package(raw_package, runtime_data)
    return {"learning_package": package, **runtime_data}
