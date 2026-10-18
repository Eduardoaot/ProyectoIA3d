"""Base común de las pruebas: la planta de transformadores y un proveedor de IA falso.

Ninguna prueba llama a Ollama: el proveedor falso devuelve siempre el mismo texto
o el mismo JSON, así el resultado es repetible y se puede comparar.
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
PRUEBAS = ROOT / "pruebas"
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(BACKEND))

# Texto fijo del "informe": reproduce el error del 14 de octubre (H1) y trae una cifra inventada (H10).
FAKE_REPORT = (
    "Hoy una pieza recorre 163 m dentro de la planta. "
    "La Línea recta es más eficiente y conviene aplicarla. "
    "Con ella se ahorran 47 m por pieza.\n\n"
    "Acciones para esta semana:\n"
    "1. Marcar en el piso los nuevos lugares antes de mover nada.\n"
    "2. Mover primero las estaciones que más recorrido ahorran.\n"
)


class FakeProvider:
    """Cumple la interfaz de providers/base.py sin red."""

    name = "falso"
    model = "falso-1"
    capabilities = {"json_schema": True, "stream": True, "vision": False, "max_context": 8192}

    def __init__(self, text: str = FAKE_REPORT, data: dict | list | None = None):
        self.text = text
        self.data = data if data is not None else {}
        self.calls: list[dict] = []

    async def status(self) -> dict:
        return {"online": True, "models": [self.model], "ready": True}

    async def json(self, system: str, prompt: str, schema: dict | None = None):
        self.calls.append({"system": system, "prompt": prompt, "schema": schema})
        data = self.data.pop(0) if isinstance(self.data, list) else self.data
        if isinstance(data, Exception):
            raise data
        return copy.deepcopy(data)

    async def stream(self, messages: list[dict]):
        self.calls.append({"messages": messages})
        # Trozos irregulares, como los manda un modelo real.
        for i in range(0, len(self.text), 7):
            yield self.text[i : i + 7]


def load(name: str):
    return json.loads((PRUEBAS / name).read_text(encoding="utf-8"))


@pytest.fixture
def plant():
    return load("transformadores.json")


@pytest.fixture
def fake(monkeypatch):
    import main

    f = FakeProvider()
    for role in ("extractor", "engineer", "spatial", "editor", "reporter", "missioner", "seer"):
        if hasattr(main, role):
            monkeypatch.setattr(main, role, f)
    if hasattr(main, "providers_by_role"):
        monkeypatch.setattr(main, "providers_by_role", lambda: {k: f for k in main.ROLES})
    return f


@pytest.fixture
def client(fake):
    from fastapi.testclient import TestClient

    import main

    return TestClient(main.app)
