"""Pruebas sin Ollama ni dependencias adicionales para el borrador multiagente."""

import asyncio
import json
import unittest
from unittest.mock import patch

from cauce.agents.context_workspace import TOPICS, organize_context


class FakeProvider:
    def __init__(self, fail_topic=None):
        self.calls = []
        self.fail_topic = fail_topic

    async def json(self, system, prompt, schema):
        self.calls.append(system)
        if "consolidador" in system:
            proposals = json.loads(prompt)["proposals"]
            return {
                "sections": [{"topic": "operaciones", "ids": [proposals[0]["id"], "inventado"]}],
                "questions": ["¿Qué estación sigue al corte?"],
            }
        if f"'{self.fail_topic}'" in system:
            raise RuntimeError("proveedor temporalmente no disponible")
        if "'tiempos'" in system:
            return {"items": [
                {"label": "Tiempo de corte", "value": "12 min/pieza", "excerpt": "El corte tarda 12 minutos por pieza", "unit": "min/pieza", "owner": "", "source": "medido", "confidence": "alta"},
                {"label": "Tiempo inventado", "value": "3 horas", "excerpt": "frase que no existe", "unit": "h", "owner": "", "source": "", "confidence": ""},
            ]}
        return {"items": []}

    async def status(self):
        return {"ready": True}


class ContextAgentsTest(unittest.TestCase):
    def test_ten_specialists_and_one_consolidator_preserve_evidence(self):
        fake = FakeProvider()
        result = asyncio.run(organize_context("El corte tarda 12 minutos por pieza.", fake))
        self.assertEqual(len(fake.calls), len(TOPICS) + 1)
        self.assertEqual(len(result["proposals"]), 1)
        item = result["proposals"][0]
        self.assertEqual(item["excerpt"], "El corte tarda 12 minutos por pieza")
        self.assertEqual(item["confidence"], "baja")
        self.assertEqual(item["status"], "pending")
        self.assertEqual(result["master"]["sections"]["tiempos"], [item["id"]])
        self.assertEqual(result["master"]["sections"]["operaciones"], [item["id"]])
        self.assertNotIn("inventado", result["master"]["items"])

    def test_partial_failure_is_visible_without_losing_other_sections(self):
        result = asyncio.run(organize_context("El corte tarda 12 minutos por pieza.", FakeProvider("maquinas")))
        self.assertIn("maquinas", result["errors"])
        self.assertEqual(len(result["proposals"]), 1)

    def test_api_exposes_draft_and_rejects_empty_text(self):
        from fastapi.testclient import TestClient
        from main import app

        with patch("main.context_organizer", FakeProvider()):
            client = TestClient(app)
            response = client.post("/api/context/organize", json={"text": "El corte tarda 12 minutos por pieza."})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["master"]["status"], "draft")
            self.assertEqual(client.post("/api/context/organize", json={"text": " "}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
