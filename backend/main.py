import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cauce import catalog
from cauce.engine import compare, evaluate, rebalance_ops, relations
from cauce.layout import alternatives, ops_moves, score
from cauce.providers import get_engineer, get_extractor
from cauce.story import STORY_SCHEMA, STORY_SYSTEM, build_plant

app = FastAPI(title="Cauce")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
extractor = get_extractor()   # devuelve JSON
engineer = get_engineer()     # escribe informes


class StoryInterface(BaseModel):
    text: str


class PlantInterface(BaseModel):
    plant: dict


class LayoutInterface(BaseModel):
    plant: dict
    positions: dict
    rebalance: bool = False


class ContextInterface(BaseModel):
    plant: dict
    analysis: dict | None = None
    redesign: dict | None = None


class ChatInterface(BaseModel):
    messages: list[dict]
    context: ContextInterface | None = None


@app.get("/api/health")
async def health():
    ex, en = await extractor.status(), await engineer.status()

    return {
        "extractor": {"provider": extractor.name, "model": extractor.model, **ex},
        "engineer": {"provider": engineer.name, "model": engineer.model, **en},
    }


@app.get("/api/catalog")
async def catalog_route():
    return catalog.public()


@app.post("/api/story")
async def story(body: StoryInterface):
    extracted, error = None, None
    
    try:
        extracted = await extractor.json(STORY_SYSTEM, body.text, STORY_SCHEMA)
    except Exception as e:
        error = str(e)

    result = build_plant(body.text, extracted)
    return {**result, "error": error, "extracted": extracted}


@app.post("/api/routes")
async def routes(body: LayoutInterface):
    plant = {**body.plant, "use_assumptions": False}
    m = evaluate(plant, body.positions)
    return {"legs": m["legs"], "piece_m": m["piece_m"], "blocked_legs": m["blocked_legs"], "avoid_hits": m["avoid_hits"]}


@app.post("/api/evaluate")
async def evaluate_route(body: LayoutInterface):
    ops = rebalance_ops(body.plant, body.positions) if body.rebalance and body.plant.get("use_assumptions") else None
    m = evaluate(body.plant, body.positions, ops)
    return {**m, "ops_moves": ops_moves(body.plant, ops)}


@app.post("/api/analyze")
async def analyze_route(body: PlantInterface):
    plant = body.plant
    current = evaluate(plant, plant["layout"])
    alts = alternatives(plant)

    for a in alts:
        a["score"] = score(current, a["metrics"], a["works_cost"], plant.get("use_assumptions"))
        a["ops_moves"] = ops_moves(plant, a["metrics"].get("ops") if plant.get("use_assumptions") else None)
    best = min(alts, key=lambda a: a["score"])
    
    return {
        "current": current,
        "alternatives": alts,
        "recommended": best["id"],
        "relations": relations(plant),
        "comparison": compare(current, best["metrics"]),
    }


# ---------- Textos del ingeniero ----------

def facts(ctx: ContextInterface) -> str:
    plant, a, rd = ctx.plant, ctx.analysis, ctx.redesign

    names = {s["id"]: s["name"] for s in plant["stations"]}

    lines = [
        f"Planta: {plant.get('name')}. Bodega de {plant['size']['w']} x {plant['size']['d']} m.",
        "Estaciones en orden: " + ", ".join(s["name"] for s in plant["stations"]) + ".",
        "Flujo: " + "; ".join(f"{names.get(r['from'])} -> {names.get(r['to'])} ({round(float(r.get('frac', 1)) * 100)} %)" for r in plant.get("routes", [])) + ".",
        "Zonas donde no pasa material: " + (", ".join(z["name"] for z in plant.get("zones", [])) or "ninguna") + ".",
    ]

    if not plant.get("use_assumptions"):
        lines.append("No hay tiempos ni producción: solo se analizan recorridos y cercanía entre áreas.")
    else:
        p = plant.get("params", {})
        lines.append(f"Supuestos: {p.get('demand')} piezas al día, lote de {p.get('batch')}, {p.get('trucks')} camiones al día.")

    if a:
        cur = a["current"]
        lines.append(f"Hoy una pieza recorre {cur['piece_m']} m dentro de la planta.")

        if cur.get("daily_m") is not None:
            lines.append(f"Hoy se mueven {cur['daily_m']} m de material al día; capacidad {cur.get('capacity')} piezas al día; tiempo por pieza {cur.get('lead_h')} h; carga de camiones {cur.get('loading_min')} min al día.")
            if cur.get("bottleneck"):
                lines.append(f"Cuello de botella: {names.get(cur['bottleneck'])} al {round(cur['bottleneck_util'] * 100)} %.")

        for x in cur.get("avoid_hits", []):
            lines.append(f"Aviso: {x['text']}.")
        lines.append("Alternativas: " + "; ".join(f"{x['name']}: {x['metrics']['piece_m']} m por pieza" for x in a["alternatives"]) + ".")

    if rd and rd.get("metrics"):
        m = rd["metrics"]
        lines.append(f"Rediseño elegido: {rd.get('name')}. Una pieza recorre {m['piece_m']} m.")
        if m.get("daily_m") is not None:
            lines.append(f"Con el rediseño: {m['daily_m']} m al día, capacidad {m.get('capacity')}, {m.get('lead_h')} h por pieza, camiones {m.get('loading_min')} min.")
    return "\n".join(lines)


REPORT_SYSTEM = (
    "Eres un ingeniero de procesos que le habla al dueño de un taller pequeño. "
    "Escribe en español, claro y directo, sin jerga innecesaria y sin inventar cifras: usa solo los datos dados. "
    "Estructura: un párrafo de diagnóstico, uno sobre el rediseño elegido y una lista de 3 acciones para la semana. "
    "Si no hay tiempos ni producción, habla solo de recorridos y cercanía entre áreas. No uses emojis. Máximo 220 palabras."
)


def fallback_report(ctx: ContextInterface) -> str:
    a, rd = ctx.analysis, ctx.redesign
    if not a:
        return "Informe no generado."

    cur = a["current"]
    txt = f"Hoy una pieza recorre {cur['piece_m']:.0f} m dentro de la planta."

    if rd and rd.get("metrics"):
        m = rd["metrics"]
        pct = round((m["piece_m"] - cur["piece_m"]) / cur["piece_m"] * 100) if cur["piece_m"] else 0
        txt += f" Con «{rd.get('name')}» baja a {m['piece_m']:.0f} m ({pct:+d} %)."

    if cur.get("bottleneck"):
        names = {s["id"]: s["name"] for s in ctx.plant["stations"]}
        txt += f"\n\nEl cuello de botella es {names.get(cur['bottleneck'], '').lower()} al {round(cur['bottleneck_util'] * 100)} %."

    txt += (
        "\n\nAcciones sugeridas:\n"
        "1. Marcar en el piso los nuevos lugares antes de mover nada.\n"
        "2. Mover primero las estaciones que más recorrido ahorran.\n"
        "3. Medir cinco días los tiempos reales para confirmar los supuestos."
    )

    return txt


async def stream_or_fallback(messages: list[dict], fallback: str):
    try:
        async for tok in engineer.stream(messages):
            yield tok
    except Exception: 
        for word in fallback.split(" "):
            yield word + " "
            await asyncio.sleep(0.012)


@app.post("/api/report")
async def report(body: ContextInterface):
    msgs = [{"role": "system", "content": REPORT_SYSTEM}, {"role": "user", "content": facts(body)}]
    return StreamingResponse(stream_or_fallback(msgs, fallback_report(body)), media_type="text/plain; charset=utf-8")


@app.post("/api/chat")
async def chat(body: ChatInterface):
    system = (
        "Eres el ingeniero de procesos de Cauce. Respondes en español, breve y concreto, sin emojis. "
        "Si te preguntan algo que los datos no cubren, dilo y sugiere qué medir. Datos de la planta:\n"
        + (facts(body.context) if body.context else "Aún no hay planta.")
    )
    msgs = [{"role": "system", "content": system}] + body.messages[-12:]

    fallback = "El modelo de IA no está respondiendo."

    return StreamingResponse(stream_or_fallback(msgs, fallback), media_type="text/plain; charset=utf-8")


MISSION_SCHEMA = {
    "type": "object",
    "properties": {
        "misiones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"titulo": {"type": "string"}, "detalle": {"type": "string"}, "puntos": {"type": "integer"}, "turno": {"type": "string"}},
                "required": ["titulo", "detalle", "puntos"],
            },
        }
    },
    "required": ["misiones"],
}


def fallback_missions() -> list[dict]:
    return [
        {"titulo": "Pasillos despejados", "detalle": "Que ningún pasillo marcado tenga material estorbando al final del turno.", "puntos": 80, "turno": "Todo el día"},
        {"titulo": "Carro lleno, viaje corto", "detalle": "Mover material solo con el carro completo.", "puntos": 60, "turno": "Mañana"},
        {"titulo": "Nada esperando", "detalle": "Que no queden más de 4 piezas esperando frente a una estación a mitad de turno.", "puntos": 120, "turno": "Tarde"},
    ]


@app.post("/api/missions")
async def missions(body: ContextInterface):
    prompt = "Propón 3 misiones cortas para el equipo de planta, enfocadas en equipos y no en personas, con puntos entre 50 y 150. Datos:\n" + facts(body)
    try:
        out = await extractor.json("Devuelves solo JSON con misiones de mejora continua en español.", prompt, MISSION_SCHEMA)
        items = [m for m in out.get("misiones", []) if m.get("titulo")][:3]
        if len(items) == 3:
            return {"source": "ia", "missions": items}
    except Exception:
        pass
    return {"source": "reglas", "missions": fallback_missions()}