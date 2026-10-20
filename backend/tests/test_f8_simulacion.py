"""F8: simulación con SimPy (criterios §6, contrato §6.5)."""

from conftest import load


def sim(client, plant, **extra):
    r = client.post("/api/simulate", json={"plant": plant, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_misma_semilla_mismo_resultado(client, plant):
    a = sim(client, plant, replicas=10, seed=7)
    b = sim(client, plant, replicas=10, seed=7)
    assert a == b
    assert a["seed"] == 7 and a["replicas"] == 10


def test_horno_cuello_de_botella_por_tiempo(client):
    out = sim(client, load("transformadores-v3.json"), replicas=10)
    assert out["bottleneck"] == "horno"
    k = out["kpis"]
    assert k["tiempo_muerto"]["lote"]["p50"] > 0  # espera de lote, aparte
    assert k["piezas_dia"]["p10"] <= k["piezas_dia"]["p50"] <= k["piezas_dia"]["p90"]
    # Con un rango de ciclo en embobinado y configuración, el tiempo varía entre réplicas.
    assert k["lead_time_min"]["p10"] < k["lead_time_min"]["p90"]


def test_kpis_sin_datos_son_null(client, plant):
    k = sim(client, plant, replicas=5)["kpis"]
    assert k["oee"] is None
    assert k["tiempo_muerto"]["falla"] is None and k["tiempo_muerto"]["cambio"] is None and k["tiempo_muerto"]["personal"] is None
    out = sim(client, {**plant, "use_assumptions": False})
    assert out["kpis"]["piezas_dia"] is None and out["notes"]


def test_oee_solo_con_disponibilidad_y_calidad(client, plant):
    p = {**plant, "params": {**plant["params"], "availability": 0.9, "quality": 0.98}}
    oee = sim(client, p, replicas=5)["kpis"]["oee"]
    assert 0 < oee["p50"] <= 0.9 * 0.98


def test_coherente_con_las_formulas(client, plant):
    # transformadores.json: capacidad 9,3 por fórmula frente a demanda de 8 -> se sostiene la demanda.
    k = sim(client, plant, replicas=10)["kpis"]
    assert k["piezas_dia"]["p50"] >= 7.5
    assert k["takt_min"] == round(480 * 0.8 / 8, 2)


def test_simular_una_alternativa(client, plant):
    out = sim(client, plant, alternative="keep", replicas=5)
    assert out["alternative"] == "keep" and out["kpis"]["piezas_dia"]
    assert client.post("/api/simulate", json={"plant": plant, "alternative": "nada"}).status_code == 404


def test_capabilities_anuncia_simulate(client):
    assert "simulate" in client.get("/api/capabilities").json()["features"]
