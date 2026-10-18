import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cauce import catalog
from cauce import context as ctxmod
from cauce import decision
from cauce.validate import Validator, claims_from, trailer
from cauce.versions import context_version, plant_version
from cauce.engine import compare, evaluate, rebalance_ops, relations
from cauce.layout import alternatives, ops_moves, score
from cauce.agents import MIN_CUES, detail, read_spatial
from cauce.compact import compact_alternative, footprint
from cauce.providers import get_engineer, get_extractor, get_spatial
from cauce.story import STORY_SCHEMA, STORY_SYSTEM, build_plant

app = FastAPI(title="Cauce")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
extractor = get_extractor()   # devuelve JSON
engineer = get_engineer()     # escribe informes
spatial = get_spatial()       # agentes que leen el espacio (modelo más capaz)


async def spatial_or_extractor():
    """El modelo espacial si está instalado; si no, el extractor hace ese trabajo."""
    st = await spatial.status()
    return spatial if st.get("ready") else extractor


class StoryInterface(BaseModel):
    text: str


class PlantInterface(BaseModel):
    plant: dict
    context: str | dict | None = None
    weights: dict | None = None


class LayoutInterface(BaseModel):
    plant: dict
    positions: dict
    rebalance: bool = False


class ContextInterface(BaseModel):
    plant: dict
    analysis: dict | None = None
    redesign: dict | None = None
    context: str | dict | None = None
    # Con True, el flujo de texto termina con el resumen de validación (validate.trailer).
    with_validation: bool = False


class ChatInterface(BaseModel):
    messages: list[dict]
    context: ContextInterface | None = None
    with_validation: bool = False


# Funciones nuevas del contrato v3 que ya están implementadas. El frontend las consulta
# en /api/capabilities y oculta lo que no aparece aquí. Se completa fase por fase.
FEATURES: list[str] = ["report_validation", "segmented_context", "count", "locked"]


def provider_caps(p) -> dict:
    return {"json_schema": False, "stream": True, "vision": False, "max_context": 0, **getattr(p, "capabilities", {})}


@app.get("/api/capabilities")
async def capabilities():
    return {"schema_version": 3, "features": FEATURES, "vision": bool(provider_caps(engineer)["vision"])}


@app.get("/api/health")
async def health():
    ex, en, sp = await extractor.status(), await engineer.status(), await spatial.status()
    return {
        "extractor": {"provider": extractor.name, "model": extractor.model, **ex},
        "engineer": {"provider": engineer.name, "model": engineer.model, **en},
        "spatial": {"provider": spatial.name, "model": spatial.model, **sp},
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

    # Si la historia describe el espacio, se consulta a un agente por cada tipo de interpretación.
    score, _ = detail(body.text)
    reading, model = None, None
    if score >= MIN_CUES:
        provider = await spatial_or_extractor()
        model = provider.model
        names = [str(x.get("nombre")) for x in (extracted or {}).get("estaciones", []) or [] if isinstance(x, dict) and x.get("nombre")]
        reading = await read_spatial(provider, body.text, names)

    result = build_plant(body.text, extracted, reading)
    result["spatial"] = {**result["spatial"], "detail": score, "needed": MIN_CUES, "model": model, "errors": {k: v["error"] for k, v in (reading or {}).items() if v["error"]}}
    return {**result, "error": error, "extracted": extracted, "agents_raw": {k: v["data"] for k, v in (reading or {}).items()}}


# Cálculo puro (sin IA): funciones normales, FastAPI las corre en otro hilo y el servidor sigue atendiendo.
@app.post("/api/routes")
def routes(body: LayoutInterface):
    plant = {**body.plant, "use_assumptions": False}
    m = evaluate(plant, body.positions)
    return {"legs": m["legs"], "piece_m": m["piece_m"], "blocked_legs": m["blocked_legs"], "avoid_hits": m["avoid_hits"]}


@app.post("/api/evaluate")
def evaluate_route(body: LayoutInterface):
    ops = rebalance_ops(body.plant, body.positions) if body.rebalance and body.plant.get("use_assumptions") else None
    m = evaluate(body.plant, body.positions, ops)
    return {**m, "ops_moves": ops_moves(body.plant, ops)}


@app.post("/api/analyze")
def analyze_route(body: PlantInterface):
    plant = body.plant
    current = evaluate(plant, plant["layout"])
    current["footprint_m2"] = footprint(plant, plant["layout"])
    alts = alternatives(plant)
    for a in alts:
        a["score"] = score(current, a["metrics"], a["works_cost"], plant.get("use_assumptions"))
        a["ops_moves"] = ops_moves(plant, a["metrics"].get("ops") if plant.get("use_assumptions") else None)
        a["metrics"]["footprint_m2"] = footprint(plant, a["positions"])
    best = min(alts, key=lambda a: a["score"])
    return {
        "current": current,
        "alternatives": alts,
        "recommended": best["id"],
        "relations": relations(plant),
        "comparison": compare(current, best["metrics"]),
        "plant_version": plant_version(plant),
        "context_version": context_version(body.context),
        **decision.summary(plant, current, alts, best["id"]),
    }


@app.post("/api/compact")
async def compact_route(body: PlantInterface):
    """Quinta alternativa, a pedido: la IA da el criterio y el empacador junta las máquinas en el menor espacio."""
    plant = body.plant
    current = evaluate(plant, plant["layout"])
    provider = await spatial_or_extractor()
    alt = await compact_alternative(plant, provider)
    alt["score"] = score(current, alt["metrics"], alt["works_cost"], plant.get("use_assumptions"))
    alt["ops_moves"] = ops_moves(plant, alt["metrics"].get("ops") if plant.get("use_assumptions") else None)
    alt["model"] = provider.model if alt["source"] == "ia" else None
    return alt


# ---------- Textos del ingeniero ----------

def _vs_today(before, after):
    p = decision.pct(before, after)
    if p is None:
        return ""
    if p > 0.5:
        return f" ({p:+.1f} % frente a hoy: más que hoy)"
    if p < -0.5:
        return f" ({p:+.1f} % frente a hoy: menos que hoy)"
    return " (igual que hoy)"


def facts(ctx: ContextInterface) -> str:
    plant, a, rd = ctx.plant, ctx.analysis, ctx.redesign
    names = {s["id"]: s["name"] for s in plant["stations"]}
    lines = [
        f"Planta: {plant.get('name')}. Bodega de {plant['size']['w']} x {plant['size']['d']} m.",
        "Estaciones en orden: " + ", ".join(s["name"] + (f" (x{s['count']})" if int(s.get("count") or 1) > 1 else "") for s in plant["stations"]) + ".",
        "Flujo: " + "; ".join(f"{names.get(r['from'])} -> {names.get(r['to'])} ({round(float(r.get('frac', 1)) * 100)} %)" for r in plant.get("routes", [])) + ".",
        "Zonas donde no pasa material: " + (", ".join(z["name"] for z in plant.get("zones", [])) or "ninguna") + ".",
    ]
    fixed = [s["name"] for s in plant["stations"] if s.get("locked")] + [z["name"] for z in plant.get("zones", []) if z.get("locked")]
    if fixed:
        lines.append("Elementos fijos (no se mueven): " + ", ".join(fixed) + ".")
    if not plant.get("use_assumptions"):
        lines.append("No hay tiempos ni producción: solo se analizan recorridos y cercanía entre áreas.")
    else:
        p = plant.get("params", {})
        lines.append(f"Supuestos: {p.get('demand')} piezas al día, lote de {p.get('batch')}, {p.get('trucks')} camiones al día.")
    lines += ctxmod.lines(ctx.context)
    if a:
        cur = a["current"]
        lines.append(f"Hoy una pieza recorre {cur['piece_m']} m dentro de la planta.")
        if cur.get("daily_m") is not None:
            lines.append(f"Hoy se mueven {cur['daily_m']} m de material al día; capacidad {cur.get('capacity')} piezas al día; tiempo por pieza {cur.get('lead_h')} h; carga de camiones {cur.get('loading_min')} min al día.")
            if cur.get("bottleneck"):
                lines.append(f"Cuello de botella: {names.get(cur['bottleneck'])} al {round(cur['bottleneck_util'] * 100)} %.")
        for x in cur.get("avoid_hits", []):
            lines.append(f"Aviso: {x['text']}.")
        lines.append("Alternativas: " + "; ".join(f"{x['name']}: {x['metrics']['piece_m']} m por pieza{_vs_today(cur['piece_m'], x['metrics']['piece_m'])}" for x in a["alternatives"]) + ".")
        # La recomendada y su razón vienen del motor; el modelo no la elige.
        claims = claims_from(ctx.model_dump())
        if claims.recommended:
            rec = claims.labels.get(claims.recommended, claims.recommended)
            lines.append(a.get("recommended_reason") or f"Recomendada por el motor: «{rec}» (la de menor recorrido).")
            for t in a.get("recommended_tradeoffs") or []:
                lines.append(f"A cambio, la recomendada empeora: {t.get('note')}")
        for aid in sorted(claims.worse_than_today):
            lines.append(f"«{claims.labels.get(aid, aid)}» hace caminar más al material que hoy: no es más eficiente en recorrido.")
    if rd and rd.get("metrics"):
        m = rd["metrics"]
        base = (a or {}).get("current") or {}
        lines.append(f"Rediseño elegido por el usuario: {rd.get('name')}. Una pieza recorre {m['piece_m']} m{_vs_today(base.get('piece_m'), m['piece_m'])}.")
        if m.get("daily_m") is not None:
            lines.append(f"Con el rediseño: {m['daily_m']} m al día, capacidad {m.get('capacity')}, {m.get('lead_h')} h por pieza, camiones {m.get('loading_min')} min.")
    return "\n".join(lines)


REPORT_SYSTEM = (
    "Eres un ingeniero de procesos que le habla al dueño de un taller pequeño. "
    "Escribe en español, claro y directo, sin jerga innecesaria y sin inventar cifras: usa solo los datos dados. "
    "No calcules porcentajes ni diferencias: cita solo las cifras escritas en los datos. "
    "La alternativa recomendada la decide el motor y está en los datos; no elogies otra. "
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
        "\n\nAcciones para esta semana:\n"
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


async def validated(tokens, v: Validator, with_trailer: bool):
    """Solo pasan las oraciones respaldadas por el motor; al final, el resumen si se pidió."""
    async for sentence in v.filter_stream(tokens):
        yield sentence
    if with_trailer:
        yield trailer(v.result())


@app.post("/api/report")
async def report(body: ContextInterface):
    f = facts(body)
    msgs = [{"role": "system", "content": REPORT_SYSTEM}, {"role": "user", "content": f}]
    v = Validator(f, claims_from(body.model_dump()))
    return StreamingResponse(validated(stream_or_fallback(msgs, fallback_report(body)), v, body.with_validation), media_type="text/plain; charset=utf-8")


@app.post("/api/chat")
async def chat(body: ChatInterface):
    f = facts(body.context) if body.context else "Aún no hay planta."
    system = (
        "Eres el ingeniero de procesos de Cauce. Respondes en español, breve y concreto, sin emojis. "
        "Cita solo cifras que estén en los datos; no calcules otras. "
        "Si te preguntan algo que los datos no cubren, dilo y sugiere qué medir. Datos de la planta:\n" + f
    )
    msgs = [{"role": "system", "content": system}] + body.messages[-12:]
    fallback = "El modelo de IA no está respondiendo. Inícialo con 'ollama serve' y vuelve a preguntar."
    # Las cifras que escribió el usuario también cuentan como respaldo.
    said = [str(m.get("content", "")) for m in body.messages if m.get("role") == "user"]
    v = Validator(f, claims_from(body.context.model_dump()) if body.context else None, said)
    return StreamingResponse(validated(stream_or_fallback(msgs, fallback), v, body.with_validation), media_type="text/plain; charset=utf-8")


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
        # Las misiones son datos que usa el programa: las pide el extractor.
        out = await extractor.json("Devuelves solo JSON con misiones de mejora continua en español.", prompt, MISSION_SCHEMA)
        items = [m for m in out.get("misiones", []) if m.get("titulo")][:3]
        if len(items) == 3:
            return {"source": "ia", "missions": items}
    except Exception:  # noqa: BLE001
        pass
    return {"source": "reglas", "missions": fallback_missions()}
