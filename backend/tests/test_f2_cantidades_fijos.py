"""F2: cantidades por estación (H2), elementos fijos (H6) y lotes (criterios §3.4)."""

import copy

from cauce import units
from conftest import load


def analyze(client, plant):
    r = client.post("/api/analyze", json={"plant": plant})
    assert r.status_code == 200, r.text
    return r.json()


def test_v2_da_lo_mismo_que_la_linea_base(client, plant):
    base = load("baseline-transformadores.json")
    out = analyze(client, plant)
    assert out["recommended"] == base["recommended"]
    for k, v in base["current"].items():
        assert out["current"].get(k) == v, k
    for a, b in zip(out["alternatives"], base["alternatives"]):
        assert a["positions"] == b["positions"]
        assert {k: a["metrics"].get(k) for k in b["metrics"]} == b["metrics"]


def test_v3_cuenta_las_maquinas_en_paralelo(client):
    p = load("transformadores-v3.json")
    out = analyze(client, p)
    rows = {x["id"]: x for x in out["current"]["stations"]}
    assert rows["embobinado"]["servers"] == 10 and rows["embobinado"]["count"] == 10
    assert rows["config"]["servers"] == 6
    assert rows["gabinete"]["servers"] == 4
    # Más de 30 máquinas o áreas en 14 estaciones, como el caso del 14 de octubre (~33).
    assert sum(units.count(s) for s in p["stations"]) == 36


def test_menos_operarios_que_maquinas_limita_los_servidores():
    s = {"count": 10, "ops": 6, "t": 90}
    assert units.ops_per_unit(s) == 0.6 and units.servers(s) == 6
    assert units.servers({"count": 4, "ops_per_unit": 0, "t": 5}) == 4  # automáticas
    assert units.servers({"ops": 0, "t": 5}) == 1  # v2: automática
    assert units.servers({"ops": 3, "t": 5}) == 3  # v2: los operarios


def test_lote_separa_espera_de_llenado_del_tiempo_de_maquina(client):
    p = load("transformadores-v3.json")
    out = analyze(client, p)
    parts = out["current"]["lead_parts"]
    assert parts["espera_lote"] > 0
    horno = next(s for s in p["stations"] if s["id"] == "horno")
    assert units.machine_time(horno) == 60  # 360 min por lote de 6
    assert units.stay_time(horno) == 360
    # Con el lote de 6 h el horno es el cuello de botella por tiempo, aunque su recorrido sea corto.
    assert out["current"]["bottleneck"] == "horno"


def test_rango_de_ciclo_usa_el_promedio():
    assert units.cycle({"t": 3, "t_cycle_min": [60, 120]}) == 90
    assert units.cycle({"t": 3, "t_cycle_min": 7}) == 7
    assert units.cycle({"t": 3}) == 3


def test_tamano_del_bloque_segun_acomodo():
    assert units.block_size(10, 2, 1.5, "fila") == (25.4, 1.5)
    assert units.block_size(10, 2, 1.5, "columna") == (2, 20.4)
    assert units.block_size(10, 2, 1.5, "bloque") == (9.8, 5.7)


def test_fijos_en_todas_las_alternativas_v3(client):
    p = load("transformadores-v3.json")
    out = analyze(client, p)
    for a in out["alternatives"]:
        assert a["locked_respected"] is True
        assert a["positions"]["horno"] == p["layout"]["horno"]


def test_si_no_cabe_dice_que_fijo_lo_impide(client):
    # Bodega angosta: tres máquinas de 4 x 4 caben en fila, pero con el torno fijo cerca de
    # un extremo solo queda lugar para una de las otras dos.
    sq = {"w": 4, "d": 4, "t": 1, "ops": 1}
    p = {
        "name": "Angosta", "size": {"w": 16, "d": 5},
        "gates": [{"id": "A", "x": 2}], "receive_gate": "A", "dispatch_gate": "A",
        "stations": [
            {"id": "a", "name": "Prensa", "kind": "prensa", **sq},
            {"id": "b", "name": "Torno", "kind": "torno", **sq, "locked": True, "lock_reason": "Anclado al piso"},
            {"id": "c", "name": "Mesa", "kind": "mesa", **sq},
        ],
        "zones": [], "walls": [],
        "routes": [{"id": "r1", "from": "a", "to": "b"}, {"id": "r2", "from": "b", "to": "c"}],
        "use_assumptions": False, "params": {},
        "layout": {"a": [11, 2.5, 0], "b": [6, 2.5, 0], "c": [14, 2.5, 0]},
    }
    out = analyze(client, p)
    for a in out["alternatives"]:
        assert a["positions"]["b"] == [6, 2.5, 0]
    alts = {a["id"]: a for a in out["alternatives"]}
    # En línea cabrían las tres si el torno se moviera: el fijo lo impide.
    assert alts["i"]["infeasible"]["blocked_by"] == ["Torno"]
    assert alts["i"]["infeasible"]["text"] == "No hay lugar para Mesa sin mover lo fijo: Torno."
    # En U no caben ni moviendo el torno: se avisa sin culpar al fijo.
    assert alts["u"]["infeasible"]["blocked_by"] == []


def test_compacta_respeta_fijos(client, fake):
    p = copy.deepcopy(load("transformadores.json"))
    next(s for s in p["stations"] if s["id"] == "horno")["locked"] = True
    alt = client.post("/api/compact", json={"plant": p}).json()
    assert alt["locked_respected"] is True
    assert alt["positions"]["horno"] == p["layout"]["horno"]


def test_obstaculo_no_entra_en_relaciones(client, plant):
    p = copy.deepcopy(plant)
    p["zones"].append({"id": "col-2", "name": "Columna 2", "kind": "obstaculo", "x": 30, "z": 12, "w": 1, "d": 1, "locked": True})
    rel = analyze(client, p)["relations"]
    assert "col-2" not in rel["ids"]
