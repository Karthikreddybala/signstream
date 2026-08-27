from fastapi.testclient import TestClient

from app.main import app
from app.services import match_glosses, resolve_gloss_sequence


def test_health() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_api_status_reports_motion_library() -> None:
    response = TestClient(app).get("/api/status")
    payload = response.json()
    assert response.status_code == 200
    assert payload["status"] == "ok"
    assert payload["motion_library"]["clips"] >= payload["motion_library"]["ready"]
    assert payload["llm"]["provider"]
    assert "tokens" in payload["llm"]


def test_llm_check_returns_safe_runtime_status() -> None:
    response = TestClient(app).post("/api/status/llm-check")
    assert response.status_code == 200
    assert response.json()["llm"]["responding"] == "yes"


def test_match_glosses_preserves_sentence_order_and_repeats() -> None:
    manifest = {
        "clips": [
            {"gloss": "drink", "motionPath": "/motion/drink.json"},
            {"gloss": "book", "motionPath": "/motion/book.json"},
        ]
    }

    matches = match_glosses("book drink book", manifest)

    assert [match["gloss"] for match in matches] == ["book", "drink", "book"]


def test_match_glosses_resolves_common_inflections() -> None:
    manifest = {
        "clips": [
            {"gloss": "rain", "motionPath": "/motion/rain.json"},
            {"gloss": "cry", "motionPath": "/motion/cry.json"},
            {"gloss": "eat", "motionPath": "/motion/eat.json"},
        ]
    }

    matches = match_glosses("raining crying eating", manifest)

    assert [match["gloss"] for match in matches] == ["rain", "cry", "eat"]


def test_resolve_gloss_sequence_canonicalizes_inflected_llm_output() -> None:
    resolved, unknown = resolve_gloss_sequence(
        ["raining", "crying", "eating"],
        {"clips": [{"gloss": "rain"}, {"gloss": "cry"}, {"gloss": "eat"}]},
    )

    assert [item["gloss"] for item in resolved] == ["rain", "cry", "eat"]
    assert unknown == []
