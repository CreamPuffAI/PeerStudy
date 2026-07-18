from __future__ import annotations

import json

import httpx
import pytest

from backend.app.fpt_ai_client import FPTAIClient, FPTAIError


def test_streaming_request_uses_fpt_format_and_parses_json_content() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers["Authorization"]
        captured["body"] = json.loads(request.content.decode("utf-8"))
        events = [
            {"choices": [{"delta": {"content": '{"message":"Hãy tìm '}}]},
            {"choices": [{"delta": {"content": 'mẫu chung."}'}}]},
        ]
        content = "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events
        )
        content += "data: [DONE]\n\n"
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=content.encode("utf-8"),
        )

    transport = httpx.MockTransport(handler)
    provider = FPTAIClient(
        api_key="secret-token",
        model="demo-model",
        http_client=httpx.Client(transport=transport),
    )

    result = provider.generate(
        "generate_hint_from_diagnosis",
        {"skillId": "F11", "constraints": {"maxSentences": 2}},
        timeout=4.0,
    )

    assert result == {"message": "Hãy tìm mẫu chung."}
    assert captured["authorization"] == "Bearer secret-token"
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["model"] == "demo-model"
    assert body["stream"] is True
    assert [message["role"] for message in body["messages"]] == ["system", "user"]
    assert "secret-token" not in json.dumps(body)
    assert "Không được suy luận hoặc thay đổi rootGap" in body["messages"][0]["content"]


def test_non_streaming_response_and_code_fence_are_parsed() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "```json\n{\"content\":\"Giải thích ngắn.\"}\n```"
                        }
                    }
                ]
            },
        )

    provider = FPTAIClient(
        api_key="secret-token",
        model="demo-model",
        stream=False,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    result = provider.generate("rewrite_explanation", {}, timeout=4.0)

    assert result == {"content": "Giải thích ngắn."}


@pytest.mark.parametrize(
    "content",
    [
        "data: not-json\n\n",
        'data: {"choices":[{"delta":{"content":"not-json"}}]}\n\ndata: [DONE]\n\n',
    ],
)
def test_malformed_stream_is_rejected(content: str) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=content)

    provider = FPTAIClient(
        api_key="secret-token",
        model="demo-model",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(FPTAIError):
        provider.generate("generate_hint_from_diagnosis", {}, timeout=4.0)


def test_environment_requires_both_key_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FPT_AI_API_KEY", "token")
    monkeypatch.delenv("FPT_AI_MODEL", raising=False)
    assert FPTAIClient.from_env() is None

    monkeypatch.setenv("FPT_AI_MODEL", "model-name")
    provider = FPTAIClient.from_env()
    assert provider is not None
    assert provider.model == "model-name"
