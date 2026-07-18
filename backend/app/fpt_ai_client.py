"""FPT AI Market chat-completions provider for guarded learning content."""

from __future__ import annotations

import json
import os
from typing import Any, Iterable

import httpx


DEFAULT_FPT_AI_BASE_URL = "https://mkp-api.fptcloud.com/chat/completions"


class FPTAIError(RuntimeError):
    """Raised when FPT AI cannot return one parseable JSON object."""


class FPTAIClient:
    """Small OpenAI-compatible client for the FPT AI Market endpoint.

    The client only translates an internal content request into the provider
    chat format. Domain validation remains owned by ``AIContentService``.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = DEFAULT_FPT_AI_BASE_URL,
        stream: bool = True,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("FPT_AI_API_KEY không được để trống.")
        if not model.strip():
            raise ValueError("FPT_AI_MODEL không được để trống.")
        if not base_url.startswith("https://"):
            raise ValueError("FPT_AI_BASE_URL phải dùng HTTPS.")

        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.stream = stream
        self.http_client = http_client or httpx.Client()

    @classmethod
    def from_env(cls) -> FPTAIClient | None:
        """Create a configured provider, or ``None`` for offline fallback."""

        api_key = os.getenv("FPT_AI_API_KEY", "").strip()
        model = os.getenv("FPT_AI_MODEL", "").strip()
        if not api_key or not model:
            return None

        stream_value = os.getenv("FPT_AI_STREAM", "true").strip().lower()
        stream = stream_value not in {"0", "false", "no", "off"}
        return cls(
            api_key=api_key,
            model=model,
            base_url=os.getenv("FPT_AI_BASE_URL", DEFAULT_FPT_AI_BASE_URL).strip(),
            stream=stream,
        )

    def generate(
        self,
        operation: str,
        payload: dict[str, Any],
        *,
        timeout: float,
    ) -> dict[str, Any]:
        """Call FPT chat completions and return exactly one JSON object."""

        request_body = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": self._system_prompt(operation),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"operation": operation, "input": payload},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                },
            ],
            "stream": self.stream,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        if self.stream:
            with self.http_client.stream(
                "POST",
                self.base_url,
                headers=headers,
                json=request_body,
                timeout=timeout,
            ) as response:
                response.raise_for_status()
                content = self._read_stream(response.iter_lines())
        else:
            response = self.http_client.post(
                self.base_url,
                headers=headers,
                json=request_body,
                timeout=timeout,
            )
            response.raise_for_status()
            content = self._extract_content(response.json())

        return self._parse_json_object(content)

    @staticmethod
    def _system_prompt(operation: str) -> str:
        schemas = {
            "rewrite_explanation": (
                '{"type":"object","required":["content"],"additionalProperties":false,'
                '"properties":{"id":{"type":"string"},"skillId":{"type":"string"},'
                '"style":{"type":"string"},"content":{"type":"string","minLength":1}}}'
            ),
            "generate_hint_from_diagnosis": (
                '{"type":"object","required":["message"],"additionalProperties":false,'
                '"properties":{"id":{"type":"string"},"skillId":{"type":"string"},'
                '"style":{"type":"string"},"message":{"type":"string","minLength":1}}}'
            ),
            "generate_question_variant": (
                '{"type":"object","required":["id","skillId","purpose","type",'
                '"difficulty","prompt","validation"],"additionalProperties":false,'
                '"properties":{"id":{"type":"string"},"skillId":{"type":"string"},'
                '"purpose":{"enum":["practice"]},'
                '"type":{"enum":["multiple_choice","numeric"]},'
                '"difficulty":{"type":"integer","minimum":1},"prompt":{"type":"string"},'
                '"options":{"type":"array","items":{"type":"object",'
                '"required":["id","text"],"properties":{"id":{"type":"string"},'
                '"text":{"type":"string"}}}},"validation":{"type":"object",'
                '"required":["correctAnswer"]},"errorMappings":{"type":"object"}}}'
            ),
        }
        schema = schemas.get(operation)
        if schema is None:
            raise FPTAIError(f"AI operation không được hỗ trợ: {operation}")

        return (
            "Bạn là bộ tạo nội dung học tập của PeerStudy. "
            "Chỉ trả về đúng MỘT JSON object hợp lệ, không Markdown, không code fence, "
            "không lời dẫn và không trường ngoài schema. Viết nội dung học tập bằng tiếng Việt. "
            "Dữ liệu input đã được diagnostic engine deterministic xác minh. "
            "Không được suy luận hoặc thay đổi rootGap, mastery, skillId, knowledge graph hay mục tiêu học tập. "
            "Với hint và explanation, không tiết lộ đáp án của câu đang kiểm tra. "
            "Tuân thủ toàn bộ constraints trong input. "
            f"Operation: {operation}. JSON schema bắt buộc: {schema}"
        )

    @classmethod
    def _read_stream(cls, lines: Iterable[str]) -> str:
        chunks: list[str] = []
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            if line == "[DONE]":
                break
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                raise FPTAIError("FPT AI stream chứa dòng không phải JSON.") from exc
            chunk = cls._extract_content(event)
            if chunk:
                chunks.append(chunk)

        content = "".join(chunks).strip()
        if not content:
            raise FPTAIError("FPT AI stream không có content.")
        return content

    @staticmethod
    def _extract_content(response_data: Any) -> str:
        if not isinstance(response_data, dict):
            raise FPTAIError("FPT AI response không phải JSON object.")

        choices = response_data.get("choices")
        if not isinstance(choices, list) or not choices:
            return ""
        choice = choices[0]
        if not isinstance(choice, dict):
            return ""

        for container_name in ("delta", "message"):
            container = choice.get(container_name)
            if isinstance(container, dict):
                content = container.get("content")
                if isinstance(content, str):
                    return content
        text = choice.get("text")
        return text if isinstance(text, str) else ""

    @staticmethod
    def _parse_json_object(content: str) -> dict[str, Any]:
        normalized = content.strip()
        if normalized.startswith("```") and normalized.endswith("```"):
            lines = normalized.splitlines()
            if len(lines) >= 3:
                normalized = "\n".join(lines[1:-1]).strip()
        try:
            parsed = json.loads(normalized)
        except json.JSONDecodeError as exc:
            raise FPTAIError("FPT AI content không phải JSON hợp lệ.") from exc
        if not isinstance(parsed, dict):
            raise FPTAIError("FPT AI content phải là một JSON object.")
        return parsed
