import copy
import asyncio

import pytest

from cauce import workspace as service, workspace_store as store
from cauce import workspace_jobs as jobs


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv("CAUCE_DATA_DIR", str(tmp_path))


def proposal(id="one", value=12):
    return {"id": id, "topic": "tiempos", "label": "Corte", "value": value, "excerpt": "Corte 12 minutos", "unit": "min", "status": "pending"}


def test_atomic_revision_and_roundtrip(client):
    project = {"text": "Texto original", "contextWorkspace": {"activities": [{"id": "a", "time": "", "distance": ""}]}}
    first = client.put("/api/workspaces/demo", json={"project": project, "expected_revision": 0})
    assert first.status_code == 200
    saved = first.json()
    assert saved["revision"] == 1
    assert saved["project"]["contextWorkspace"]["activities"][0]["time"] == ""
    assert client.put("/api/workspaces/demo", json={"project": project, "expected_revision": 0}).status_code == 409
    assert client.get("/api/workspaces/demo").json() == saved
    assert client.put("/api/workspaces/demo", json={"project": project, "expected_revision": 1}).json()["revision"] == 1


def test_batch_confirm_idempotent_and_history(client):
    project = {"contextWorkspace": {"proposals": [proposal()]}}
    saved = client.put("/api/workspaces/demo", json={"project": project, "expected_revision": 0}).json()
    route = "/api/workspaces/demo/confirm"
    confirmed = client.post(route, json={"expected_revision": saved["revision"], "ids": ["one"]}).json()
    assert confirmed["result"]["accepted"] == ["one"]
    assert len(confirmed["project"]["context"]["segments"]["tiempos"]) == 1
    repeated = client.post(route, json={"expected_revision": confirmed["revision"], "ids": ["one"]}).json()
    assert repeated["revision"] == confirmed["revision"]
    assert client.post(route, json={"expected_revision": 1, "ids": ["one"]}).status_code == 409
    updated = copy.deepcopy(repeated["project"])
    updated["contextWorkspace"]["proposals"].append(proposal("two", 14))
    saved = store.write("demo", updated, repeated["revision"])
    result = client.post(route, json={"expected_revision": saved["revision"], "ids": ["two"]}).json()
    entries = result["project"]["context"]["segments"]["tiempos"]
    assert len(entries) == 2 and entries[1]["supersedes"] == entries[0]["id"]


def test_conflicts_not_silently_confirmed():
    project = service.prepare({"contextWorkspace": {"proposals": [proposal(), proposal("other", 18)]}})
    service.detect_conflicts(project)
    result = service.confirm(project, ["one", "other"])
    assert len(result["blocked"]) == 2 and result["accepted"] == []


def test_consolidation_preserves_discard_and_unknowns():
    p = service.prepare({"contextWorkspace": {"proposals": [{**proposal(), "status": "discarded"}]}})
    service.merge_result(p, {"proposals": [{**proposal("new"), "status": "pending"}]})
    assert len(p["contextWorkspace"]["proposals"]) == 1
    assert service.accepted_context(p)["activities"] == []
    with pytest.raises(ValueError):
        service.confirm(p, ["unknown"])


def test_blocking_preserves_every_character():
    text = "\n".join(f"{i}. Operación {i}: texto de la observación" for i in range(1, 121))
    pieces = jobs.blocks(text)
    assert len(pieces) > 1
    assert "".join(b["text"] for b in pieces) == text
    for block in pieces:
        assert text[block["offset"]:block["offset"] + len(block["text"])] == block["text"]


def test_study_reader_rejects_unsupported_number():
    class Provider:
        async def json(self, system, text, schema):
            return {"activities": [{"description": "Cortar", "excerpt": "Cortar la pieza", "type": "operacion", "time": 12, "timeUnit": "min", "distance": None}]}
    with pytest.raises(ValueError, match="evidencia válida"):
        asyncio.run(jobs.interpret_block("studies", {"text": "Cortar la pieza", "offset": 0}, Provider()))


def test_120_activities_unknowns_and_no_overwrite():
    class Provider:
        async def json(self, system, text, schema):
            return {"activities": [{"description": line, "excerpt": line, "type": "operacion", "time": None,
                "timeUnit": "min", "distance": None, "externalId": line.split(".")[0], "predecessors": []} for line in text.splitlines() if line]}
    text = "\n".join(f"{i}. Actividad de fabricación {i}" for i in range(1, 121))
    store.write("demo", service.prepare({}), 0)
    value = {"id": "job", "kind": "studies", "text": text, "base_revision": 1, "status": "queued", "result": {"proposals": [], "activities": []}, "completed_blocks": [], "errors": []}
    store.save_job("demo", value)
    asyncio.run(jobs.run("demo", "job", Provider()))
    result = store.job("demo", "job")
    assert result["status"] == "done"
    activities = store.read("demo")["project"]["contextWorkspace"]["activities"]
    assert len(activities) == 120 and len({a["id"] for a in activities}) == 120
    assert all(a["time"] is None and a["distance"] is None for a in activities)
    assert all(a["status"] == "pending" for a in activities)
    store.save_job("demo", {**value, "id": "conflict"})
    asyncio.run(jobs.run("demo", "conflict", Provider()))
    assert store.job("demo", "conflict")["status"] == "conflict"
    assert len(store.read("demo")["project"]["contextWorkspace"]["activities"]) == 120


def test_repeated_activity_descriptions_keep_distinct_source_positions():
    class Provider:
        async def json(self, system, text, schema):
            if "types" in schema.get("properties", {}):
                return {"types": ["cursograma_analitico"], "reason": "Actividades"}
            return {"activities": [{"description": "Revisar pieza", "excerpt": "Revisar pieza", "type": "inspeccion", "time": None, "distance": None, "timeUnit": "min"} for _ in range(3)]}
    result = asyncio.run(jobs.interpret_block("studies", {"text": "Revisar pieza\nRevisar pieza\nRevisar pieza", "offset": 0}, Provider()))
    assert len(result["activities"]) == 3
    assert len({a["id"] for a in result["activities"]}) == 3
