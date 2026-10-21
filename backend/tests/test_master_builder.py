import copy

import pytest

from cauce.context_master import assemble, clean_fact, entity_id
from cauce.master_builder import build, verify


def master(extra=()):
    raw = [
        {"entity": "Bodega", "entity_type": "building", "field": "width", "number": 32, "value": "Ancho de 32 m", "excerpt": "La bodega mide 32 x 16 m."},
        {"entity": "Bodega", "entity_type": "building", "field": "depth", "number": 16, "value": "Fondo de 16 m", "excerpt": "La bodega mide 32 x 16 m."},
        {"entity": "Horno", "field": "count", "number": 1, "value": "1 horno", "excerpt": "Hay 1 horno."},
        {"entity": "Horno", "field": "width", "number": 2, "value": "Ancho de 2 m", "excerpt": "Horno de 2 x 2 m."},
        {"entity": "Horno", "field": "depth", "number": 2, "value": "Fondo de 2 m", "excerpt": "Horno de 2 x 2 m."},
        {"entity": "Horno", "field": "location", "value": "Al fondo a la derecha", "target": "fondo-derecha", "excerpt": "El horno está al fondo a la derecha."},
        *extra,
    ]
    text = "\n".join(dict.fromkeys(r["excerpt"] for r in raw))
    source = {"id": "case", "text": text}
    facts = [clean_fact({"topic": "maquinas", "label": r["field"], "number": None, "target": "", "scope": "current", "unit": "m", "entity_type": "station", **r}, source) for r in raw]
    for f in facts:
        f["status"] = "confirmed"
    result = assemble(facts, [source])
    result["status"] = "accepted"
    return result


def test_build_respects_confirmed_dimensions_equipment_and_region():
    result = build(master())
    plant = result["plant"]
    assert plant["size"] == {"w": 32, "d": 16}
    assert len(plant["stations"]) == 1
    assert plant["stations"][0]["name"] == "Horno"
    x, z, _ = plant["layout"][entity_id("Horno")]
    assert x > 32 * 2 / 3 and z < 16 / 3
    assert result["verification"]["totals"]["unmet"] == 0
    assert result["verification"]["status"] == "verified"


def test_missing_building_measurement_is_not_replaced_by_an_invented_size():
    data = master()
    data["facts"] = [f for f in data["facts"] if f["field"] != "depth"]
    with pytest.raises(ValueError, match="ancho y el fondo"):
        build(data)


def test_unaccepted_and_future_facts_cannot_create_current_layout():
    data = master()
    data["status"] = "draft"
    with pytest.raises(ValueError, match="confirma"):
        build(data)
    data = master()
    for f in data["facts"]:
        if f["entity_type"] == "building":
            f["scope"] = "proposal"
    with pytest.raises(ValueError):
        build(data)


def test_image_priority_without_vision_or_human_review_cannot_claim_a_reconstruction():
    data = master()
    data["pending_visual_sources"] = True
    with pytest.raises(ValueError, match="imágenes"):
        build(data)


def test_unknown_footprints_are_explicit_assumptions_and_never_verified():
    data = master()
    data["facts"] = [f for f in data["facts"] if f["entity_type"] == "building" or f["field"] == "count"]
    result = build(data)
    assert result["verification"]["status"] == "needs_review"
    assert result["verification"]["assumptions"]


def test_verifier_detects_client_changes_against_accepted_context():
    data = master()
    result = build(data)
    result["plant"]["layout"][entity_id("Horno")] = [3, 12, 0]
    check = verify(data, result["plant"])
    assert check["totals"]["unmet"] == 1


def test_explicit_position_and_lock_are_preserved_exactly():
    data = master([
        {"entity": "Horno", "field": "x", "number": 28, "value": "x 28 m", "excerpt": "Horno en x 28 m, z 2 m."},
        {"entity": "Horno", "field": "z", "number": 2, "value": "z 2 m", "excerpt": "Horno en x 28 m, z 2 m."},
        {"entity": "Horno", "field": "locked", "value": "No se puede mover", "excerpt": "El horno no se puede mover."},
    ])
    result = build(data)
    assert result["plant"]["layout"][entity_id("Horno")] == [28, 2, 0]
    assert result["plant"]["stations"][0]["locked"]
    assert result["verification"]["status"] == "verified"


def test_return_to_stock_is_preserved_without_inventing_rework_frequency():
    extra = []
    for entity, target in [("Stock", "Horno"), ("Horno", "Stock"), ("Stock", "Configuración")]:
        extra.append({"entity": entity, "field": "flow_to", "target": target, "value": f"{entity} alimenta a {target}", "excerpt": f"{entity} alimenta a {target}."})
    result = build(master(extra))
    routes = result["plant"]["routes"]
    pairs = {(r["from"], r["to"]) for r in routes}
    assert (entity_id("Horno"), entity_id("Stock")) in pairs
    assert all(r["frac"] == 1 and r["frequency_unknown"] for r in routes)
    assert any(r["is_return"] for r in routes)


def test_story_builds_master_without_a_second_model_extraction(client, fake):
    response = client.post("/api/story", json={"text": "Texto que no sustituye el maestro", "context": {"master": master()}})
    assert response.status_code == 200, response.text
    assert response.json()["source"] == "maestro aceptado"
    assert not fake.calls


def test_analysis_requires_explicit_client_review_of_the_master_layout(client):
    data = master()
    plant = build(data)["plant"]
    assert client.post("/api/analyze", json={"plant": plant, "context": {"master": data}}).status_code == 409


def test_optimizer_requires_review_and_receives_master_plus_client_plant(client, fake):
    data = master()
    plant = build(data)["plant"]
    body = {"plant": plant, "context": {"master": data}}
    assert client.post("/api/compact", json=body).status_code == 409
    fake.data = {"orden": ["Horno"], "grupos": [], "esquina": "frente-izquierda", "razones": []}
    response = client.post("/api/compact", json={**body, "reviewed": True})
    assert response.status_code == 200, response.text
    assert any("Contexto aceptado" in call.get("prompt", "") and "Bodega de 32" in call.get("prompt", "") for call in fake.calls)
    assert response.json()["context_version"] and response.json()["plant_version"]


def test_verify_endpoint_reports_changes_without_rebuilding_the_client_plan(client):
    data = master()
    plant = build(data)["plant"]
    original = copy.deepcopy(plant)
    response = client.post("/api/master/verify", json={"plant": plant, "context": {"master": data}})
    assert response.status_code == 200 and response.json()["status"] == "verified"
    assert plant == original
