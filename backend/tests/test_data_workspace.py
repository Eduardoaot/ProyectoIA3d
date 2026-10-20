import copy

import pytest

from cauce import workspace as service, workspace_store as store


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
