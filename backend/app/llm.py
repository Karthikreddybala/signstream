from __future__ import annotations

import json
import base64
from datetime import datetime, timezone
from threading import Lock
from time import perf_counter
from typing import Any

import httpx

from .core.config import Settings
from .services import match_glosses


GLOSS_SCHEMA = {
    "type": "object",
    "properties": {
        "glosses": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["glosses"],
    "additionalProperties": False
}

_STATS_LOCK = Lock()
_PROVIDER_STATS: dict[str, dict[str, Any]] = {}


def _empty_stats() -> dict[str, Any]:
    return {
        "requests": 0,
        "successful_requests": 0,
        "failed_requests": 0,
        "last_status": "unknown",
        "last_error": None,
        "last_latency_ms": None,
        "last_checked_at": None,
        "last_prompt_tokens": None,
        "last_completion_tokens": None,
        "last_total_tokens": None,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }


def _number(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, number)


def _usage(payload: dict[str, Any] | None) -> tuple[int | None, int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None, None

    usage = payload.get("usage") or payload.get("usageMetadata") or {}
    prompt = _number(usage.get("input_tokens", usage.get("promptTokenCount")))
    completion = _number(usage.get("output_tokens", usage.get("candidatesTokenCount")))
    total = _number(usage.get("total_tokens", usage.get("totalTokenCount")))

    if total is None and prompt is not None and completion is not None:
        total = prompt + completion

    return prompt, completion, total


def _record_result(provider: str, model: str, started_at: float, success: bool, payload: dict[str, Any] | None = None, error: LLMProviderError | None = None) -> None:
    key = f"{provider.strip().lower()}:{model}"
    prompt, completion, total = _usage(payload)

    with _STATS_LOCK:
        stats = _PROVIDER_STATS.setdefault(key, _empty_stats())
        stats["requests"] += 1
        stats["last_status"] = "ok" if success else "error"
        stats["last_latency_ms"] = round((perf_counter() - started_at) * 1000, 2)
        stats["last_checked_at"] = datetime.now(timezone.utc).isoformat()

        if success:
            stats["successful_requests"] += 1
        else:
            stats["failed_requests"] += 1
            stats["last_error"] = {
                "code": error.code if error else "provider_error",
                "message": error.message if error else "The provider request failed.",
            }

        stats["last_prompt_tokens"] = prompt
        stats["last_completion_tokens"] = completion
        stats["last_total_tokens"] = total
        stats["prompt_tokens"] += prompt or 0
        stats["completion_tokens"] += completion or 0
        stats["total_tokens"] += total or 0


def resolve_provider_name(settings: Settings) -> str:
    requested = settings.llm_provider.strip().lower()

    if requested in {"", "auto"}:
        if settings.gemini_api_key.strip():
            return "gemini"
        if settings.openai_api_key.strip():
            return "openai"
        return "manifest"

    if requested in {"none", "disabled"}:
        return "manifest"

    return requested


def get_llm_status(settings: Settings) -> dict[str, Any]:
    provider = resolve_provider_name(settings)

    if provider == "openai":
        model = settings.openai_model
        key_configured = bool(settings.openai_api_key.strip())
        mode = "remote"
    elif provider == "gemini":
        model = settings.gemini_model
        key_configured = bool(settings.gemini_api_key.strip())
        mode = "remote"
    elif provider == "manifest":
        model = "local-manifest-matcher"
        key_configured = True
        mode = "local"
    else:
        model = "unknown"
        key_configured = False
        mode = "invalid"

    key = f"{provider}:{model}"
    with _STATS_LOCK:
        stats = dict(_PROVIDER_STATS.get(key, _empty_stats()))

    if provider == "manifest":
        responding = "yes"
    elif not key_configured:
        responding = "not_configured"
    elif stats["last_status"] == "ok":
        responding = "yes"
    elif stats["last_status"] == "error":
        responding = "no"
    else:
        responding = "unknown"

    budget = settings.llm_token_budget if settings.llm_token_budget > 0 else None
    remaining = max(0, budget - stats["total_tokens"]) if budget is not None else None

    return {
        "provider": provider,
        "model": model,
        "mode": mode,
        "configured": provider == "manifest" or key_configured,
        "api_key_configured": key_configured,
        "responding": responding,
        "requests": stats["requests"],
        "successful_requests": stats["successful_requests"],
        "failed_requests": stats["failed_requests"],
        "last_status": stats["last_status"],
        "last_error": stats["last_error"],
        "last_latency_ms": stats["last_latency_ms"],
        "last_checked_at": stats["last_checked_at"],
        "tokens": {
            "last_prompt": stats["last_prompt_tokens"],
            "last_completion": stats["last_completion_tokens"],
            "last_total": stats["last_total_tokens"],
            "session_prompt": stats["prompt_tokens"],
            "session_completion": stats["completion_tokens"],
            "session_total": stats["total_tokens"],
            "local_budget": budget,
            "remaining": remaining,
            "quota_remaining": None,
            "quota_note": "Provider account quota is not exposed by this API.",
        },
    }


class LLMProviderError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def build_gloss_instruction(available_glosses: list[str], language: str = "en") -> str:
    gloss_list = json.dumps(available_glosses, ensure_ascii=False)
    return (
        "Convert the user's language into an ordered Indian Sign Language gloss sequence. "
        "Return only the requested JSON object. Preserve meaningful order, include repeated "
        "glosses when they occur, and never invent a gloss. Every gloss must be copied exactly "
        "from the available list. Treat ordinary inflections and closely related forms as the "
        "same concept when a canonical gloss is available: raining -> rain, crying -> cry, "
        "eating -> eat, plural nouns -> singular nouns. Return the canonical available gloss, "
        f"not the inflected input. Input language: {language}. Available glosses: {gloss_list}"
    )


def parse_gloss_response(payload: Any) -> list[str]:
    value = payload

    if isinstance(payload, str):
        try:
            value = json.loads(payload)
        except json.JSONDecodeError as error:
            raise LLMProviderError("malformed_response", "The translation provider returned invalid JSON.", 502) from error

    if not isinstance(value, dict) or not isinstance(value.get("glosses"), list):
        raise LLMProviderError("missing_glosses", "The translation provider returned no valid gloss sequence.", 502)

    glosses = []
    for gloss in value["glosses"]:
        if not isinstance(gloss, str) or not gloss.strip():
            raise LLMProviderError("malformed_response", "The translation provider returned an invalid gloss.", 502)
        glosses.append(gloss.strip())

    return glosses


def _openai_text(payload: dict[str, Any]) -> str | None:
    response_text = payload.get("output_text")
    if isinstance(response_text, str) and response_text.strip():
        return response_text.strip()

    for item in payload.get("output", []):
        for content in item.get("content", []):
            text = content.get("text")
            if content.get("type") == "output_text" and isinstance(text, str) and text.strip():
                return text.strip()

    return None


def _gemini_text(payload: dict[str, Any]) -> str | None:
    for candidate in payload.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()

    return None


def _require_capability(provider: str) -> None:
    raise LLMProviderError(
        "capability_unavailable",
        f"{provider} is configured for local gloss matching only. Configure Gemini or OpenAI for OCR and speech-to-text.",
        503,
    )


class ManifestProvider:
    name = "manifest"
    model = "local-manifest-matcher"

    def translate(self, text: str, available_glosses: list[str], language: str = "en") -> list[str]:
        started_at = perf_counter()
        manifest = {"clips": [{"gloss": gloss} for gloss in available_glosses]}
        result = [str(clip["gloss"]) for clip in match_glosses(text, manifest)]
        _record_result(self.name, self.model, started_at, True)
        return result

    def extract_image_text(self, image_bytes: bytes, mime_type: str) -> str:
        _require_capability(self.name)

    def transcribe_audio(self, audio_bytes: bytes, mime_type: str, language: str = "en") -> str:
        _require_capability(self.name)


class HTTPGlossProvider:
    name = "provider"

    def __init__(self, api_key: str, model: str, timeout: float = 30.0, transport: httpx.BaseTransport | None = None):
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.timeout = timeout
        self.transport = transport

    def ensure_key(self) -> None:
        if not self.api_key:
            raise LLMProviderError("missing_api_key", f"The {self.name} API key is not configured.", 503)

    def request(self, url: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.post(url, headers=headers, json=body)
        except httpx.TimeoutException as error:
            raise LLMProviderError("timeout", f"The {self.name} provider timed out.", 504) from error
        except httpx.RequestError as error:
            raise LLMProviderError("provider_unavailable", f"The {self.name} provider is unavailable.", 503) from error

        if response.status_code in {401, 403}:
            raise LLMProviderError("invalid_api_key", f"The configured {self.name} API key was rejected.", 502)
        if response.status_code == 429:
            raise LLMProviderError("rate_limited", f"The {self.name} provider is rate-limiting requests.", 429)
        if response.status_code >= 500:
            raise LLMProviderError("provider_unavailable", f"The {self.name} provider is unavailable.", 503)
        if response.status_code >= 400:
            raise LLMProviderError("provider_request_failed", f"The {self.name} request was rejected.", 502)

        try:
            payload = response.json()
        except ValueError as error:
            raise LLMProviderError("malformed_response", "The translation provider returned invalid data.", 502) from error

        if not isinstance(payload, dict):
            raise LLMProviderError("malformed_response", "The translation provider returned invalid data.", 502)

        return payload

    def request_multipart(self, url: str, headers: dict[str, str], files: dict[str, tuple[str, bytes, str]], data: dict[str, str]) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport) as client:
                response = client.post(url, headers=headers, files=files, data=data)
        except httpx.TimeoutException as error:
            raise LLMProviderError("timeout", f"The {self.name} provider timed out.", 504) from error
        except httpx.RequestError as error:
            raise LLMProviderError("provider_unavailable", f"The {self.name} provider is unavailable.", 503) from error

        if response.status_code in {401, 403}:
            raise LLMProviderError("invalid_api_key", f"The configured {self.name} API key was rejected.", 502)
        if response.status_code == 429:
            raise LLMProviderError("rate_limited", f"The {self.name} provider is rate-limiting requests.", 429)
        if response.status_code >= 500:
            raise LLMProviderError("provider_unavailable", f"The {self.name} provider is unavailable.", 503)
        if response.status_code >= 400:
            raise LLMProviderError("provider_request_failed", f"The {self.name} request was rejected.", 502)

        try:
            payload = response.json()
        except ValueError as error:
            raise LLMProviderError("malformed_response", "The translation provider returned invalid data.", 502) from error

        if not isinstance(payload, dict):
            raise LLMProviderError("malformed_response", "The translation provider returned invalid data.", 502)

        return payload


class OpenAIProvider(HTTPGlossProvider):
    name = "OpenAI"

    def __init__(self, api_key: str, model: str, timeout: float = 30.0, transport: httpx.BaseTransport | None = None, transcription_model: str = "whisper-1"):
        super().__init__(api_key, model, timeout, transport)
        self.transcription_model = transcription_model.strip()

    def translate(self, text: str, available_glosses: list[str], language: str = "en") -> list[str]:
        started_at = perf_counter()
        try:
            self.ensure_key()
            body = {
                "model": self.model,
                "input": [
                    {"role": "system", "content": [{"type": "input_text", "text": build_gloss_instruction(available_glosses, language)}]},
                    {"role": "user", "content": [{"type": "input_text", "text": text}]}
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "isl_gloss_sequence",
                        "strict": True,
                        "schema": GLOSS_SCHEMA
                    }
                }
            }
            payload = self.request(
                "https://api.openai.com/v1/responses",
                {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                body
            )
            response_text = payload.get("output_text")
            if not isinstance(response_text, str):
                for item in payload.get("output", []):
                    for content in item.get("content", []):
                        if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                            response_text = content["text"]
                            break
                    if isinstance(response_text, str):
                        break
            result = parse_gloss_response(response_text)
        except LLMProviderError as error:
            _record_result(self.name, self.model, started_at, False, error=error)
            raise

        _record_result(self.name, self.model, started_at, True, payload)
        return result

    def extract_image_text(self, image_bytes: bytes, mime_type: str) -> str:
        started_at = perf_counter()
        try:
            self.ensure_key()
            image_data = base64.b64encode(image_bytes).decode("ascii")
            payload = self.request(
                "https://api.openai.com/v1/responses",
                {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                {
                    "model": self.model,
                    "input": [{"role": "user", "content": [
                        {"type": "input_text", "text": "Extract all readable text from this image. Return only the text, preserving reading order."},
                        {"type": "input_image", "image_url": f"data:{mime_type};base64,{image_data}"}
                    ]}]
                }
            )
            text = _openai_text(payload)
            if not text:
                raise LLMProviderError("empty_ocr", "The OCR provider returned no text.", 422)
        except LLMProviderError as error:
            _record_result(self.name, self.model, started_at, False, error=error)
            raise

        _record_result(self.name, self.model, started_at, True, payload)
        return text

    def transcribe_audio(self, audio_bytes: bytes, mime_type: str, language: str = "en") -> str:
        started_at = perf_counter()
        try:
            self.ensure_key()
            payload = self.request_multipart(
                "https://api.openai.com/v1/audio/transcriptions",
                {"Authorization": f"Bearer {self.api_key}"},
                {"file": ("speech.webm", audio_bytes, mime_type)},
                {"model": self.transcription_model, "language": language, "response_format": "json"}
            )
            text = payload.get("text")
            if not isinstance(text, str) or not text.strip():
                raise LLMProviderError("empty_transcript", "The speech provider returned no transcript.", 422)
        except LLMProviderError as error:
            _record_result(self.name, self.transcription_model, started_at, False, error=error)
            raise

        _record_result(self.name, self.transcription_model, started_at, True, payload)
        return text.strip()


class GeminiProvider(HTTPGlossProvider):
    name = "Gemini"

    def translate(self, text: str, available_glosses: list[str], language: str = "en") -> list[str]:
        started_at = perf_counter()
        try:
            self.ensure_key()
            body = {
                "systemInstruction": {
                    "parts": [{"text": build_gloss_instruction(available_glosses, language)}]
                },
                "contents": [{"role": "user", "parts": [{"text": text}]}],
                "generationConfig": {
                    "temperature": 0,
                    "responseMimeType": "application/json",
                    "responseSchema": GLOSS_SCHEMA
                }
            }
            payload = self.request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                {"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                body
            )
            response_text = None
            for candidate in payload.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    if isinstance(part.get("text"), str):
                        response_text = part["text"]
                        break
                if response_text:
                    break
            result = parse_gloss_response(response_text)
        except LLMProviderError as error:
            _record_result(self.name, self.model, started_at, False, error=error)
            raise

        _record_result(self.name, self.model, started_at, True, payload)
        return result

    def extract_image_text(self, image_bytes: bytes, mime_type: str) -> str:
        started_at = perf_counter()
        try:
            self.ensure_key()
            payload = self.request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                {"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                {"contents": [{"parts": [
                    {"text": "Extract all readable text from this image. Return only the text, preserving reading order."},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}}
                ]}], "generationConfig": {"temperature": 0}}
            )
            text = _gemini_text(payload)
            if not text:
                raise LLMProviderError("empty_ocr", "The OCR provider returned no text.", 422)
        except LLMProviderError as error:
            _record_result(self.name, self.model, started_at, False, error=error)
            raise

        _record_result(self.name, self.model, started_at, True, payload)
        return text

    def transcribe_audio(self, audio_bytes: bytes, mime_type: str, language: str = "en") -> str:
        started_at = perf_counter()
        try:
            self.ensure_key()
            payload = self.request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                {"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
                {"contents": [{"parts": [
                    {"text": f"Transcribe this audio exactly in {language}. Return only the spoken words."},
                    {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(audio_bytes).decode("ascii")}}
                ]}], "generationConfig": {"temperature": 0}}
            )
            text = _gemini_text(payload)
            if not text:
                raise LLMProviderError("empty_transcript", "The speech provider returned no transcript.", 422)
        except LLMProviderError as error:
            _record_result(self.name, self.model, started_at, False, error=error)
            raise

        _record_result(self.name, self.model, started_at, True, payload)
        return text


def create_provider(settings: Settings, transport: httpx.BaseTransport | None = None):
    provider = resolve_provider_name(settings)
    if provider == "manifest":
        return ManifestProvider()
    if provider == "openai":
        return OpenAIProvider(settings.openai_api_key, settings.openai_model, settings.llm_timeout_seconds, transport, settings.openai_transcription_model)
    if provider == "gemini":
        return GeminiProvider(settings.gemini_api_key, settings.gemini_model, settings.llm_timeout_seconds, transport)
    raise LLMProviderError("invalid_provider", "LLM_PROVIDER must be manifest, gemini, or openai.", 500)
