"""Pruebas transversales: el frontend actual sigue funcionando y lo nuevo es aditivo."""

import copy
import json

from conftest import FIXTURES, PRUEBAS, load

VERSION_KEYS = {"plant_version", "context_version"}


def fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def same_shape(base, got, path="analyze"):
    """Cada campo de la línea base sigue existiendo con el mismo tipo (se permiten campos nuevos)."""
    errors = []
    if isinstance(base, dict):
        if not isinstance(got, dict):
            return [f"{path}: ya no es objeto"]
        for k, v in base.items():
            if k not in got:
                errors.append(f"{path}.{k}: falta")
            else:
                errors += same_shape(v, got[k], f"{path}.{k}")
    elif isinstance(base, list):
        if not isinstance(got, list):
            return [f"{path}: ya no es lista"]
        if base and got:
            errors += same_shape(base[0], got[0], f"{path}[0]")
    elif base == "number":
        if not (isinstance(got, (int, float)) and not isinstance(got, bool)) and got is not None:
            errors.append(f"{path}: era número y ahora es {type(got).__name__}")
    elif base == "str" and not isinstance(got, str):
        errors.append(f"{path}: era texto y ahora es {type(got).__name__}")
    elif base == "bool" and not isinstance(got, bool):
        errors.append(f"{path}: era booleano y ahora es {type(got).__name__}")
    return errors


def test_frontend_actual_sigue_funcionando(client):
    base = load("baseline-transformadores.json")
    r = client.post("/api/analyze", json=fixture("frontend-analyze-v2.json"))
    assert r.status_code == 200
    assert same_shape(base["shape"]["analyze"], r.json()) == []

    rep = client.post("/api/report", json=fixture("frontend-report-v2.json"))
    assert rep.status_code == 200
    assert rep.headers["content-type"].startswith("text/plain")
    assert rep.text.strip()

    chat = client.post("/api/chat", json=fixture("frontend-chat-v2.json"))
    assert chat.status_code == 200 and chat.text.strip()


def v3_with_defaults(plant):
    """Planta con todos los campos del contrato §4, cada uno con su valor por defecto."""
    p = copy.deepcopy(plant)
    p["schema_version"] = 3
    p["conveyors"] = []
    for s in p["stations"]:
        s.update({"count": 1, "unit_w": s["w"], "unit_d": s["d"], "arrangement": "fila", "ops_per_unit": s.get("ops", 0), "t_source": "supuesto", "locked": False, "lock_reason": ""})
    for z in p["zones"]:
        z.update({"locked": z["kind"] == "bloqueado", "lock_reason": "Columna estructural" if z["kind"] == "bloqueado" else ""})
    for r in p["routes"]:
        r.update({"flow": "material", "is_return": False, "conveyor": None})
    return p


def strip(result):
    out = {k: v for k, v in result.items() if k not in VERSION_KEYS}
    return json.loads(json.dumps(out))


def test_payload_v3_no_rompe_backend(client, plant):
    a = client.post("/api/analyze", json={"plant": plant})
    b = client.post("/api/analyze", json={"plant": v3_with_defaults(plant), "context": "Texto libre", "weights": None, "campo_que_no_existe": 1})
    assert a.status_code == 200 and b.status_code == 200
    ra, rb = strip(a.json()), strip(b.json())
    assert ra["recommended"] == rb["recommended"]
    assert [x["positions"] for x in ra["alternatives"]] == [x["positions"] for x in rb["alternatives"]]
    assert [x["metrics"]["piece_m"] for x in ra["alternatives"]] == [x["metrics"]["piece_m"] for x in rb["alternatives"]]
    for k in ("piece_m", "daily_m", "capacity", "lead_h", "loading_min", "bottleneck"):
        assert ra["current"][k] == rb["current"][k], k
    assert [x["metrics"]["capacity"] for x in ra["alternatives"]] == [x["metrics"]["capacity"] for x in rb["alternatives"]]


def test_capabilities_coherente(client):
    import main

    r = client.get("/api/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == 3
    assert isinstance(body["vision"], bool)
    routes = {getattr(x, "path", None) for x in main.app.routes}
    # Cada función anunciada tiene con qué funcionar.
    needs = {
        "context_master": lambda: __import__("cauce.agents.context_pipeline"),
        "construction_jobs": lambda: __import__("cauce.master_builder"),
        "report_validation": lambda: __import__("cauce.validate"),
        "segmented_context": lambda: __import__("cauce.context"),
        "count": lambda: __import__("cauce.units"),
        "locked": lambda: __import__("cauce.units"),
        "plan_ops": lambda: "/api/plan/ops" in routes or (_ for _ in ()).throw(AssertionError("falta /api/plan/ops")),
        "weights": lambda: __import__("cauce.criteria"),
        "flows": lambda: __import__("cauce.flows"),
        "conveyors": lambda: __import__("cauce.flows"),
        "simulate": lambda: "/api/simulate" in routes or (_ for _ in ()).throw(AssertionError("falta /api/simulate")),
        "context_agents": lambda: "/api/context/organize" in routes or (_ for _ in ()).throw(AssertionError("falta /api/context/organize")),
        "context_workspace": lambda: __import__("cauce.workspace_routes"),
        "context_jobs": lambda: __import__("cauce.workspace_jobs"),
        "context_documents": lambda: __import__("cauce.workspace_documents"),
        "work_studies": lambda: __import__("cauce.workspace_deliverables"),
        "operator_import": lambda: __import__("cauce.workspace_documents"),
    }
    for f in body["features"]:
        assert f in needs, f"función desconocida en capabilities: {f}"
        needs[f]()
    assert len(set(body["features"])) == len(body["features"])


def test_health_exposes_context_provider_without_secrets(client):
    body = client.get("/api/health").json()
    assert body["context"]["provider"] == "falso"
    assert body["context"]["model"] == "falso-1"
    assert body["context"]["ready"] is True


def test_baseline_existe():
    assert (PRUEBAS / "baseline-transformadores.json").exists()



def test_analyze_no_se_bloquea_si_el_maestro_no_esta_al_dia(monkeypatch, client, plant):
    """Comprobar el plano contra el maestro es un extra: si falla, el análisis sigue y lo explica."""
    import cauce.master_builder as builder

    def stale(master, plant):
        raise ValueError("Hay datos manuales nuevos que todavía no fueron integrados al maestro.")
    monkeypatch.setattr(builder, "verify", stale)
    r = client.post("/api/analyze", json={"plant": plant, "reviewed": True, "context": {"segments": {}, "master": {"schema_version": 2}}})
    assert r.status_code == 200, r.text
    assert r.json()["construction_verification"]["status"] == "skipped"
