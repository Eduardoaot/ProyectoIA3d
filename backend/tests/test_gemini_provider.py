import pytest

from cauce.providers import get_provider
from cauce.providers.gemini import GeminiProvider


def test_gemini_requires_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("CAUCE_VISION_PROVIDER", "gemini")
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        get_provider("vision")


def test_gemini_is_configurable_for_vision(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-real-key")
    monkeypatch.setenv("CAUCE_VISION_PROVIDER", "gemini")
    monkeypatch.setenv("CAUCE_VISION_MODEL", "gemini-2.5-flash")
    provider = get_provider("vision")
    assert isinstance(provider, GeminiProvider)
    assert provider.capabilities["vision"] is True
    assert provider.model == "gemini-2.5-flash"


def test_gemini_request_keeps_text_and_image_separate():
    provider = GeminiProvider("gemini-2.5-flash", "not-a-real-key")
    parts = provider._body("Sistema", "Describe", ["data:image/jpeg;base64,AA=="])["contents"][0]["parts"]
    assert parts[0] == {"text": "Describe"}
    assert parts[1]["inline_data"] == {"mime_type": "image/jpeg", "data": "AA=="}


def test_reference_route_preserves_mime_for_gemini(client, monkeypatch):
    import main

    provider = GeminiProvider("gemini-2.5-flash", "not-a-real-key")

    async def vision(system, prompt, images):
        assert images == ["data:image/webp;base64,AA=="]
        return "Se ve un área de empaque."

    provider.vision = vision
    monkeypatch.setattr(main, "seer", provider)
    response = client.post("/api/references/read", json={"image": "data:image/webp;base64,AA=="})
    assert response.status_code == 200
