"""F9: visión solo con un proveedor que la tenga; si no, error claro y nada interpretado."""

import main
from conftest import FakeProvider

PNG = "data:image/png;base64,iVBORw0KGgo="


def test_sin_vision_no_finge(client):
    assert client.get("/api/capabilities").json()["vision"] is False
    r = client.post("/api/references/read", json={"image": PNG, "note": "Planta de referencia"})
    assert r.status_code == 422
    assert "no tiene visión" in r.json()["detail"]


class Seer(FakeProvider):
    capabilities = {**FakeProvider.capabilities, "vision": True}

    async def vision(self, system, prompt, images):
        self.calls.append({"images": images})
        return "Se ve una planta en U. Mide 120 m de largo."


def test_con_vision_lee_y_quita_cifras_sin_respaldo(client, monkeypatch):
    seer = Seer()
    monkeypatch.setattr(main, "seer", seer)
    assert client.get("/api/capabilities").json()["vision"] is True
    out = client.post("/api/references/read", json={"image": PNG, "note": "Referencia"}).json()
    assert out["interpreted"] is True
    assert "planta en U" in out["text"] and "120" not in out["text"]
    assert seer.calls[0]["images"] == ["iVBORw0KGgo="]


def test_llama_por_defecto_no_tiene_vision(monkeypatch):
    from cauce.providers import caps, get_provider

    for v in ("CAUCE_MODEL", "CAUCE_CHAT_MODEL", "CAUCE_VISION_MODEL"):
        monkeypatch.delenv(v, raising=False)
    assert caps(get_provider("vision"))["vision"] is False
    monkeypatch.setenv("CAUCE_VISION_MODEL", "llava:13b")
    assert caps(get_provider("vision"))["vision"] is True
