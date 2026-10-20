"""Servidor exclusivo de pruebas de navegador: IA simulada, expediente temporal.

No se usa para ejecutar la aplicación del usuario.
"""
import os
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
