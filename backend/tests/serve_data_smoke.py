"""Servidor exclusivo de pruebas de navegador: IA simulada, expediente temporal.

No se usa para ejecutar la aplicación del usuario.
"""
import os
import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["CAUCE_DATA_DIR"] = tempfile.mkdtemp(prefix="cauce-data-smoke-")

import main
import uvicorn


class SmokeProvider:
    name = "prueba"
    model = "simulado"
    capabilities = {"json_schema": True, "stream": True, "vision": False, "max_context": 8192}

    async def status(self):
        return {"ready": True}

    async def json(self, system, text, schema):
        if "assignments" in schema.get("properties", {}):
            return {"entities": ["Empresa"], "assignments": [{"topic": "negocio", "instructions": "Describe el negocio con evidencia."}], "questions": []}
        if "facts" in schema.get("properties", {}):
            source = json.loads(text)["source"]["text"]
            if "La bodega mide 32 x 16 m." in source:
                rows = [
                    ("Bodega", "building", "width", 32, "m", "Ancho de 32 m", "La bodega mide 32 x 16 m.", ""),
                    ("Bodega", "building", "depth", 16, "m", "Fondo de 16 m", "La bodega mide 32 x 16 m.", ""),
                    ("Horno", "station", "count", 1, "", "1 horno", "Hay 1 horno.", ""),
                    ("Horno", "station", "width", 2, "m", "Ancho de 2 m", "Horno de 2 x 2 m.", ""),
                    ("Horno", "station", "depth", 2, "m", "Fondo de 2 m", "Horno de 2 x 2 m.", ""),
                    ("Horno", "station", "location", None, "", "Al fondo a la derecha", "El horno está al fondo a la derecha.", "fondo-derecha"),
                ]
                return {"facts": [{"topic": "maquinas", "label": field, "value": value, "excerpt": excerpt, "entity": entity, "entity_type": kind, "field": field, "target": target, "number": number, "unit": unit, "scope": "current"} for entity, kind, field, number, unit, value, excerpt, target in rows], "questions": []}
            return {"facts": [{"topic": "negocio", "label": "Descripción aportada", "value": source, "excerpt": source, "entity": "Empresa", "entity_type": "organization", "field": "description", "target": "", "number": None, "unit": "", "scope": "current"}], "questions": []}
        if "decisions" in schema.get("properties", {}):
            data = json.loads(text)
            return {"decisions": [{"id": f["id"], "topic": f["topic"], "label": f["label"], "value": f["value"], "duplicate_of": ""} for f in data["facts"]], "summary": "Descripción aportada por el usuario.", "questions": []}
        if "activities" in schema.get("properties", {}):
            return {"activities": [{"description": line, "excerpt": line, "type": "operacion", "time": None,
                "timeUnit": "min", "distance": None, "externalId": line.split(".")[0], "predecessors": []} for line in text.splitlines() if line.strip()]}
        if "items" in schema.get("properties", {}):
            topic = re.search(r"tema '([^']+)'", system).group(1)
            excerpt = text.splitlines()[0]
            return {"items": [{"label": f"Registro {topic}", "value": excerpt, "excerpt": excerpt}]}
        return {"sections": [], "questions": []}


if __name__ == "__main__":
    main.context_organizer = SmokeProvider()
    uvicorn.run(main.app, host="127.0.0.1", port=8001, log_level="warning")
