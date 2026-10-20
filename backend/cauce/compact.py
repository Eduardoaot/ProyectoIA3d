"""Quinta alternativa: acomodo compacto sugerido por la IA.

La IA no da coordenadas (los modelos pequeños las inventan mal). Lee las
estaciones, el flujo y las zonas, y devuelve criterio: en qué orden colocar,
qué estaciones conviene agrupar y desde qué esquina empezar. Con eso, un
empacador determinista busca para cada estación el lugar libre que menos agranda
el área ocupada y que menos alarga el recorrido. Si la IA no responde, el mismo
empacador trabaja con el orden del flujo.
"""

from __future__ import annotations

from .catalog import CLEAN, DIRTY
from .engine import dims, evaluate, gate_pt, manhattan, rebalance_ops, station_map
from .story import impersonal
from .layout import EDGE, GAP, _rect, feasible, fixed_of, flow_order, locked_respected, nearest_free, plant_area

CORNERS = ["frente-izquierda", "frente-derecha", "fondo-izquierda", "fondo-derecha"]

COMPACT_SCHEMA = {
    "type": "object",
    "properties": {
        "orden": {"type": "array", "items": {"type": "string"}},
        "grupos": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
        "esquina": {"type": "string", "enum": CORNERS},
        "razones": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["orden", "grupos", "esquina", "razones"],
}

COMPACT_SYSTEM = (
    "Eres un ingeniero de distribución de planta. Recibes las estaciones de un taller con sus medidas, el flujo del material, "
    "las zonas fijas y los portones. Devuelves SOLO JSON con el esquema indicado. El objetivo es ocupar la menor superficie "
    "posible sin alargar el recorrido del material.\n"
    "- 'orden': todas las estaciones, con sus nombres exactos, en el orden en que conviene colocarlas una junto a otra.\n"
    "- 'grupos': estaciones que deben quedar pegadas (mucho flujo entre ellas o trabajo parecido). Nunca juntes una estación "
    "sucia (polvo, ruido o calor) con una limpia.\n"
    "- 'esquina': desde qué esquina conviene empezar a llenar ('frente' es el lado de la calle), cerca del portón de entrada.\n"
    "- 'razones': hasta 3 frases cortas en español que expliquen el criterio, en voz impersonal: cada frase empieza con \"Se\" (se agrupa, se coloca, se deja). Nunca en primera persona."
)


def facts(plant):
    st = station_map(plant)
    names = {s["id"]: s["name"] for s in plant["stations"]}
    lines = [f"Bodega de {plant['size']['w']} x {plant['size']['d']} m (la calle está al frente)."]
    lines.append("Estaciones:")
    for s in plant["stations"]:
        tag = " (sucia: polvo, ruido o calor)" if s["kind"] in DIRTY else " (debe quedar limpia)" if s["kind"] in CLEAN else ""
        lines.append(f"- {s['name']}: {s['w']} x {s['d']} m{tag}")
    lines.append("Flujo: " + "; ".join(f"{names.get(r['from'])} -> {names.get(r['to'])} ({round(float(r.get('frac', 1)) * 100)} %)" for r in plant.get("routes", []) if r["from"] in st and r["to"] in st))
    zones = plant.get("zones", [])
    if zones:
        lines.append("Zonas fijas: " + ", ".join(f"{z['name']} ({'limpia' if z['kind'] in CLEAN else 'sin paso'})" for z in zones))
    W, D = plant["size"]["w"], plant["size"]["d"]
    for key, label in (("receive_gate", "entrada"), ("dispatch_gate", "salida")):
        g = next((g for g in plant.get("gates", []) if g["id"] == plant.get(key)), None)
        if g:
            x, z = g["x"], g.get("z", D)
            side = "frente" if z >= D - 0.5 else "fondo" if z <= 0.5 else "izquierda" if x <= 0.5 else "derecha" if x >= W - 0.5 else "frente"
            pos = "izquierda" if x < W / 3 else "derecha" if x > 2 * W / 3 else "centro"
            lines.append(f"Portón de {label}: lado {side}, hacia la {pos}.")
    return "\n".join(lines)


def corner_point(plant, corner):
    W, D = plant["size"]["w"], plant["size"]["d"]
    row, col = corner.split("-")
    return (EDGE if col == "izquierda" else W - EDGE, D - EDGE if row == "frente" else EDGE)


def _bbox(rects):
    return (min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))


def _area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def footprint(plant, positions):
    """Área del rectángulo que encierra todas las estaciones, con medio pasillo alrededor (m²)."""
    st = station_map(plant)
    rects = [_rect(st[sid], *p) for sid, p in positions.items() if sid in st]
    if not rects:
        return 0.0
    b = _bbox(rects)
    return round((b[2] - b[0] + GAP) * (b[3] - b[1] + GAP), 1)


def pack(plant, order, groups, corner, step=0.5):
    st = station_map(plant)
    W, D = plant["size"]["w"], plant["size"]["d"]
    anchor = corner_point(plant, corner)
    group_of = {}
    for i, g in enumerate(groups):
        for sid in g:
            group_of.setdefault(sid, i)
    links = {}
    for r in plant.get("routes", []):
        if r["from"] in st and r["to"] in st:
            f = float(r.get("frac", 1) or 0)
            links.setdefault(r["from"], []).append((r["to"], f))
            links.setdefault(r["to"], []).append((r["from"], f))

    # Lo que entra y lo que sale se queda cerca de su portón.
    gate_of = {"recepcion": gate_pt(plant, plant.get("receive_gate")), "despacho": gate_pt(plant, plant.get("dispatch_gate"))}

    # Lo fijo ya está en su lugar: el resto se acomoda alrededor.
    positions = {k: list(v) for k, v in fixed_of(plant).items()}
    rects = {k: _rect(st[k], *v) for k, v in positions.items()}
    placed = list(rects.values())
    for sid in order:
        if sid in positions:
            continue
        s = st[sid]
        gate = gate_of.get(s["kind"])
        # Caja de lo ya colocado: se calcula una vez por estación, no por cada lugar candidato.
        bb = _bbox(list(rects.values())) if rects else None
        cands = []
        for rot in (0, 90) if s["w"] != s["d"] else (0,):
            w, d = dims(s, rot)
            nx = int((W - w - 2 * EDGE) / step) + 1
            nz = int((D - d - 2 * EDGE) / step) + 1
            for i in range(max(nx, 0)):
                x = w / 2 + EDGE + i * step
                for j in range(max(nz, 0)):
                    z = d / 2 + EDGE + j * step
                    r = (x - w / 2, z - d / 2, x + w / 2, z + d / 2)
                    if rects:
                        cost = (max(bb[2], r[2]) - min(bb[0], r[0])) * (max(bb[3], r[3]) - min(bb[1], r[1]))
                    else:
                        cost = manhattan((x, z), anchor) * 4
                    for other, f in links.get(sid, []):
                        if other in positions:
                            cost += 6 * f * manhattan((x, z), positions[other])
                    if gate:
                        cost += 4 * manhattan((x, z), gate)
                    g = group_of.get(sid)
                    if g is not None:
                        for other in groups[g]:
                            if other in positions and other != sid:
                                cost += 3 * manhattan((x, z), positions[other])
                    if s["kind"] in DIRTY or s["kind"] in CLEAN:
                        for other, p in positions.items():
                            ko = st[other]["kind"]
                            if (s["kind"] in DIRTY and ko in CLEAN) or (s["kind"] in CLEAN and ko in DIRTY):
                                cost += 200 if manhattan((x, z), p) < 8 else 0
                    cands.append((cost, x, z, rot, r))
        cands.sort(key=lambda c: c[0])
        done = False
        for _, x, z, rot, r in cands:
            if feasible(plant, r, placed):
                positions[sid] = [x, z, rot]
                placed.append(r)
                rects[sid] = r
                done = True
                break
        if not done:
            pos, r = nearest_free(plant, s, anchor, placed)
            positions[sid] = pos
            placed.append(r)
            rects[sid] = r
    return positions


def _resolve(names, stations):
    from .story import _match

    out = []
    for n in names or []:
        sid = _match(str(n), stations)
        if sid and sid not in out:
            out.append(sid)
    return out


async def compact_alternative(plant, provider):
    """Devuelve la alternativa compacta. 'source' dice si usó la IA o solo el empacador."""
    order = flow_order(plant)
    groups, corner, reasons, source, error = [], None, [], "reglas", None
    try:
        out = await provider.json(COMPACT_SYSTEM, facts(plant), COMPACT_SCHEMA)
        ai_order = _resolve(out.get("orden"), plant["stations"])
        if len(ai_order) >= max(2, len(order) // 2):
            order = ai_order + [s for s in order if s not in ai_order]
            source = "ia"
        groups = [g for g in (_resolve(x, plant["stations"]) for x in out.get("grupos") or []) if len(g) > 1]
        corner = out.get("esquina") if out.get("esquina") in CORNERS else None
        reasons = [impersonal(x) for x in out.get("razones") or [] if str(x).strip()][:3]
    except Exception as e:  # noqa: BLE001
        error = str(e)

    # Se prueban las cuatro esquinas: la de la IA primero; gana la que ocupa menos sin alargar el recorrido.
    corners = ([corner] if corner else []) + [c for c in CORNERS if c != corner]
    best = None
    for c in corners:
        pos = pack(plant, order, groups, c)
        m = evaluate(plant, pos)
        fp = footprint(plant, pos)
        score = fp + 4 * m["piece_m"] + 0.01 * corners.index(c)
        if best is None or score < best[0]:
            best = (score, c, pos)
    _, used, pos = best
    ops = rebalance_ops(plant, pos) if plant.get("use_assumptions") else None
    metrics = evaluate(plant, pos, ops)
    fp = footprint(plant, pos)
    total = plant_area(plant)
    metrics["footprint_m2"] = fp
    summary = f"Las máquinas juntas en {fp:g} m², desde la esquina {used.replace('-', ' ')}. Queda libre el {round((1 - fp / total) * 100) if total else 0} % de la planta."
    return {
        "id": "ia",
        "name": "Compacta con IA",
        "summary": summary,
        "works": "Mover máquinas para juntarlas.",
        "works_cost": 1,
        "positions": pos,
        "metrics": metrics,
        "source": source,
        "reasons": reasons,
        "error": error,
        "locked_respected": locked_respected(plant, pos),
    }
