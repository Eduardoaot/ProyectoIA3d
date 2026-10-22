"""Lo que un modelo pequeño cambia al citar no debe tirar datos válidos, ni inventar los que faltan."""
import asyncio

from cauce.agents.context_pipeline import organize, topic_hits
from cauce.context_master import clean_fact, locate

SOURCE = {"id": "relato:1", "text": "### 04. Máquinas\n* **Embobinadoras:** Contamos con 10 máquinas embobinadoras en la nave.", "offset": 0}
BASE = {"topic": "maquinas", "label": "Embobinadoras", "entity": "Embobinadoras", "entity_type": "station", "target": "", "unit": "", "scope": "current"}


def test_evidencia_sin_markdown_ni_acentos_se_encuentra_y_queda_literal():
    offset, literal = locate("Embobinadoras: contamos con 10 maquinas embobinadoras", SOURCE["text"])
    assert offset >= 0 and literal.startswith("Embobinadoras:**") and "máquinas" in literal
    fact = clean_fact({**BASE, "field": "count", "number": 10, "value": "10 unidades", "excerpt": "Embobinadoras: contamos con 10 maquinas embobinadoras"}, SOURCE)
    assert fact["excerpt"] in SOURCE["text"]


def test_evidencia_inventada_se_rechaza():
    assert locate("Contamos con 12 hornos de curado", SOURCE["text"]) == (-1, "")


def test_cantidad_sin_number_toma_la_unica_cifra_compartida():
    fact = clean_fact({**BASE, "field": "count", "number": None, "value": "10 unidades", "excerpt": "Contamos con 10 máquinas embobinadoras"}, SOURCE)
    assert fact["number"] == 10 and fact["field"] == "count"


def test_cantidad_sin_cifra_se_conserva_como_descripcion():
    fact = clean_fact({**BASE, "field": "count", "number": None, "value": "varias embobinadoras", "excerpt": "Contamos con 10 máquinas embobinadoras"}, SOURCE)
    assert fact["field"] == "description" and fact["number"] is None


def test_temas_que_el_interprete_no_delega_se_encargan_igual():
    text = "### 01. Negocio\nVendemos a clientes industriales por pedido.\n\n### 03. Tiempos\nEl ciclo tarda 12 minutos por pieza en cada turno."
    assert topic_hits("negocio", text) > 0 and topic_hits("tiempos", text) > 0
    asked = []

    class Provider:
        model = "prueba"
        capabilities = {"max_context": 8192}

        async def json(self, system, prompt, schema):
            props = schema.get("properties", {})
            if "assignments" in props:  # el intérprete no delega nada útil
                return {"entities": [], "assignments": [], "questions": []}
            if "facts" in props:
                import json as j
                payload = j.loads(prompt)
                asked.append(payload["topic"])
                return {"facts": [], "questions": []}
            return {"answers": [], "decisions": [], "summary": "", "questions": []}

    try:
        asyncio.run(organize(text, Provider()))
    except ValueError:
        pass  # sin afirmaciones el pipeline se detiene; aquí solo importa a quién se encargó
    assert "negocio" in asked and "tiempos" in asked


def test_un_relato_corto_tambien_se_reparte_entre_temas():
    text = "Fabricamos transformadores. Tenemos 10 embobinadoras. Trabajan 20 operadores en dos turnos."
    asked = []

    class Provider:
        model = "prueba"
        capabilities = {"max_context": 8192}

        async def json(self, system, prompt, schema):
            props = schema.get("properties", {})
            if "assignments" in props:
                return {"entities": [], "assignments": [], "questions": []}
            if "facts" in props:
                import json as j
                asked.append(j.loads(prompt)["topic"])
                return {"facts": [], "questions": []}
            return {"answers": [], "decisions": [], "summary": "", "questions": []}

    try:
        asyncio.run(organize(text, Provider()))
    except ValueError as exc:
        assert "delegar" not in str(exc)
    assert {"maquinas", "personal"} <= set(asked)
