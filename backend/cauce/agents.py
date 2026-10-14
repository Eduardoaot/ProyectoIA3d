"""Lectura espacial de la historia con varios agentes.

Si la historia trae suficientes pistas del espacio (medidas, lados, paredes,
"al fondo", "junto a"...), se consulta a un agente por cada tipo de
interpretación (solo a los que tienen algo que leer):

- edificio: forma de la bodega, medidas y en qué lado están la calle y los portones.
- zonas: oficina, baños, comedor o zonas bloqueadas y en qué parte de la planta quedan.
- acomodo: en qué parte de la planta está cada estación del proceso.
- paredes: qué áreas están separadas por muros o divisiones.

Cada agente devuelve solo JSON. Luego el código valida contra el texto (lo que
la historia no dice se descarta) y lo convierte en geometría de forma determinista.
"""

from __future__ import annotations

import math
import re

from .catalog import ZONE
from .engine import gate_pt, outline, point_in_poly, rect_at, station_map, zone_rect
from .layout import EDGE, nearest_free, shape_outline

# La planta se describe como si se viera desde arriba con la calle abajo:
# "frente" es el lado de la calle y "fondo" el lado opuesto.
SIDES = ["frente", "fondo", "izquierda", "derecha"]
REGIONS = [
    "frente-izquierda", "frente-centro", "frente-derecha",
    "centro-izquierda", "centro", "centro-derecha",
    "fondo-izquierda", "fondo-centro", "fondo-derecha",
]
SHAPES = ["rectangulo", "cuadrado", "L", "U", "T", "triangulo", "circulo"]

# Pistas de que la historia describe el espacio, no solo el proceso.
CUES = [
    r"\bizquierd", r"\bderech", r"\bal fondo\b", r"\bfondo de\b", r"\bal frente\b", r"\bfrente a\b", r"\bentrada\b",
    r"\bjunto a\b", r"\bal lado\b", r"\bpegad", r"\bcontra la pared\b", r"\besquina\b", r"\bcentro\b", r"\ben medio\b",
    r"\bpared\b", r"\bmuro\b", r"\btabique\b", r"\bdivisi", r"\bseparad", r"\bmetros\b", r"\d+\s*m\b", r"\d+\s*x\s*\d+",
    r"\bforma de\b", r"\ben (?:forma de )?[lut]\b", r"\btriangul", r"\bcircul", r"\bredond", r"\bcuadrad", r"\brectangul",
    r"\bporton", r"\bcortina", r"\bacceso\b", r"\bcalle\b", r"\bbano", r"\boficina\b", r"\bcomedor\b",
]
MIN_CUES = 4

_REGION_PROP = {"type": "string", "enum": REGIONS + ["desconocida"]}

BUILDING_SCHEMA = {
    "type": "object",
    "properties": {
        "forma": {"type": "string", "enum": SHAPES + ["desconocida"]},
        "ancho_m": {"type": "number"},
        "fondo_m": {"type": "number"},
        "portones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "lado": {"type": "string", "enum": SIDES},
                    "posicion": {"type": "string", "enum": ["izquierda", "centro", "derecha", "desconocida"]},
                    "uso": {"type": "string", "enum": ["entrada", "salida", "ambos", "desconocido"]},
                },
                "required": ["lado", "uso"],
            },
        },
    },
    "required": ["forma", "ancho_m", "fondo_m", "portones"],
}

ZONES_SCHEMA = {
    "type": "object",
    "properties": {
        "zonas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": list(ZONE)},
                    "nombre": {"type": "string"},
                    "ubicacion": _REGION_PROP,
                    "ancho_m": {"type": "number"},
                    "fondo_m": {"type": "number"},
                },
                "required": ["tipo", "ubicacion"],
            },
        }
    },
    "required": ["zonas"],
}

PLACES_SCHEMA = {
    "type": "object",
    "properties": {
        "estaciones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"nombre": {"type": "string"}, "ubicacion": _REGION_PROP, "junto_a": {"type": "string"}},
                "required": ["nombre", "ubicacion"],
            },
        }
    },
    "required": ["estaciones"],
}

WALLS_SCHEMA = {
    "type": "object",
    "properties": {
        "paredes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"encierra": {"type": "string"}, "divide": {"type": "string", "enum": ["no", "a lo ancho", "a lo largo"]}},
                "required": ["encierra"],
            },
        }
    },
    "required": ["paredes"],
}

COMMON = (
    "Eres un agente que lee la descripción de una planta o taller y devuelve SOLO un objeto JSON con el esquema indicado. "
    "No conversas ni explicas. Imagina la planta vista desde arriba con la calle abajo: 'frente' es el lado de la calle, "
    "'fondo' el lado opuesto, 'izquierda' y 'derecha' según se mira desde la calle hacia adentro. "
    "Si la historia no lo dice, usa 'desconocida' o deja la lista vacía. No inventes. "
    "Escribe el JSON compacto, en una sola línea y sin espacios de sobra.\n"
)

AGENTS = {
    "edificio": (
        COMMON + "Tu tarea: la forma del edificio (rectangulo, cuadrado, L, U, T, triangulo o circulo), su ancho y fondo en metros "
        "si se dicen, y cada portón o acceso: en qué lado está, si queda a la izquierda, centro o derecha de ese lado, y si por ahí "
        "entra el material, sale o ambos.",
        BUILDING_SCHEMA,
    ),
    "zonas": (
        COMMON + "Tu tarea: las áreas donde NO pasa el material: oficina, baños, comedor o zonas bloqueadas. Para cada una, en qué "
        "parte de la planta está (frente, centro o fondo, combinado con izquierda, centro o derecha) y sus medidas si se dicen.",
        ZONES_SCHEMA,
    ),
    "acomodo": (
        COMMON + "Tu tarea: para cada máquina o estación del proceso, en qué parte de la planta está (frente, centro o fondo, "
        "combinado con izquierda, centro o derecha) y junto a qué otra está, si se dice. Usa los nombres de esta lista: {names}.",
        PLACES_SCHEMA,
    ),
    "paredes": (
        COMMON + "Tu tarea: las paredes, muros o divisiones que se mencionan. 'encierra' es el área que la pared encierra o separa "
        "del resto (por ejemplo 'oficina' o 'pintura'). Si una pared divide toda la bodega, pon 'divide' en 'a lo ancho' o 'a lo largo'.",
        WALLS_SCHEMA,
    ),
}


def normalize(text):
    from .story import normalize as n  # story importa este módulo: se evita el ciclo al cargar

    return n(text)


def _match(name, stations):
    from .story import _match as m

    return m(name, stations)


def detail(text: str) -> tuple[int, list[str]]:
    t = normalize(text)
    hits = [c for c in CUES if re.search(c, t)]
    return len(hits), hits


# Cada agente solo se consulta si la historia trae pistas de lo suyo (ahorra minutos con modelos locales).
AGENT_CUES = {
    "edificio": r"porton|cortina|acceso|forma|metros|\d+\s*x\s*\d+|cuadrad|rectangul|triangul|circul|redond|\ben [lut]\b",
    "zonas": r"oficina|bano|comedor|cafeteria|ventas|administr",
    "acomodo": r"izquierd|derech|fondo|frente|centro|junto|al lado|esquina|en medio|pegad",
    "paredes": r"pared|muro|tabique|divisi|dividid|separad|encerrad|cuarto",
}


def agents_for(text: str) -> list[str]:
    t = normalize(text)
    return [k for k, cue in AGENT_CUES.items() if re.search(cue, t)]


async def read_spatial(provider, text: str, station_names: list[str]) -> dict:
    """Consulta uno por uno a los agentes que hacen falta. Un agente que falla no tumba a los demás.
    En serie y no en paralelo: con un modelo local en CPU, cuatro a la vez tardan más del triple."""

    async def one(key):
        system, schema = AGENTS[key]
        try:
            return key, await provider.json(system.replace("{names}", ", ".join(station_names) or "ninguna"), text, schema), None
        except Exception as e:  # noqa: BLE001
            return key, None, str(e) or type(e).__name__

    out = [await one(k) for k in agents_for(text)]
    return {k: {"data": d, "error": e} for k, d, e in out}


# ---------- De las respuestas a la geometría ----------

def _region_point(region, W, D, w=0, d=0):
    """Centro de una de las nueve regiones, dejando que el objeto quepa."""
    if region not in REGIONS:
        return None
    row, _, col = region.partition("-")
    if region == "centro":
        row, col = "centro", "centro"
    fx = {"izquierda": 0.17, "centro": 0.5, "derecha": 0.83}.get(col or "centro", 0.5)
    fz = {"fondo": 0.17, "centro": 0.5, "frente": 0.83}[row]
    x = min(W - w / 2 - EDGE, max(w / 2 + EDGE, W * fx))
    z = min(D - d / 2 - EDGE, max(d / 2 + EDGE, D * fz))
    return x, z


def _mentioned(t, *words):
    return any(re.search(r"(?<![a-z])" + re.escape(w), t) for w in words)


WALL_WORDS = ("pared", "muro", "tabique", "division", "dividid", "separad", "encerrad", "cuarto")
NEAR_WORDS = ("junto", "al lado", "pegad", "cerca")
GATE_WORDS = ("porton", "cortina", "acceso", "puerta", "entrada", "salida")


def _together(t, names, words):
    """¿Alguna oración de la historia nombra a la vez algo de names y algo de words?
    Así una pared o un lugar solo se acepta si la historia los dice juntos."""
    names = [n for n in names if n]
    for sentence in re.split(r"[.;:\n]+", t):
        if any(re.search(r"(?<![a-z])" + re.escape(n), sentence) for n in names) and _mentioned(sentence, *words):
            return True
    return False


def _station_words(s):
    from .catalog import KIND
    from .story import _stems

    return _stems(s["name"]) + (KIND[s["kind"]]["keywords"] if s["kind"] in KIND else [])


def _stems_of(name):
    from .story import _stems

    return _stems(name)


def _region_words(region):
    if region == "centro":
        return ("centro", "en medio")
    return tuple(w for w in region.split("-") if w != "centro")


def _numbers(t):
    return {float(x.replace(",", ".")) for x in re.findall(r"\d+(?:[.,]\d+)?", t)}


SHAPE_WORDS = {
    "L": [r"forma de l\b", r"\ben l\b", r"\bl\b"],
    "U": [r"forma de u\b", r"\ben u\b"],
    "T": [r"forma de t\b", r"\ben t\b"],
    "triangulo": [r"triangul"],
    "circulo": [r"circul", r"redond"],
    "cuadrado": [r"cuadrad"],
    "rectangulo": [r"rectangul"],
}

SIDE_EDGE = {"fondo": 0, "derecha": 1, "frente": 2, "izquierda": 3}
POS_T = {"izquierda": 0.22, "centro": 0.5, "derecha": 0.78}


def apply_building(plant, t, data, notes):
    if not data:
        return
    _building(plant, t, data, notes)
    # Los portones quedan sobre el contorno real (en una L o un círculo el frente no es una línea recta completa).
    for g in plant["gates"]:
        g["x"], g["z"] = (round(v, 2) for v in gate_pt(plant, g["id"], 0.0))


def _building(plant, t, data, notes):
    forma = data.get("forma")
    if forma in SHAPE_WORDS and any(re.search(p, t) for p in SHAPE_WORDS[forma]):
        nums = _numbers(t)
        w, d = data.get("ancho_m"), data.get("fondo_m")
        if isinstance(w, (int, float)) and isinstance(d, (int, float)) and w in nums and d in nums and 8 <= w <= 300 and 6 <= d <= 300:
            plant["size"] = {"w": float(w), "d": float(d)}
            notes.append(f"La bodega mide {w:g} x {d:g} m, según tu historia.")
        if forma == "cuadrado":
            side = max(plant["size"]["w"], plant["size"]["d"])
            plant["size"] = {"w": side, "d": side}
        outline = shape_outline(forma, plant["size"]["w"], plant["size"]["d"])
        if outline:
            plant["outline"] = outline
        notes.append(f"Forma del edificio: {forma if forma not in ('L', 'U', 'T') else 'en ' + forma}.")

    if not _mentioned(t, "porton", "cortina", "acceso", "puerta", "entrada", "salida"):
        return
    gates = []
    for i, g in enumerate((data.get("portones") or [])[:4]):
        side = g.get("lado")
        if side not in SIDE_EDGE:
            continue
        # Lados distintos del frente solo si la historia los nombra.
        side_words = ("fondo", "atras", "trasera") if side == "fondo" else (side,)
        if side != "frente" and not _together(t, GATE_WORDS, side_words):
            continue
        gates.append((side, POS_T.get(g.get("posicion"), 0.25 + 0.5 * (i % 2)), g.get("uso")))
    if not gates:
        return
    W, D = plant["size"]["w"], plant["size"]["d"]
    out = []
    for i, (side, f, use) in enumerate(gates):
        gid = "ABCD"[i]
        # Puntos sobre el rectángulo envolvente; se proyectan a la forma real en el frontend y el motor.
        if side == "frente":
            x, z = W * f, D
        elif side == "fondo":
            x, z = W * (1 - f), 0.0
        elif side == "izquierda":
            x, z = 0.0, D * (1 - f)
        else:
            x, z = W, D * f
        out.append({"id": gid, "x": round(x, 1), "z": round(z, 1), "label": f"Portón {gid}", "_use": use})
    plant["gates"] = [{k: v for k, v in g.items() if k != "_use"} for g in out]
    recv = next((g["id"] for g in out if g["_use"] in ("entrada", "ambos")), out[0]["id"])
    disp = next((g["id"] for g in out if g["_use"] in ("salida", "ambos") and g["id"] != recv), None)
    disp = disp or next((g["id"] for g in out if g["_use"] in ("salida", "ambos")), out[-1]["id"])
    plant["receive_gate"], plant["dispatch_gate"] = recv, disp
    sides = ", ".join(sorted({s for s, _, _ in gates}))
    notes.append(f"Portones ubicados en: {sides}.")


def _fit_zone(plant, z, target, taken):
    """El lugar más cercano a target donde la zona cabe dentro de la planta sin pisar otra zona."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    poly = outline(plant)
    w, d = z["w"], z["d"]
    cands = []
    for i in range(int((W - w) / 0.5) + 1):
        for j in range(int((D - d) / 0.5) + 1):
            x, y = w / 2 + i * 0.5, d / 2 + j * 0.5
            cands.append((abs(x - target[0]) + abs(y - target[1]), x, y))
    cands.sort()
    for _, x, y in cands:
        r = (x - w / 2, y - d / 2, x + w / 2, y + d / 2)
        if poly and not all(point_in_poly(poly, px, pz) for px, pz in ((r[0] + 0.01, r[1] + 0.01), (r[2] - 0.01, r[1] + 0.01), (r[0] + 0.01, r[3] - 0.01), (r[2] - 0.01, r[3] - 0.01))):
            continue
        if any(r[0] < q[2] and q[0] < r[2] and r[1] < q[3] and q[1] < r[3] for q in taken):
            continue
        return x, y
    return target


def fit_zones(plant):
    """Las zonas que ningún agente ubicó también deben quedar dentro de la forma y sin encimarse."""
    taken = [zone_rect(q) for q in plant["zones"] if q.get("_placed")]
    for z in plant["zones"]:
        if not z.pop("_placed", False):
            z["x"], z["z"] = _fit_zone(plant, z, (z["x"], z["z"]), taken)
            taken.append(zone_rect(z))


def apply_zones(plant, t, data, notes):
    if not data:
        return
    W, D = plant["size"]["w"], plant["size"]["d"]
    by_kind = {}
    for z in plant["zones"]:
        by_kind.setdefault(z["kind"], []).append(z)
    nums = _numbers(t)
    placed = []
    for item in data.get("zonas") or []:
        kind = item.get("tipo")
        if kind not in ZONE or not (ZONE[kind]["keywords"] and _mentioned(t, *ZONE[kind]["keywords"])):
            continue
        z = (by_kind.get(kind) or [None]).pop(0) if by_kind.get(kind) else None
        if z is None:
            z = {"id": f"z{len(plant['zones']) + 1}", "name": ZONE[kind]["name"], "kind": kind, "w": ZONE[kind]["w"], "d": ZONE[kind]["d"], "x": 0, "z": 0}
            plant["zones"].append(z)
        w, d = item.get("ancho_m"), item.get("fondo_m")
        if isinstance(w, (int, float)) and isinstance(d, (int, float)) and w in nums and d in nums and 1 <= w <= W and 1 <= d <= D:
            z["w"], z["d"] = float(w), float(d)
        pt = _region_point(item.get("ubicacion"), W, D, z["w"], z["d"])
        if pt:
            taken = [zone_rect(q) for q in plant["zones"] if q is not z and q.get("_placed")]
            z["x"], z["z"] = _fit_zone(plant, z, pt, taken)
            z["_placed"] = True
            placed.append(f"{z['name'].lower()} ({item['ubicacion'].replace('-', ' ')})")
    if placed:
        notes.append("Zonas ubicadas según tu historia: " + ", ".join(placed) + ".")


def station_targets(plant, t, data):
    """Punto preferido de cada estación según el agente de acomodo."""
    if not data:
        return {}, {}
    W, D = plant["size"]["w"], plant["size"]["d"]
    st = {s["id"]: s for s in plant["stations"]}
    targets = {}
    near = {}
    for item in data.get("estaciones") or []:
        sid = _match(str(item.get("nombre", "")), plant["stations"])
        if not sid:
            continue
        region = item.get("ubicacion")
        # La región solo cuenta si la historia la dice en la misma oración que nombra a la estación.
        if region in REGIONS and _together(t, _station_words(st[sid]), _region_words(region)):
            pt = _region_point(region, W, D, st[sid]["w"], st[sid]["d"])
            if pt:
                targets[sid] = pt
        other = _match(str(item.get("junto_a", "")), plant["stations"]) if item.get("junto_a") else None
        if other and other != sid and _together(t, _station_words(st[sid]), NEAR_WORDS) and _together(t, _station_words(st[other]), NEAR_WORDS):
            near[sid] = other
    return targets, near


def place_with_targets(plant, targets, near):
    """Coloca primero las estaciones con lugar indicado, luego las que van junto a otra, y al final las demás."""
    st = station_map(plant)
    positions = plant["layout"]
    placed, fixed = [], {}
    for sid in list(targets) + [sid for sid in near if sid not in targets]:
        if sid in targets:
            target = targets[sid]
        else:
            other = near[sid]
            p = fixed.get(other) or positions.get(other)
            if not p:
                continue
            target = (p[0] + (st[other]["w"] + st[sid]["w"]) / 2 + 1.2, p[1])
        pos, r = nearest_free(plant, st[sid], target, placed)
        fixed[sid] = pos
        placed.append(r)
    # Las demás se quedan donde las puso el acomodo inicial, o en el lugar libre más cercano.
    for s in plant["stations"]:
        if s["id"] in fixed:
            continue
        cur = positions.get(s["id"]) or (plant["size"]["w"] / 2, plant["size"]["d"] / 2)
        pos, r = nearest_free(plant, s, (cur[0], cur[1]), placed, cur[2] if len(cur) > 2 else 0)
        fixed[s["id"]] = pos
        placed.append(r)
    return fixed


def apply_walls(plant, t, data, notes):
    if not data or not _mentioned(t, "pared", "muro", "tabique", "division", "dividid", "separad", "cuarto"):
        return
    W, D = plant["size"]["w"], plant["size"]["d"]
    made = []
    for i, item in enumerate((data.get("paredes") or [])[:6]):
        divide = item.get("divide")
        if divide in ("a lo ancho", "a lo largo") and _together(t, ("divid", "division", "parte la"), ("pared", "muro", "tabique", "bodega", "planta", "nave")):
            # Muro de lado a lado con un paso de 4 m en el centro para el material.
            if divide == "a lo ancho":
                z = round(D / 2 * 2) / 2
                plant["walls"] += [{"id": f"w{i}a", "x1": 0, "z1": z, "x2": W / 2 - 2, "z2": z}, {"id": f"w{i}b", "x1": W / 2 + 2, "z1": z, "x2": W, "z2": z}]
            else:
                x = round(W / 2 * 2) / 2
                plant["walls"] += [{"id": f"w{i}a", "x1": x, "z1": 0, "x2": x, "z2": D / 2 - 2}, {"id": f"w{i}b", "x1": x, "z1": D / 2 + 2, "x2": x, "z2": D}]
            made.append(f"una división {divide} con paso al centro")
            continue
        name = normalize(str(item.get("encierra", "")))
        if not name:
            continue
        zone = next((z for z in plant["zones"] if normalize(z["name"]) in name or name in normalize(z["name"]) or z["kind"] in name), None)
        if zone and _together(t, ZONE[zone["kind"]]["keywords"] + _stems_of(zone["name"]), WALL_WORDS):
            made.append(f"muros alrededor de {zone['name'].lower()}")
            plant["walls"] += _enclose(zone["x"] - zone["w"] / 2, zone["z"] - zone["d"] / 2, zone["x"] + zone["w"] / 2, zone["z"] + zone["d"] / 2, W, D, f"w{i}", poly=outline(plant))
            continue
        if zone:
            continue
        sid = _match(name, plant["stations"])
        s = next((x for x in plant["stations"] if x["id"] == sid), None)
        if s and sid in plant["layout"] and _together(t, _station_words(s), WALL_WORDS):
            x0, z0, x1, z1 = rect_at(s, plant["layout"][sid])
            m = 0.8
            made.append(f"un cuarto para {s['name'].lower()}")
            plant["walls"] += _enclose(x0 - m, z0 - m, x1 + m, z1 + m, W, D, f"w{i}", door=2.0, poly=outline(plant))
    if made:
        notes.append("Paredes agregadas: " + ", ".join(made) + ".")


def _enclose(x0, z0, x1, z1, W, D, prefix, door=1.2, poly=None):
    """Muros en los lados de un rectángulo que no tocan la bodega, con una puerta en el lado más largo hacia adentro.
    Un lado pegado al contorno (también el de una L o una U) ya es muro: no se duplica."""
    from .engine import seg_dist

    x0, z0, x1, z1 = max(0, x0), max(0, z0), min(W, x1), min(D, z1)
    edges = [(a, poly[(k + 1) % len(poly)]) for k, a in enumerate(poly)] if poly else [((0, 0), (W, 0)), ((W, 0), (W, D)), ((W, D), (0, D)), ((0, D), (0, 0))]

    def on_outline(a, b, c, d):
        mx, mz = (a + c) / 2, (b + d) / 2
        return any(seg_dist(mx, mz, p[0], p[1], q[0], q[1]) < 0.9 for p, q in edges)

    sides = []
    for name, seg in (("top", (x0, z0, x1, z0)), ("bottom", (x0, z1, x1, z1)), ("left", (x0, z0, x0, z1)), ("right", (x1, z0, x1, z1))):
        if not on_outline(*seg):
            sides.append((name, seg))
    if not sides:
        return []
    # La puerta va en el lado interior más largo.
    door_side = max(sides, key=lambda s: math.hypot(s[1][2] - s[1][0], s[1][3] - s[1][1]))[0]
    walls = []
    for k, (name, (a, b, c, d)) in enumerate(sides):
        if name == door_side:
            mx, mz = (a + c) / 2, (b + d) / 2
            if a == c:
                walls.append((a, b, a, mz - door / 2))
                walls.append((a, mz + door / 2, a, d))
            else:
                walls.append((a, b, mx - door / 2, b))
                walls.append((mx + door / 2, b, c, b))
        else:
            walls.append((a, b, c, d))
    return [{"id": f"{prefix}_{j}", "x1": round(a * 2) / 2, "z1": round(b * 2) / 2, "x2": round(c * 2) / 2, "z2": round(d * 2) / 2} for j, (a, b, c, d) in enumerate(walls) if math.hypot(c - a, d - b) >= 0.5]
