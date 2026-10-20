"""F1: consistencia de la recomendación, validación del informe y versiones."""

import asyncio
import copy
import json

from cauce.context import current, lines
from cauce.validate import TRAILER, Claims, Validator, claims_from, split
from cauce.versions import plant_version
from test_compat import fixture

FACTS = "Hoy una pieza recorre 163.0 m dentro de la planta.\nHoy se mueven 1304.0 m de material al día.\nAlternativas: Línea recta: 232.4 m por pieza (+42.6 % frente a hoy)."


def test_cifra_inventada_se_descarta():
    v = Validator(FACTS)
    out = v.filter_text("Hoy una pieza recorre 163 m. Con el cambio se ahorran 47 m por pieza. ")
    assert "163 m" in out and "47" not in out
    assert v.result()["discarded"][0]["reason"].startswith("la cifra 47")


def test_redondeo_miles_y_porcentajes_se_aceptan():
    v = Validator(FACTS)
    text = "Se mueven 1.304 m al día. La línea sube un 43 %. Recorre 232,4 m. "
    assert v.filter_text(text) == text
    assert v.result()["discarded"] == []


def test_numeros_de_lista_no_son_cifras():
    v = Validator("")
    text = "Acciones:\n1. Marcar el piso.\n2. Medir tiempos.\n3. Revisar.\n"
    assert v.filter_text(text) == text


def test_elogio_a_alternativa_peor_se_descarta_y_la_negacion_no():
    c = Claims(names={"linea recta": "i", "reordenar en su lugar": "keep"}, worse_than_today={"i"}, recommended="keep", labels={"i": "Línea recta", "keep": "Reordenar en su lugar"})
    v = Validator(FACTS, c)
    assert not v.keep("La Línea recta es más eficiente.")
    assert v.keep("La Línea recta no es más eficiente que hoy.")
    assert v.keep("Reordenar en su lugar es la mejor opción.")
    assert v.keep("La Línea recta hace caminar más al material.")


def test_flujo_por_trozos_igual_que_texto_completo():
    text = "Hoy una pieza recorre 163 m. La Línea recta es más eficiente.\n\n1. Marcar.\n2. Medir 99 piezas.\n"
    c = Claims(names={"linea recta": "i"}, worse_than_today={"i"}, labels={"i": "Línea recta"})

    async def chunks():
        for i in range(0, len(text), 3):
            yield text[i : i + 3]

    async def run():
        v = Validator(FACTS, c)
        return "".join([s async for s in v.filter_stream(chunks())]), v.result()

    streamed, res = asyncio.run(run())
    assert streamed == Validator(FACTS, c).filter_text(text)
    assert "más eficiente" not in streamed and "99" not in streamed
    assert streamed.startswith("Hoy una pieza recorre 163 m.") and "\n\n1. Marcar." in streamed
    assert len(res["discarded"]) == 2


def test_split_conserva_todo():
    text = "Una. Dos 3.5 m.\nTres?  Cuatro"
    assert "".join(split(text)) == text


def test_claims_sin_recommended_usa_la_de_menor_recorrido():
    ctx = fixture("frontend-report-v2.json")
    c = claims_from(ctx)
    assert c.recommended == "keep"
    assert "i" in c.worse_than_today and "u" in c.worse_than_today


def test_report_con_resumen_de_validacion(client):
    body = {**fixture("frontend-report-v2.json"), "with_validation": True}
    text = client.post("/api/report", json=body).text
    shown, meta = text.split(TRAILER)
    validation = json.loads(meta)["validation"]
    assert validation["checked"] >= 3
    assert {d["text"] for d in validation["discarded"]} == {"La Línea recta es más eficiente y conviene aplicarla.", "Con ella se ahorran 47 m por pieza."}
    assert "Acciones para esta semana" in shown


def test_chat_valida_y_acepta_cifras_del_usuario(client, fake):
    fake.text = "Con 120 piezas al día la capacidad no alcanza. La Línea recta es más eficiente."
    body = {**fixture("frontend-chat-v2.json"), "messages": [{"role": "user", "content": "¿Y si hago 120 piezas al día?"}]}
    text = client.post("/api/chat", json=body).text
    assert "120 piezas" in text and "más eficiente" not in text


def test_facts_declara_la_recomendada_y_lo_que_camina_mas():
    import main

    f = main.facts(main.ContextInterface(**fixture("frontend-report-v2.json")))
    assert "«Reordenar en su lugar»" in f
    assert "«Línea recta» hace caminar más al material que hoy" in f
    assert "Rediseño elegido por el usuario: Línea recta" in f and "más que hoy" in f


def test_analyze_trae_metrica_principal_razon_y_versiones(client, plant):
    out = client.post("/api/analyze", json={"plant": plant}).json()
    assert out["main_metric"]["key"] == "lead_time"
    assert "Reordenar en su lugar" in out["recommended_reason"]
    assert isinstance(out["recommended_tradeoffs"], list)
    assert len(out["plant_version"]) == 64 and len(out["context_version"]) == 64
    sin = client.post("/api/analyze", json={"plant": {**plant, "use_assumptions": False}}).json()
    assert sin["main_metric"] == {"key": "manejo", "label": "Costo de manejo", "direction": "min", "field": "piece_m", "unit": "m por pieza"}


def test_recomendada_peor_lo_dice_en_la_razon():
    from cauce import decision

    plant = {"use_assumptions": False}
    cur = {"piece_m": 100, "avoid_hits": [{"a": 1}]}
    best = {"id": "u", "name": "Flujo en U", "works_cost": 1, "works": "Mover máquinas.", "metrics": {"piece_m": 120, "avoid_hits": []}}
    other = {"id": "keep", "name": "Reordenar", "works_cost": 0, "metrics": {"piece_m": 90, "avoid_hits": [{"a": 1}]}}
    out = decision.summary(plant, cur, [best, other], "u")
    assert "aunque empeora la métrica principal" in out["recommended_reason"]
    assert "«Reordenar»" in out["recommended_reason"]
    assert out["recommended_tradeoffs"][0]["metric"] == "manejo" and out["recommended_tradeoffs"][0]["delta_pct"] == 20.0


def test_mismo_plano_misma_version(plant):
    a = plant_version(plant)
    shuffled = json.loads(json.dumps(plant, sort_keys=True))
    b = plant_version({**shuffled, "view": {"zoom": 3}, "_sel": "horno"})
    assert a == b
    moved = copy.deepcopy(plant)
    moved["layout"]["horno"][0] += 1
    assert plant_version(moved) != a


def test_contexto_segmentado_usa_solo_vigentes():
    ctx = {"segments": {"tiempos": [
        {"id": "tiempos-0004", "segment": "tiempos", "version": 1, "key": "pulido.t_ciclo", "value": [5, 6], "unit": "min/pieza", "source": "estimado", "confidence": "baja"},
        {"id": "tiempos-0007", "segment": "tiempos", "version": 3, "key": "pulido.t_ciclo", "value": [3.5, 4.5], "unit": "min/pieza", "source": "medido", "confidence": "alta", "supersedes": "tiempos-0004"},
    ], "inventado": [{"id": "x"}]}}
    live = current(ctx)
    assert [e["id"] for e in live] == ["tiempos-0007"]
    assert lines(ctx) == ["Dato (tiempos, medido, confianza alta): pulido.t_ciclo = 3.5 a 4.5 min/pieza."]
    assert lines("  Turno de 8 h ") == ["Contexto del usuario: Turno de 8 h"]


def test_analyze_acepta_contexto_texto_u_objeto(client, plant):
    a = client.post("/api/analyze", json={"plant": plant, "context": "texto"}).json()
    b = client.post("/api/analyze", json={"plant": plant, "context": {"segments": {}}}).json()
    assert a["context_version"] != b["context_version"]
    assert a["plant_version"] == b["plant_version"]
