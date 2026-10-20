"""F5: flujos separados, ciclos y bandas (H3)."""

import copy

from cauce import flows
from cauce.engine import evaluate
from cauce.layout import flow_order
from conftest import load


def test_scc_encuentra_ciclos():
    comps = flows.scc(["a", "b", "c", "d"], [("a", "b"), ("b", "c"), ("c", "b"), ("c", "d")])
    assert sorted(sorted(c) for c in comps) == [["a"], ["b", "c"], ["d"]]


def test_los_retornos_no_mandan_estaciones_al_final():
    p = load("transformadores-v3.json")
    order = flow_order(p)
    assert order[0] == "recepcion" and order[-1] == "despacho"
    for a, b in (("impregnacion", "horno"), ("horno", "config"), ("config", "pruebas_int"), ("pruebas_int", "gabinete"), ("gabinete", "pruebas")):
        assert order.index(a) < order.index(b), (a, b)


def test_ciclo_sin_marcar_tampoco_va_al_final(plant):
    # pruebas -> config (5 %) cierra un ciclo en la planta v2; antes ambos iban al final.
    order = flow_order(plant)
    assert order[-1] == "despacho"
    assert order.index("config") < order.index("pruebas") < order.index("despacho")


def test_metricas_por_flujo_y_ciclos(client):
    p = load("transformadores-v3.json")
    out = client.post("/api/analyze", json={"plant": p}).json()
    cur = out["current"]
    assert set(cur["flows"]) == {"material", "personas", "vehiculos", "carga"}
    returns = [leg for leg in cur["legs"] if leg.get("is_return")]
    assert {leg["id"] for leg in returns} == {"r11", "r12", "r18"}
    assert any({"config", "pruebas_int"} <= set(c) for c in cur["cycles"])
    material = sum(leg["frac"] * leg["dist"] for leg in cur["legs"] if leg["flow"] == "material")
    assert abs(cur["piece_m"] - material) < 0.2
    for a in out["alternatives"]:
        assert set(a["flows"]) == set(cur["flows"])
    line = next(a for a in out["alternatives"] if a["id"] == "i")
    assert any("retornos (3)" in x for x in line["assumptions"])


def test_otros_flujos_no_cambian_las_metricas_del_material(plant):
    base = evaluate(plant, plant["layout"])
    p = copy.deepcopy(plant)
    p["routes"].append({"id": "p1", "from": "horno", "to": "pruebas", "frac": 1, "flow": "personas"})
    out = evaluate(p, p["layout"])
    for k in ("piece_m", "daily_m", "capacity", "lead_h"):
        assert out[k] == base[k], k
    assert out["flows"]["personas"]["piece_m"] > 0


def test_banda_nadie_camina_el_tramo_y_va_a_su_velocidad():
    p = load("transformadores-v3.json")
    out = evaluate(p, p["layout"])
    leg = next(leg for leg in out["legs"] if leg["id"] == "r10")
    assert leg["conveyor"] == "banda-1" and leg["belt_m"] == 6.7
    assert leg["meters"] < leg["trips"] * leg["dist"]  # solo carga y descarga se caminan
    load_ = out["conveyor_load"][0]
    assert load_["id"] == "banda-1" and load_["util"] < 1
    slow = copy.deepcopy(p)
    slow["conveyors"][0]["speed_mpm"] = 0.5
    assert evaluate(slow, slow["layout"])["lead_h"] > out["lead_h"]


def test_capabilities_anuncia_flows_y_conveyors(client):
    feats = client.get("/api/capabilities").json()["features"]
    assert "flows" in feats and "conveyors" in feats
