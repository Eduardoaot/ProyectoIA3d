"""Registra el comportamiento del motor para pruebas/transformadores.json.

Escribe:
- pruebas/baseline-transformadores.json: alternativas, métricas, recomendada, rutas,
  texto del informe con el proveedor falso y la forma (campos y tipos) de cada respuesta.
- backend/tests/fixtures/frontend-*-v2.json: las peticiones tal como las arma hoy el
  frontend (App.jsx: `api.analyze(draft)` y `slim()` para el informe).

Se corrió una vez antes de cambiar el motor (fase F0). Volver a correrlo cambia la línea base.
Uso: backend/.venv/Scripts/python pruebas/generar_baseline.py
"""

import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "backend"))
sys.path.insert(0, str(ROOT.parent / "backend" / "tests"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from conftest import FakeProvider  # noqa: E402

fake = FakeProvider()
main.engineer = main.extractor = main.spatial = fake
client = TestClient(main.app)


def shape(v):
    """Campos y tipos de una respuesta (lo que el frontend actual lee)."""
    if isinstance(v, dict):
        return {k: shape(x) for k, x in v.items()}
    if isinstance(v, list):
        return [shape(v[0])] if v else []
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if v is None:
        return "null"
    return type(v).__name__


def pick(m):
    """Igual que pick() en frontend/src/App.jsx."""
    keys = ("piece_m", "daily_m", "capacity", "lead_h", "loading_min", "bottleneck", "bottleneck_util", "avoid_hits", "lead_parts")
    out = {k: m.get(k) for k in keys if m.get(k) is not None}
    out["avoid_hits"] = m.get("avoid_hits") or []
    return out


plant = json.loads((ROOT / "transformadores.json").read_text(encoding="utf-8"))
analyze_req = {"plant": plant}
a = client.post("/api/analyze", json=analyze_req).json()

best = next(x for x in a["alternatives"] if x["id"] == a["recommended"])
line = next(x for x in a["alternatives"] if x["id"] == "i")
slim_plant = {k: v for k, v in plant.items() if k != "layout"}
report_req = {
    "plant": slim_plant,
    "analysis": {"current": pick(a["current"]), "alternatives": [{"id": x["id"], "name": x["name"], "metrics": {"piece_m": x["metrics"]["piece_m"]}} for x in a["alternatives"]]},
    # El 14 de octubre el usuario eligió la línea recta.
    "redesign": {"name": line["name"], "metrics": pick(line["metrics"])},
}
report = client.post("/api/report", json=report_req).text
chat_req = {"messages": [{"role": "user", "content": "¿Qué alternativa conviene?"}], "context": report_req}

baseline = {
    "recommended": a["recommended"],
    "current": {k: a["current"].get(k) for k in ("piece_m", "daily_m", "capacity", "lead_h", "loading_min", "bottleneck", "bottleneck_util", "blocked_legs")},
    "current_legs": [{"id": x["id"], "from": x["from"], "to": x["to"], "dist": x["dist"]} for x in a["current"]["legs"]],
    "alternatives": [
        {
            "id": x["id"],
            "name": x["name"],
            "score": x["score"],
            "works_cost": x["works_cost"],
            "metrics": {k: x["metrics"].get(k) for k in ("piece_m", "daily_m", "capacity", "lead_h", "loading_min", "bottleneck")},
            "positions": x["positions"],
        }
        for x in a["alternatives"]
    ],
    "report_text_fake_provider": report,
    "shape": {"analyze": shape(a)},
}

(ROOT / "baseline-transformadores.json").write_text(json.dumps(baseline, ensure_ascii=False, indent=1), encoding="utf-8")
fx = ROOT.parent / "backend" / "tests" / "fixtures"
fx.mkdir(parents=True, exist_ok=True)
for name, body in (("frontend-analyze-v2.json", analyze_req), ("frontend-report-v2.json", report_req), ("frontend-chat-v2.json", chat_req)):
    (fx / name).write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"recomendada: {a['recommended']}; hoy {a['current']['piece_m']} m; " + ", ".join(f"{x['id']} {x['metrics']['piece_m']} m (puntaje {x['score']})" for x in a["alternatives"]))
