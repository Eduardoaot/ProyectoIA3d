"""F4: CRAFT, SLP y decisión multicriterio (H4, H5)."""

import pytest

from cauce import criteria
from cauce.engine import evaluate
from cauce.layout import keep_swap, search_cost, slp_blocks
from conftest import load


def analyze(client, plant, **extra):
    r = client.post("/api/analyze", json={"plant": plant, **extra})
    return r


def test_pesos_por_defecto_y_campos_nuevos(client, plant):
    out = analyze(client, plant).json()
    assert out["weights_used"] == criteria.DEFAULT_WEIGHTS
    assert {a["id"] for a in out["alternatives"]} == {"u", "i", "keep", "slp"}
    for a in out["alternatives"]:
        assert set(a["scores"]) == set(criteria.CRITERIA)
        assert a["kind"] in ("ideal", "viable")
        assert a["method"] in ("craft", "slp", "corelap", "aldep", "linea")
        assert a["assumptions"]
        assert set(a["sensitivity"].values()) <= {"misma", "cambia"}
        assert "manejo_x0.5" in a["sensitivity"] and "manejo_x2" in a["sensitivity"]
    assert out["ideal"] in {a["id"] for a in out["alternatives"]}


def test_pesos_se_normalizan_y_se_validan(client, plant):
    out = analyze(client, plant, weights={"manejo": 2, "obra": 2}).json()
    assert out["weights_used"]["manejo"] == 0.5 and out["weights_used"]["lead_time"] == 0
    assert "se normalizaron" in out["weights_note"]
    assert analyze(client, plant, weights={"distancia": 1}).status_code == 422
    assert analyze(client, plant, weights={"manejo": -1}).status_code == 422
    assert analyze(client, plant, weights={"manejo": 0}).status_code == 422


def test_los_pesos_cambian_la_recomendacion(client, plant):
    sin = {**plant, "use_assumptions": False}
    only_handling = analyze(client, sin, weights={"manejo": 1}).json()
    alts = {a["id"]: a for a in only_handling["alternatives"]}
    best = min(alts.values(), key=lambda a: a["metrics"]["piece_m"])
    assert only_handling["recommended"] == best["id"]
    # Solo obra: gana la que no mueve nada pesado (reordenar en su lugar no tiene obra).
    only_works = analyze(client, sin, weights={"obra": 1}).json()
    assert only_works["recommended"] == "keep"


def test_puntaje_de_manejo_monotono_en_la_v3(client):
    out = analyze(client, load("transformadores-v3.json")).json()
    alts = sorted(out["alternatives"], key=lambda a: a["metrics"]["daily_m"])
    for a, b in zip(alts, alts[1:]):
        assert b["scores"]["manejo"] <= a["scores"]["manejo"] + 1e-9


def test_alternativa_que_no_respeta_fijos_es_ideal_y_no_recomendada():
    plant = {"stations": [{"id": "a"}], "layout": {"a": [0, 0, 0]}}
    m = {"piece_m": 10, "avoid_hits": [], "footprint_m2": 10}
    alts = [
        {"id": "x", "metrics": {**m, "piece_m": 5}, "positions": {"a": [1, 1, 0]}, "works_cost": 1, "locked_respected": False},
        {"id": "y", "metrics": m, "positions": {"a": [0, 0, 0]}, "works_cost": 0, "locked_respected": True},
    ]
    r = criteria.rank(plant, m, alts, criteria.DEFAULT_WEIGHTS, 100)
    assert r["recommended"] == "y"
    assert r["ideal"] == "x"


def test_slp_agrupa_relaciones_a_y_e(plant):
    blocks = slp_blocks(plant)
    assert sorted(k for b in blocks for k in b) == sorted(s["id"] for s in plant["stations"])
    assert any(len(b) > 1 for b in blocks)


@pytest.mark.parametrize("name", ["transformadores.json", "transformadores-v3.json"])
def test_slp_y_reordenar_no_empeoran_a_hoy(client, name):
    p = load(name)
    out = analyze(client, p).json()
    alts = {a["id"]: a for a in out["alternatives"]}
    assert alts["keep"]["metrics"]["piece_m"] <= out["current"]["piece_m"]
    assert alts["slp"]["metrics"]["piece_m"] < out["current"]["piece_m"]
    assert alts["slp"]["locked_respected"]


def test_craft_con_trios_nunca_peor_que_solo_pares(plant):
    pairs = keep_swap(plant, plant["layout"], triples=False)
    both = keep_swap(plant, plant["layout"])
    assert search_cost(plant, both) <= search_cost(plant, pairs) + 1e-9
    assert evaluate(plant, both)["piece_m"] <= evaluate(plant, plant["layout"])["piece_m"]


def test_capabilities_anuncia_weights(client):
    assert "weights" in client.get("/api/capabilities").json()["features"]
