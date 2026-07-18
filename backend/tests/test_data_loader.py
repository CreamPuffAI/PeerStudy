from __future__ import annotations

import copy
import json
from pathlib import Path
from shutil import copyfile

import pytest
from fastapi.testclient import TestClient

from backend.app.data_loader import (
    RUNTIME_JSON_FILES,
    DataIntegrityError,
    load_learning_package,
    load_runtime_data,
)
from backend.app.main import create_app


DATA_DIR = Path(__file__).resolve().parents[2] / "data"
PACKAGE_FILE = DATA_DIR / "learning-package.math-fractions-v1.json"


def package_data() -> dict:
    return json.loads(PACKAGE_FILE.read_text(encoding="utf-8"))


def write_package(tmp_path: Path, package: dict) -> Path:
    path = tmp_path / PACKAGE_FILE.name
    path.write_text(json.dumps(package, ensure_ascii=False), encoding="utf-8")
    return path


def write_runtime_data(tmp_path: Path, package: dict | None = None) -> None:
    write_package(tmp_path, package or package_data())
    for filename in RUNTIME_JSON_FILES:
        copyfile(DATA_DIR / filename, tmp_path / filename)


def test_loader_rejects_unreadable_json(tmp_path: Path) -> None:
    path = tmp_path / PACKAGE_FILE.name
    path.write_text("{not-json", encoding="utf-8")

    with pytest.raises(DataIntegrityError, match="JSON"):
        load_learning_package(tmp_path)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda package: package["questions"].append(
                copy.deepcopy(package["questions"][0])
            ),
            "ID",
        ),
        (
            lambda package: package["skills"][0]["prerequisiteIds"].append("missing"),
            "Prerequisite",
        ),
        (
            lambda package: package["learningPaths"][0]["steps"][0].update(
                contentId="missing-content"
            ),
            "contentId",
        ),
        (
            lambda package: package["learningPaths"][0]["steps"][0].update(
                questionIds=["missing-question"]
            ),
            "questionId",
        ),
        (
            lambda package: (
                package["skills"][0]["prerequisiteIds"].append("F03"),
                package["skills"][1]["prerequisiteIds"].append("F02"),
            ),
            "chu trình",
        ),
    ],
)
def test_loader_rejects_invalid_package_data(
    tmp_path: Path, mutation, message: str
) -> None:
    package = package_data()
    mutation(package)
    write_package(tmp_path, package)

    with pytest.raises(DataIntegrityError, match=message):
        load_learning_package(tmp_path)


def test_factory_uses_validated_package_and_contract_error_shape(
    tmp_path: Path,
) -> None:
    write_runtime_data(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/api/v1/learning-packages/math-fractions-v1")
    assert response.status_code == 200
    assert response.json()["success"] is True

    missing = client.get("/api/v1/learning-packages/missing")
    assert missing.status_code == 404
    assert missing.json() == {
        "success": False,
        "error": {
            "code": "PACKAGE_NOT_FOUND",
            "message": "Không tìm thấy gói học tập.",
            "details": {},
        },
    }


def test_startup_rejects_missing_runtime_reference(tmp_path: Path) -> None:
    write_runtime_data(tmp_path)
    path = tmp_path / "learningPaths.json"
    learning_paths = json.loads(path.read_text(encoding="utf-8"))
    learning_paths[0]["steps"][2]["questionIds"] = ["missing-runtime-question"]
    path.write_text(json.dumps(learning_paths), encoding="utf-8")

    with pytest.raises(DataIntegrityError, match="question"):
        load_runtime_data(tmp_path)


def test_startup_rejects_runtime_file_drift(tmp_path: Path) -> None:
    write_runtime_data(tmp_path)
    path = tmp_path / "questions.json"
    questions = json.loads(path.read_text(encoding="utf-8"))
    questions[0]["prompt"] = "runtime drift"
    path.write_text(json.dumps(questions), encoding="utf-8")

    with pytest.raises(DataIntegrityError, match="drift"):
        load_runtime_data(tmp_path)
