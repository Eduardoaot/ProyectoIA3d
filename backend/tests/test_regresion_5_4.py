"""Pruebas mínimas de regresión de los criterios §5.4.

Las que hoy fallan llevan xfail(strict=True) con el motivo y la fase que las resuelve:
en cuanto empiecen a pasar, pytest avisa para quitar la marca.
"""

import copy

import pytest

from conftest import load


def analyze(client, plant, **extra):
    r = client.post("/api/analyze", json={"plant": plant, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def main_value(m, use_assumptions):
    return m["daily_m"] if use_assumptions else m["piece_m"]


# 1. Una alternativa que aumenta la distancia no puede ganar por distancia.
@pytest.mark.xfail(strict=True, reason="F4: aún no hay puntaje por criterio (scores)")
def test_mas_distancia_no_gana_por_distancia(client, plant):
    out = analyze(client, plant)
    alts = sorted(out["alternatives"], key=lambda a: a["metrics"]["daily_m"])
    for a, b in zip(alts, alts[1:]):
        # Más metros nunca da mejor puntaje de manejo.
        assert b["scores"]["manejo"] <= a["scores"]["manejo"] + 1e-9


def test_recomendada_que_empeora_lo_declara(client, plant):
    out = analyze(client, plant)
    rec = next(a for a in out["alternatives"] if a["id"] == out["recommended"])
    cur = out["current"]
    worse = rec["metrics"]["daily_m"] > cur["daily_m"]
    declared = any(t["metric"] == "manejo" for t in out.get("recommended_tradeoffs", []))
    assert worse == declared
    assert out["recommended_reason"]


# 2. Ningún elemento locked cambia de posición en ninguna alternativa.
@pytest.mark.xfail(strict=True, reason="F2: las alternativas aún no respetan locked")
def test_locked_no_se_mueve(client, plant):
    p = copy.deepcopy(plant)
    fixed = {"horno", "pruebas"}
    for s in p["stations"]:
        if s["id"] in fixed:
            s["locked"] = True
            s["lock_reason"] = "Instalación eléctrica"
    out = analyze(client, p)
    for a in out["alternatives"]:
        for sid in fixed:
            assert a["positions"][sid][:2] == p["layout"][sid][:2], f"{a['id']} movió {sid}"
        assert a["locked_respected"] is True


# 3. "Reordenar en su lugar" nunca es peor que "Hoy".
@pytest.mark.parametrize("use_assumptions", [False, True])
def test_reordenar_nunca_peor_que_hoy(client, plant, use_assumptions):
    p = {**plant, "use_assumptions": use_assumptions}
    out = analyze(client, p)
    keep = next(a for a in out["alternatives"] if a["id"] == "keep")
    assert keep["metrics"]["piece_m"] <= out["current"]["piece_m"] + 1e-6


# 4. Una estación con count: N produce N servidores en el cálculo de capacidad.
@pytest.mark.xfail(strict=True, reason="F2: el motor aún no lee count")
def test_count_n_servidores(client, plant):
    p = copy.deepcopy(plant)
    emb = next(s for s in p["stations"] if s["id"] == "embobinado")
    emb.update({"count": 10, "ops_per_unit": 1, "ops": 10})
    out = analyze(client, p)
    row = next(x for x in out["current"]["stations"] if x["id"] == "embobinado")
    assert row["servers"] == 10
    one = copy.deepcopy(p)
    next(s for s in one["stations"] if s["id"] == "embobinado").update({"count": 1, "ops_per_unit": 1, "ops": 1})
    row1 = next(x for x in analyze(client, one)["current"]["stations"] if x["id"] == "embobinado")
    assert row["capacity"] == pytest.approx(row1["capacity"] * 10, rel=0.02)


# 5. Una planta con retornos se resuelve sin error y muestra los ciclos.
@pytest.mark.xfail(strict=True, reason="F5: aún no hay retornos (is_return) ni flujos")
def test_planta_con_retornos(client):
    p = load("transformadores-v3.json")
    out = analyze(client, p)
    legs = out["current"]["legs"]
    assert any(leg.get("is_return") for leg in legs)
    assert out["current"].get("cycles")
    for a in out["alternatives"]:
        assert a["metrics"]["blocked_legs"] == 0 or a["metrics"]["piece_m"] > 0


# 6. El informe del caso de transformadores no contradice a facts().
def test_informe_no_contradice_facts(client):
    from test_compat import fixture

    text = client.post("/api/report", json=fixture("frontend-report-v2.json")).text
    assert "más eficiente" not in text  # la línea recta camina 69 m más que hoy
    assert "47 m" not in text  # cifra que no está en los hechos
    assert "163 m" in text  # lo respaldado se conserva
