"""Procesos que se ramifican y lugar, tamaño y fijos dichos en la historia (branches.py, textplace.py)."""

from cauce import branches, engine
from cauce.simulate import simulate
from cauce.story import build_plant

TEXT = (
    "Fabricamos transformadores en una planta de 60x40 metros. Los nucleos llegan del almacen. "
    "Tenemos 10 bobinadoras de 2x2 contra la pared norte. Del bobinado pasan a 10 mesas de armado, donde se junta la bobina con el nucleo. "
    "Cada armado pasa a su soldadura, hay 10 soldadoras. Una banda transportadora lleva todo a inspeccion. "
    "Luego se aplica resina, se hornea y se empaca. El horno mide 6x3, esta en la esquina sureste y no se puede mover. "
    "La salida esta en la pared este y esta fija. Hacemos 20 transformadores al dia."
)
AI = {
    "negocio": "Transformadores",
    "producto": "transformadores",
    "estaciones": [
        {"nombre": "Almacén de núcleos", "tipo": "almacen"},
        {"nombre": "Bobinado", "tipo": "otro", "cantidad": 10, "minutos_por_pieza": 60},
        {"nombre": "Armado", "tipo": "ensamble", "cantidad": 10, "minutos_por_pieza": 30},
        {"nombre": "Soldadura", "tipo": "soldadura", "cantidad": 10, "minutos_por_pieza": 20},
        {"nombre": "Inspección", "tipo": "inspeccion"},
        {"nombre": "Aplicar resina", "tipo": "pintura"},
        {"nombre": "Horno", "tipo": "horno"},
        {"nombre": "Empaque", "tipo": "empaque"},
        {"nombre": "Salida", "tipo": "despacho"},
    ],
    "flujo": [
        {"de": "Almacén de núcleos", "a": "Bobinado", "porcentaje": 100},
        {"de": "Almacén de núcleos", "a": "Armado", "porcentaje": 100},
        {"de": "Bobinado", "a": "Armado", "porcentaje": 100},
        {"de": "Armado", "a": "Soldadura", "porcentaje": 100},
        {"de": "Soldadura", "a": "Inspección", "porcentaje": 100},
        {"de": "Inspección", "a": "Aplicar resina", "porcentaje": 100},
        {"de": "Aplicar resina", "a": "Horno", "porcentaje": 100},
        {"de": "Horno", "a": "Empaque", "porcentaje": 100},
        {"de": "Empaque", "a": "Salida", "porcentaje": 100},
    ],
    "supuestos": [],
}


def _plant():
    return build_plant(TEXT, AI)["plant"]


def _family(p, name):
    return [s for s in p["stations"] if (s.get("family_name") or "") == name]


def test_reparto_equilibrado():
    assert branches.pairs(3, 3) == [(0, 0), (1, 1), (2, 2)]
    # 10 → 4: cada una de las 10 va a una sola de las 4, parejo (3, 2, 3, 2).
    to = [j for _, j in branches.pairs(10, 4)]
    assert sorted(to.count(j) for j in range(4)) == [2, 2, 3, 3]
    # 2 → 6: cada una de las 6 recibe de una sola de las 2.
    assert sorted(i for i, _ in branches.pairs(2, 6)) == [0, 0, 0, 1, 1, 1]


def test_diez_ramas_uno_a_uno_y_convergen_en_inspeccion():
    p = _plant()
    bob, arm, sol = _family(p, "Bobinado"), _family(p, "Armado"), _family(p, "Soldadura")
    assert len(bob) == len(arm) == len(sol) == 10
    by = {s["id"]: s for s in p["stations"]}
    routes = [r for r in p["routes"] if not r.get("component")]
    # Bobinado i → Armado i → Soldadura i.
    for r in routes:
        a, b = by[r["from"]], by[r["to"]]
        if a.get("family_name") == "Bobinado" and b.get("family_name") == "Armado":
            assert a["lane"] == b["lane"]
        if a.get("family_name") == "Armado" and b.get("family_name") == "Soldadura":
            assert a["lane"] == b["lane"]
    insp = next(s for s in p["stations"] if s["name"] == "Inspección")
    into = [r for r in routes if r["to"] == insp["id"]]
    assert len(into) == 10 and abs(sum(r["frac"] for r in into) - 1) < 1e-6
    share = engine.shares(p)
    assert abs(share[insp["id"]] - 1) < 1e-6 and all(abs(share[s["id"]] - 0.1) < 1e-6 for s in bob + arm + sol)


def test_nucleo_entra_a_cada_armado_como_componente():
    p = _plant()
    nuc = next(s for s in p["stations"] if "cleos" in s["name"])
    comp = [r for r in p["routes"] if r["from"] == nuc["id"] and r.get("component")]
    assert len(comp) == 10 and {r["to"] for r in comp} == {s["id"] for s in _family(p, "Armado")}
    # Componente: no suma piezas al armado.
    assert all(abs(engine.shares(p)[s["id"]] - 0.1) < 1e-6 for s in _family(p, "Armado"))


def test_banda_comun_donde_convergen_las_ramas():
    p = _plant()
    belt = next(c for c in p["conveyors"] if c["merge"])
    insp = next(s for s in p["stations"] if s["name"] == "Inspección")
    assert belt["to"] == insp["id"]
    assert sum(1 for r in p["routes"] if r.get("conveyor") == belt["id"]) == 10
    # La estación «Banda» no queda como una máquina más.
    assert not any(s["kind"] == "banda" for s in p["stations"])
    m = engine.evaluate(p, p["layout"])
    legs = [leg for leg in m["legs"] if leg.get("conveyor") == belt["id"]]
    # Cada rama carga en su punto de la banda: las que están más cerca recorren menos banda.
    assert len({leg["belt_m"] for leg in legs}) > 1


def test_simulacion_no_espera_a_las_diez_ramas():
    p = _plant()
    p["use_assumptions"] = True
    out = simulate(p, p["layout"], replicas=5, seed=3)
    assert out["kpis"]["piezas_dia"]["p50"] >= 0.9 * p["params"]["demand"]


def test_lugar_tamano_y_fijos_de_la_historia():
    p = _plant()
    W, D = p["size"]["w"], p["size"]["d"]
    horno = next(s for s in p["stations"] if s["kind"] == "horno")
    x, z, _ = p["layout"][horno["id"]]
    assert (horno["w"], horno["d"]) == (6.0, 3.0)
    assert horno["locked"] and "no se puede mover" in horno["lock_reason"]
    assert x > W * 0.8 and z > D * 0.8  # esquina sureste: abajo a la derecha
    # Las bobinadoras en fila contra la pared norte (arriba), cada una de 2 × 2.
    bob = _family(p, "Bobinado")
    assert all(p["layout"][s["id"]][1] < 4 and (s["w"], s["d"]) == (2.0, 2.0) for s in bob)
    salida = next(g for g in p["gates"] if g["id"] == p["dispatch_gate"])
    assert salida["x"] == W and salida["locked"]


def test_coordenadas_y_distancia_a_la_pared():
    p = build_plant("Taller de 30x20 metros. La sierra esta en x=10, y=5. El torno esta a 2 m de la pared oeste y a 3 m de la pared sur.", None)["plant"]
    by = {s["kind"]: s for s in p["stations"]}
    assert p["layout"][by["sierra"]["id"]][:2] == [10.0, 5.0]
    tx, tz, rot = p["layout"][by["torno"]["id"]]
    w, d = (by["torno"]["w"], by["torno"]["d"]) if rot in (0, 180) else (by["torno"]["d"], by["torno"]["w"])
    assert abs((tx - w / 2) - 2) < 0.6 and abs((p["size"]["d"] - tz - d / 2) - 3) < 0.6


def test_medidas_con_palabra_completa():
    p = build_plant("Taller de 30x20 metros. Tengo una lijadora de 4x2 y un empaque de 6x3.", None)["plant"]
    by = {s["kind"]: (s["w"], s["d"]) for s in p["stations"]}
    assert by["pulido"] == (4.0, 2.0) and by["empaque"] == (6.0, 3.0)


def test_volver_a_nombrar_no_duplica():
    p = build_plant("Recibo el material, se hornea y se empaca. El horno mide 6x3.", None)["plant"]
    hornos = [s for s in p["stations"] if s["kind"] == "horno"]
    assert len(hornos) == 1 and (hornos[0]["w"], hornos[0]["d"]) == (6.0, 3.0)


def test_alternativas_respetan_lo_fijo_con_ramas(client):
    p = _plant()
    body = client.post("/api/analyze", json={"plant": p}).json()
    horno = next(s for s in p["stations"] if s["kind"] == "horno")
    for alt in body["alternatives"]:
        assert alt["locked_respected"]
        assert alt["positions"][horno["id"]][:2] == p["layout"][horno["id"]][:2]
