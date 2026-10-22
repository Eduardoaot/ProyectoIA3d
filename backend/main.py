import asyncio
import json
import os
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cauce import catalog
from cauce import criteria
from cauce import context as ctxmod
from cauce import decision
from cauce.validate import Validator, claims_from, trailer
from cauce.versions import context_version, plant_version
from cauce.engine import compare, evaluate, rebalance_ops, relations
from cauce.layout import alternatives, ops_moves, plant_area, score
from cauce.agents import MIN_CUES, check, detail, prompt, read_spatial
from cauce.agents.roles import MISSION_SCHEMA
from cauce.agents.context_workspace import organize_context
from cauce.planops import plan_ops
from cauce.simulate import simulate
from cauce.compact import compact_alternative, footprint
from cauce.providers import caps, get_provider
from cauce.story import STORY_SCHEMA, STORY_SYSTEM, build_plant
from cauce.workspace_routes import create_router

# Un proveedor por rol (criterios §7.3); cada uno se configura con CAUCE_<ROL>_PROVIDER/MODEL.
extractor = get_provider("extractor")  # historia -> JSON
engineer = get_provider("chat")  # chat del ingeniero
reporter = get_provider("informe")  # texto del informe
missioner = get_provider("misiones")  # misiones del taller (JSON)
editor = get_provider("editor")  # asistente del editor: instrucción -> operaciones
spatial = get_provider("espacial")  # agentes que leen el espacio
seer = get_provider("vision")  # imágenes de referencia (solo si el modelo tiene visión)
context_organizer = get_provider("contexto")  # especialistas por tema y consolidador
context_organizer.max_output_tokens = 4096
analyst = get_provider("analista")
analyst.max_output_tokens = 2048


async def warm_up():
    """Al arrancar, deja leídas las instrucciones del extractor y del revisor (las dos llamadas
    que hace toda historia). La primera historia se ahorra ~1 min en CPU; sin Ollama no pasa nada."""
    for system in (STORY_SYSTEM, REVIEW_SYSTEM):
        try:
            await extractor.warm(system)
        except Exception:  # noqa: BLE001
            return


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(warm_up()) if hasattr(extractor, "warm") and os.getenv("CAUCE_WARM", "1") != "0" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Cauce", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(create_router(lambda: context_organizer))


async def spatial_or_extractor():
    """El modelo espacial si está instalado; si no, el extractor hace ese trabajo."""
    st = await spatial.status()
    return spatial if st.get("ready") else extractor


class StoryInterface(BaseModel):
    text: str
    context: dict | None = None


class OrganizeContextInterface(BaseModel):
    text: str


class PlantInterface(BaseModel):
    plant: dict
    context: str | dict | None = None
    weights: dict | None = None
    reviewed: bool | None = None


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


@app.post("/api/studies/build")
def study_deliverables(body: ContextInterface):
    from cauce.workspace_deliverables import build
    return build(body.context, body.plant, body.analysis, body.redesign)


@app.post("/api/master/verify")
def verify_master_layout(body: PlantInterface):
    from cauce.master_builder import verify
    master = body.context.get("master") if isinstance(body.context, dict) else None
    if not isinstance(master, dict):
        raise HTTPException(422, "No hay un contexto maestro aceptado para comparar.")
    try:
        return verify(master, body.plant)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# Funciones nuevas del contrato v3 que ya están implementadas. El frontend las consulta
# en /api/capabilities y oculta lo que no aparece aquí. Se completa fase por fase.
FEATURES: list[str] = ["construction_jobs", "context_master", "report_validation", "segmented_context", "count", "locked", "plan_ops", "weights", "flows", "conveyors", "simulate", "context_agents", "context_workspace", "context_jobs", "context_documents", "work_studies", "operator_import"]


def provider_caps(p) -> dict:
    return caps(p)


@app.get("/api/capabilities")
async def capabilities():
    # `vision` es la del proveedor que lee imágenes; llama3.1:8b (por defecto) no tiene.
    return {"schema_version": 3, "features": FEATURES, "vision": bool(provider_caps(seer)["vision"])}


@app.get("/api/health")
async def health():
    ex, en, sp = await extractor.status(), await engineer.status(), await spatial.status()
    return {
        "extractor": {"provider": extractor.name, "model": extractor.model, **ex},
        "engineer": {"provider": engineer.name, "model": engineer.model, **en},
        "spatial": {"provider": spatial.name, "model": spatial.model, **sp},
        "roles": {k: {"provider": v.name, "model": v.model, "capabilities": caps(v)} for k, v in (("informe", reporter), ("misiones", missioner), ("editor", editor))},
    }


@app.get("/api/catalog")
async def catalog_route():
    return catalog.public()


FLOW_SCHEMA = {"type": "object", "properties": {"flujo": STORY_SCHEMA["properties"]["flujo"]}, "required": ["flujo"]}
REVIEW_SYSTEM = (pathlib.Path(__file__).resolve().parent / "cauce" / "agents" / "revisor.md").read_text(encoding="utf-8").strip()


async def review_flow(provider, text: str, extracted: dict) -> dict:
    """El flujo corregido por el revisor si es válido (solo nombres de la lista); si falla, el original."""
    names = [str(x.get("nombre")) for x in extracted.get("estaciones") or [] if isinstance(x, dict) and x.get("nombre")]
    prompt_ = f"Historia:\n{text}\n\nEstaciones: {json.dumps(names, ensure_ascii=False)}\n\nFlujo propuesto: {json.dumps(extracted.get('flujo') or [], ensure_ascii=False)}"
    try:
        out = await provider.json(REVIEW_SYSTEM, prompt_, FLOW_SCHEMA)
    except Exception:  # noqa: BLE001
        return extracted
    flujo = out.get("flujo") if isinstance(out, dict) else None
    if not isinstance(flujo, list) or check({"flujo": flujo}, FLOW_SCHEMA):
        return extracted
    known = {n.strip().lower() for n in names}
    flujo = [f for f in flujo if isinstance(f, dict) and str(f.get("de", "")).strip().lower() in known and str(f.get("a", "")).strip().lower() in known]
    # Un revisor que deja menos de la mitad de las conexiones probablemente se equivocó: se queda el original.
    if len(flujo) < max(1, len(extracted.get("flujo") or []) // 2):
        return extracted
    return {**extracted, "flujo": flujo, "flujo_revisado": True}


@app.post("/api/context/organize")
async def context_organize(body: OrganizeContextInterface):
    text = body.text.strip()
    if not text or len(text) > 8000:
        raise HTTPException(422, "Describe la planta con entre 1 y 8000 caracteres por envío.")
    if not (await context_organizer.status()).get("ready"):
        raise HTTPException(503, "El proveedor de contexto no está disponible.")
    return await organize_context(text, context_organizer)


@app.post("/api/story")
async def story(body: StoryInterface):
    master = body.context.get("master") if body.context else None
    if isinstance(master, dict) and master.get("schema_version") == 2:
        from cauce.master_builder import build
        try:
            return build(master)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if body.context and (ctxmod.current(body.context) or body.context.get("activities")):
        # Esta vía usa únicamente la revisión aceptada; el relato sin revisar no sustituye correcciones.
        body = body.model_copy(update={"text": "\n".join(ctxmod.lines(body.context))})
    extracted, error = None, None
    
    try:
        extracted = await extractor.json(STORY_SYSTEM, body.text, STORY_SCHEMA)
        problems = check(extracted, STORY_SCHEMA)
        if problems:
            # Un reintento con los errores a la vista; build_plant descarta lo que siga mal.
            retry = await extractor.json(STORY_SYSTEM, body.text + "\n\nTu respuesta anterior no cumplía el esquema: " + "; ".join(problems[:6]), STORY_SCHEMA)
            if not check(retry, STORY_SCHEMA) or len(check(retry, STORY_SCHEMA)) < len(problems):
                extracted = retry
    except Exception as e:
        error = str(e)

    # Segunda lectura: un revisor compara el flujo con la historia (ramas, salidas que faltan, retornos).
    if isinstance(extracted, dict) and len(extracted.get("estaciones") or []) >= 3:
        extracted = await review_flow(extractor, body.text, extracted)

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
    if body.context:
        result["notes"].append("Boceto a partir del contexto aceptado. Verifica dimensiones y posiciones: los datos no observados siguen siendo supuestos del boceto.")
    return {**result, "error": error, "extracted": extracted, "agents_raw": {k: v["data"] for k, v in (reading or {}).items()}, "context_version": context_version(body.context)}


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
    master = body.context.get("master") if isinstance(body.context, dict) else None
    verification = None
    if isinstance(master, dict) and master.get("schema_version") == 2:
        if body.reviewed is not True:
            raise HTTPException(409, "Revisa y confirma esta versión del plano antes de analizarla.")
        from cauce.master_builder import verify
        try:
            verification = verify(master, body.plant)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    try:
        weights, weights_note = criteria.normalize(body.weights)
    except criteria.WeightsError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    plant = body.plant
    current = evaluate(plant, plant["layout"])
    current["footprint_m2"] = footprint(plant, plant["layout"])
    alts = alternatives(plant)
    for a in alts:
        # `score` (menor es mejor) se conserva por compatibilidad; la recomendación es multicriterio.
        a["score"] = score(current, a["metrics"], a["works_cost"], plant.get("use_assumptions"))
        a["ops_moves"] = ops_moves(plant, a["metrics"].get("ops") if plant.get("use_assumptions") else None)
        a["metrics"]["footprint_m2"] = footprint(plant, a["positions"])
    r = criteria.rank(plant, current, alts, weights, plant_area(plant))
    for a in alts:
        a["scores"] = r["scores"][a["id"]]
        a["score_total"] = r["totals"][a["id"]]
        a["kind"] = "viable" if criteria.viable(a) else "ideal"
        a["sensitivity"] = r["sensitivity"]
    best = next(a for a in alts if a["id"] == r["recommended"])
    out = {
        "current": current,
        "alternatives": alts,
        "recommended": best["id"],
        "ideal": r["ideal"],
        "current_scores": r["scores"]["hoy"],
        "current_score_total": r["totals"]["hoy"],
        "relations": relations(plant),
        "comparison": compare(current, best["metrics"]),
        "plant_version": plant_version(plant),
        "context_version": context_version(body.context),
        "weights_used": weights,
        **decision.summary(plant, current, alts, best["id"]),
    }
    if weights_note:
        out["weights_note"] = weights_note
    if verification is not None:
        out["construction_verification"] = verification
    if isinstance(body.context, dict) and ("activities" in body.context or "operators" in body.context):
        from cauce.workspace_deliverables import build
        out["studies"] = build(body.context, plant, out)
    return out


@app.post("/api/compact")
async def compact_route(body: PlantInterface):
    """Quinta alternativa, a pedido: la IA da el criterio y el empacador junta las máquinas en el menor espacio."""
    accepted = body.context.get("master") if isinstance(body.context, dict) else None
    if accepted and body.reviewed is not True:
        raise HTTPException(409, "Confirma el plano actual antes de pedir una optimización con el contexto maestro.")
    plant = body.plant
    current = evaluate(plant, plant["layout"])
    provider = analyst if accepted else await spatial_or_extractor()
    alt = await compact_alternative(plant, provider, accepted)
    alt["score"] = score(current, alt["metrics"], alt["works_cost"], plant.get("use_assumptions"))
    alt["ops_moves"] = ops_moves(plant, alt["metrics"].get("ops") if plant.get("use_assumptions") else None)
    alt["model"] = provider.model if alt["source"] == "ia" else None
    alt["context_version"] = context_version(body.context)
    alt["plant_version"] = plant_version(plant)
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
        "Flujo del material: " + "; ".join(f"{names.get(r['from'])} -> {names.get(r['to'])} ({round(float(r.get('frac', 1)) * 100)} %)" + (" [retorno]" if r.get("is_return") else "") + (" [en banda]" if r.get("conveyor") else "") for r in plant.get("routes", []) if (r.get("flow") or "material") == "material") + ".",
        "Zonas donde no pasa material: " + (", ".join(z["name"] for z in plant.get("zones", [])) or "ninguna") + ".",
    ]
    for fl, label in (("personas", "Recorridos de personas"), ("vehiculos", "Recorridos de vehículos"), ("carga", "Movimiento de carga")):
        rs = [r for r in plant.get("routes", []) if r.get("flow") == fl]
        if rs:
            lines.append(f"{label}: " + "; ".join(f"{names.get(r['from'])} -> {names.get(r['to'])}" for r in rs) + ".")
    fixed = [s["name"] for s in plant["stations"] if s.get("locked")] + [z["name"] for z in plant.get("zones", []) if z.get("locked")]
    if fixed:
        lines.append("Elementos fijos (no se mueven): " + ", ".join(fixed) + ".")
    if not plant.get("use_assumptions"):
        lines.append("No hay tiempos ni producción: solo se analizan recorridos y cercanía entre áreas.")
    else:
        p = plant.get("params", {})
        lines.append(f"Supuestos: {p.get('demand')} piezas al día, lote de {p.get('batch')}, {p.get('trucks')} camiones al día.")
    lines += ctxmod.lines(ctx.context)
    if isinstance(ctx.context, dict) and ctx.context.get("activities"):
        from cauce.workspace_deliverables import build
        study = build(ctx.context)
        lines.append("Estudio de actividades aceptadas (no certifica cronometraje):")
        for row in study["rows"][:30]:
            lines.append(f"Actividad {row['id']}: {row['description']}; tipo {row['type']}; tiempo {row['time_min'] if row['time_min'] is not None else 'sin dato'} min; distancia {row['distance_m'] if row['distance_m'] is not None else 'sin dato'} m; fuente {row.get('source_id') or row['origin']}.")
        lines.append(study["note"])
        if len(study["rows"]) > 30:
            lines.append(f"Se presentan 30 de {len(study['rows'])} actividades al redactor; la tabla estructurada del estudio conserva todas las filas.")
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


REPORT_SYSTEM = prompt("informe")  # cauce/agents/informe.md


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


async def stream_or_fallback(messages: list[dict], fallback: str, provider=None):
    try:
        async for tok in (provider or engineer).stream(messages):
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
    return StreamingResponse(validated(stream_or_fallback(msgs, fallback_report(body), reporter), v, body.with_validation), media_type="text/plain; charset=utf-8")


@app.post("/api/chat")
async def chat(body: ChatInterface):
    f = facts(body.context) if body.context else "Aún no hay planta."
    system = prompt("chat") + "\n" + f  # cauce/agents/chat.md
    msgs = [{"role": "system", "content": system}] + body.messages[-12:]
    fallback = "El modelo de IA no está respondiendo. Inícialo con 'ollama serve' y vuelve a preguntar."
    # Las cifras que escribió el usuario también cuentan como respaldo.
    said = [str(m.get("content", "")) for m in body.messages if m.get("role") == "user"]
    v = Validator(f, claims_from(body.context.model_dump()) if body.context else None, said)
    return StreamingResponse(validated(stream_or_fallback(msgs, fallback), v, body.with_validation), media_type="text/plain; charset=utf-8")


def fallback_missions() -> list[dict]:
    return [
        {"titulo": "Pasillos despejados", "detalle": "Que ningún pasillo marcado tenga material estorbando al final del turno.", "puntos": 80, "turno": "Todo el día"},
        {"titulo": "Carro lleno, viaje corto", "detalle": "Mover material solo con el carro completo.", "puntos": 60, "turno": "Mañana"},
        {"titulo": "Nada esperando", "detalle": "Que no queden más de 4 piezas esperando frente a una estación a mitad de turno.", "puntos": 120, "turno": "Tarde"},
    ]


@app.post("/api/missions")
async def missions(body: ContextInterface):
    f = facts(body)
    try:
        out = await missioner.json(prompt("misiones"), "Datos:\n" + f, MISSION_SCHEMA)
        # Sin cifras inventadas: una misión cuyo detalle cita un número que no está en los hechos se descarta.
        v = Validator(f)
        items = [m for m in out.get("misiones", []) if m.get("titulo") and v.check(str(m.get("detalle", ""))) is None][:3]
        if len(items) == 3:
            return {"source": "ia", "missions": items}
    except Exception:  # noqa: BLE001
        pass
    return {"source": "reglas", "missions": fallback_missions()}


class PlanOpsInterface(BaseModel):
    instruction: str
    plant: dict


@app.post("/api/plan/ops")
async def plan_ops_route(body: PlanOpsInterface):
    """Asistente del editor: la IA propone en abstracto y el motor resuelve y valida (contrato §6.4)."""
    return await plan_ops(editor, body.plant, body.instruction)


class SimulateInterface(BaseModel):
    plant: dict
    alternative: str | None = "hoy"
    replicas: int = 30
    seed: int = 42
    days: int = 5
    positions: dict | None = None


@app.post("/api/simulate")
def simulate_route(body: SimulateInterface):
    """Simulación con variabilidad de hoy o de una alternativa (contrato §6.5)."""
    plant = body.plant
    pos = body.positions
    if pos is None and body.alternative not in (None, "", "hoy"):
        alt = next((a for a in alternatives(plant) if a["id"] == body.alternative), None)
        if not alt:
            raise HTTPException(status_code=404, detail=f"No existe la alternativa {body.alternative}")
        pos = alt["positions"]
    out = simulate(plant, pos or plant["layout"], body.replicas, body.seed, body.days)
    return {**out, "alternative": body.alternative or "hoy"}


class ReferenceInterface(BaseModel):
    image: str  # data URL o base64
    note: str = ""


REFERENCE_SYSTEM = (
    "Describes en español, en frases cortas e impersonales, la distribución de planta que muestra la imagen: "
    "qué áreas se ven, cómo se ordenan y por dónde parece moverse el material. No inventes medidas ni cifras."
)


@app.post("/api/references/read")
async def read_reference(body: ReferenceInterface):
    """Lee una imagen de referencia solo si el proveedor tiene visión; si no, lo dice (no finge)."""
    if not provider_caps(seer)["vision"] or not hasattr(seer, "vision"):
        raise HTTPException(status_code=422, detail=f"El proveedor actual ({seer.model}) no tiene visión: la imagen se guarda como nota, sin interpretar.")
    data = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
    try:
        text = await seer.vision(REFERENCE_SYSTEM, body.note or "Describe la distribución.", [data])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"No se pudo leer la imagen: {e}") from e
    # Las cifras que el modelo vea en una foto no son datos del motor: se quitan.
    v = Validator(body.note or "")
    return {"interpreted": True, "model": seer.model, "text": v.filter_text(text), "validation": v.result()}
