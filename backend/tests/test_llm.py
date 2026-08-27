import httpx
import pytest

from app.core.config import Settings
from app.input_processing import InputProcessingError, validate_upload_bytes
from app.llm import GeminiProvider, LLMProviderError, OpenAIProvider, create_provider, get_llm_status, parse_gloss_response
from app.services import build_motion_sequence


def test_provider_configuration_selects_gemini_and_openai() -> None:
    gemini = create_provider(Settings(llm_provider="gemini", gemini_api_key="gemini-key"))
    openai = create_provider(Settings(llm_provider="openai", openai_api_key="openai-key"))
    auto = create_provider(Settings(llm_provider="auto", gemini_api_key="gemini-key"))

    assert isinstance(gemini, GeminiProvider)
    assert isinstance(openai, OpenAIProvider)
    assert isinstance(auto, GeminiProvider)


def test_openai_provider_parses_structured_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(200, json={
            "usage": {"input_tokens": 7, "output_tokens": 5, "total_tokens": 12},
            "output": [{
                "content": [{"type": "output_text", "text": '{"glosses":["I","WATER"]}'}]
            }]
        })

    provider = OpenAIProvider("test-key", "test-model", transport=httpx.MockTransport(handler))

    assert provider.translate("I want water", ["I", "WATER"]) == ["I", "WATER"]
    status = get_llm_status(Settings(llm_provider="openai", openai_api_key="test-key", openai_model="test-model"))
    assert status["tokens"]["last_total"] == 12


def test_gemini_provider_parses_structured_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        body = request.read().decode("utf-8")
        assert "responseMimeType" in body
        return httpx.Response(200, json={
            "candidates": [{
                "content": {"parts": [{"text": '{"glosses":["HELLO"]}'}]}
            }]
        })

    provider = GeminiProvider("test-key", "test-model", transport=httpx.MockTransport(handler))

    assert provider.translate("hello", ["HELLO"]) == ["HELLO"]


def test_remote_providers_support_ocr_and_speech() -> None:
    def openai_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/audio/transcriptions"):
            return httpx.Response(200, json={"text": "hello from audio"})
        return httpx.Response(200, json={
            "output_text": "hello from image",
            "usage": {"input_tokens": 4, "output_tokens": 3, "total_tokens": 7}
        })

    provider = OpenAIProvider("test-key", "test-model", transport=httpx.MockTransport(openai_handler))
    assert provider.extract_image_text(b"image", "image/png") == "hello from image"
    assert provider.transcribe_audio(b"audio", "audio/webm") == "hello from audio"

    def gemini_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "hello from gemini"}]}}]
        })

    gemini = GeminiProvider("test-key", "test-model", transport=httpx.MockTransport(gemini_handler))
    assert gemini.extract_image_text(b"image", "image/png") == "hello from gemini"
    assert gemini.transcribe_audio(b"audio", "audio/webm") == "hello from gemini"


def test_missing_api_key_and_malformed_response_are_safe_errors() -> None:
    with pytest.raises(LLMProviderError) as missing:
        OpenAIProvider("", "test-model").translate("hello", ["HELLO"])
    assert missing.value.code == "missing_api_key"

    with pytest.raises(LLMProviderError) as malformed:
        parse_gloss_response('{"text":"not glosses"}')
    assert malformed.value.code == "missing_glosses"


def test_motion_sequence_reports_unknown_glosses() -> None:
    resolved, unknown = build_motion_sequence(
        ["HELLO", "UNKNOWN", "HELLO"],
        {"clips": [{"gloss": "hello", "motionPath": "/motion/hello.json"}]}
    )

    assert [item["gloss"] for item in resolved] == ["hello", "hello"]
    assert unknown == ["UNKNOWN"]


def test_upload_validation_rejects_empty_and_fake_images() -> None:
    with pytest.raises(InputProcessingError):
        validate_upload_bytes("document", ".txt", "text/plain", b"")

    with pytest.raises(InputProcessingError):
        validate_upload_bytes("image", ".png", "image/png", b"not-an-image")
