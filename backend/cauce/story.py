"""De la historia contada a una planta editable.

Lecturas que se combinan:
- Reglas: palabras clave del catálogo, números (también escritos con letra) y
  producción por día, semana o mes.
- IA extractora: devuelve únicamente el JSON de STORY_SCHEMA. No conversa.
- Agentes espaciales (agents.py), solo si la historia describe el espacio:
  forma y portones, zonas, lugar de cada estación y paredes.

Nada se impone: si la historia no menciona una máquina, no aparece.
"""

from __future__ import annotations

import math
import re
import unicodedata

from .catalog import ASSUMPTIONS, DEFAULT_PARAMS, KIND, ZONE
from . import site, spec, units
from .agents import prompt
from .agents import apply_building, apply_walls, apply_zones, fit_zones, place_with_targets, station_targets
from .engine import gate_pt
from .layout import EDGE, collisions, flow_order, initial_layout

KIND_IDS = list(KIND)


STORY_SCHEMA = {
    "type": "object",
    "properties": {
        "negocio": {"type": "string"},
        "producto": {"type": "string"},
        "estaciones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "nombre": {"type": "string"},
                    "cantidad": {"type": "integer"},
                    "tipo": {"type": "string", "enum": KIND_IDS},
                    "minutos_por_pieza": {"type": "number"},
                    "operarios": {"type": "integer"},
                    "ancho_m": {"type": "number"},
                    "largo_m": {"type": "number"},
                },
                "required": ["nombre", "tipo"],
            },
        },
        "flujo": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"de": {"type": "string"}, "a": {"type": "string"}, "porcentaje": {"type": "number"}, "retorno": {"type": "boolean"}},
                "required": ["de", "a"],
            },
        },
        "operarios": {"type": "integer"},
        "produccion": {"type": "number"},
        "periodo": {"type": "string", "enum": ["dia", "semana", "mes", "desconocido"]},
        "camiones_al_dia": {"type": "number"},
        "problemas": {"type": "array", "items": {"type": "string"}},
        "supuestos": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["negocio", "estaciones", "flujo", "supuestos"],
}

STORY_SYSTEM = prompt("extractor")  # agents/extractor.md

# Respaldo por si el modelo escribe en primera persona: las notas describen el análisis, no a la IA.
FIRST_PERSON = [
    (r"\b(supuse|asumí|asumo|supongo)\b", "se supone"),
    (r"\b(estimé|estimo|calculé|calculo)\b", "se estima"),
    (r"\b(considero|creo|pienso)\b", "se considera"),
    (r"\bno (encontré|vi|veo|encuentro)\b", "no se encontró"),
    (r"\b(encontré|noté|observé|detecté|veo|vi)\b", "se observa"),
    (r"\b(agrupé|junté|coloqué|ubiqué|puse)\b", "se ubicó"),
    (r"\b(recomiendo|sugiero|propongo)\b", "se recomienda"),
]


def impersonal(text: str) -> str:
    s = str(text).strip()
    for pat, rep in FIRST_PERSON:
        s = re.sub(pat, rep, s, flags=re.IGNORECASE)
    return s[:1].upper() + s[1:]


NUM_WORDS = {
    "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
    "nueve": 9, "diez": 10, "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16,
    "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veinticinco": 25, "treinta": 30,
    "cuarenta": 40, "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80, "noventa": 90, "cien": 100,
    "ciento": 100, "doscientos": 200, "trescientos": 300, "quinientos": 500, "mil": 1000, "docena": 12,
}

PEOPLE = r"(operari|trabajador|persona|empleado|obrero|costurer|soldador|ayudante)"
VEHICLES = r"(camion|camioneta|ruta|entrega|envio|viaje|salida|furgon)"
PERIOD = r"(al dia|diari\w*|por dia|cada dia|a la semana|por semana|semanal\w*|cada semana|al mes|por mes|mensual\w*|cada mes)"


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def words_to_digits(t: str) -> str:
    t = re.sub(r"\bmedia docena\b", "6", t)
    return re.sub(r"\b(" + "|".join(sorted(NUM_WORDS, key=len, reverse=True)) + r")\b", lambda m: str(NUM_WORDS[m.group(1)]), t)


WORD_START = r"(?<![a-z])"
DIMENSIONS_AFTER_MENTION = re.compile(
    r"^[a-z]*(?:\s+(?:de|del)\s+(?!\d)[a-z]+)?[\s(,:-]*(?:(?:con\s+dimensiones?\s+de|dimensiones?\s+de|area\s+de|de|mide|es|tiene|con|que\s+mide)\s*)?"
    r"(?P<w>\d+(?:[.,]\d+)?)\s*(?:(?:cm|mm|m(?:etros?)?)\s*)?(?:x|×|por)\s*"
    r"(?P<d>\d+(?:[.,]\d+)?)\s*(?P<u>cm|mm|centimetros?|milimetros?|m(?:etros?)?)?"
)


def _dims_of(match):
    """Medidas de una mención, en metros (también si se escribieron en cm o mm)."""
    w = site.to_m(float(match.group("w").replace(",", ".")), match.group("u"))
    d = site.to_m(float(match.group("d").replace(",", ".")), match.group("u"))
    return (w, d) if w > 0 and d > 0 else None
def _zone_instances(text: str, zone_id: str) -> list[tuple[str, float, float]]:
    """Devuelve una instancia por mención del primer nombre detectado para la zona."""
    keywords = ZONE[zone_id]["keywords"]
    mentions = [
        (match.start(), keyword, match.end())
        for keyword in keywords
        for match in re.finditer(WORD_START + re.escape(keyword) + r"(?:s|es)?", text)
    ]
    if not mentions:
        return []

    _, keyword, _ = min(mentions, key=lambda item: (item[0], -len(item[1])))
    instances = []
    for mention in re.finditer(WORD_START + re.escape(keyword) + r"(?:s|es)?", text):
        match = DIMENSIONS_AFTER_MENTION.match(text[mention.end():mention.end() + 64])
        dimensions = _dims_of(match) if match else None
        width, depth = dimensions or (ZONE[zone_id]["w"], ZONE[zone_id]["d"])
        instances.append((ZONE[zone_id]["name"], width, depth))
    return instances


def _station_instances(text: str, kind: str) -> list[tuple[int, tuple[float, float] | None]]:
    """Devuelve cada mención de una estación y las medidas asociadas a esa mención."""
    mentions = {}
    for keyword in KIND[kind]["keywords"]:
        for mention in re.finditer(WORD_START + re.escape(keyword), text):
            mentions[mention.start()] = mention

    instances = []
    for mention in sorted(mentions.values(), key=lambda item: item.start()):
        match = DIMENSIONS_AFTER_MENTION.match(text[mention.end():mention.end() + 64])
        instances.append((mention.start(), _dims_of(match) if match else None))
    return instances


def by_rules(text: str) -> dict:
    t = words_to_digits(normalize(text))
    found = []
    for kid, k in KIND.items():
        # La palabra clave debe empezar una palabra: "carpinteria" no es "pint".
        hits = [m.start() for w in k["keywords"] for m in [re.search(WORD_START + re.escape(w), t)] if m]
        if hits:
            found.append((min(hits), kid))
    # Lo que entra va primero y lo que sale al final, se mencione donde se mencione.
    found.sort(key=lambda f: (f[1] != "recepcion", f[1] == "despacho", f[0]))
    zones = [zid for zid, z in ZONE.items() if any(re.search(WORD_START + re.escape(w), t) for w in z["keywords"])]

    ops = re.search(r"(\d+)\s+(?:[a-z]+\s+){0,2}?" + PEOPLE, t) or re.search(r"(?:eramos|somos|eran|son)\s+(?:como\s+|unos?\s+|unas?\s+)?(\d+)", t)
    trucks = re.search(r"(\d+)\s+(?:[a-z]+\s+){0,1}?" + VEHICLES, t)
    prod, period = None, None
    for m in re.finditer(r"(\d+(?:[.,]\d+)?)\s+((?:[a-z]+\s+){0,4}?)" + PERIOD, t):
        if re.search(PEOPLE, m.group(2)) or re.search(VEHICLES, m.group(2)):
            continue
        if float(m.group(1).replace(",", ".")) < 2:
            continue
        prod = float(m.group(1).replace(",", "."))
        p = m.group(3)
        period = "semana" if "semana" in p else "mes" if ("mes" in p and "semana" not in p) else "dia"
        break
    if prod is None:
        m = re.search(r"(\d+)\s+(pieza|unidad|vidrio|producto)", t)
        if m and int(m.group(1)) >= 2:
            prod, period = float(m.group(1)), "dia"
    return {
        "kinds": [k for _, k in found],
        "zones": zones,
        "operarios": int(ops.group(1)) if ops else 0,
        "produccion": prod or 0,
        "periodo": period or "desconocido",
        "camiones_al_dia": int(trucks.group(1)) if trucks else 0,
    }


def per_day(value, period):
    if not value:
        return 0, None
    if period == "semana":
        return round(value / 5, 2), f"{value:g} por semana son {value / 5:.1f} al día (5 días laborables)."
    if period == "mes":
        return round(value / 22, 2), f"{value:g} al mes son {value / 22:.1f} al día (22 días laborables)."
    return value, None


def _kind_from_name(name: str) -> str:
    n = normalize(name)
    for kid, k in KIND.items():
        if any(re.search(WORD_START + re.escape(w), n) for w in k["keywords"]):
            return kid
    return "otro"


def _uid(prefix, i):
    return f"{prefix}{i + 1}"


def _match(name, stations):
    n = normalize(name).strip()
    for s in stations:
        if normalize(s["name"]).strip() == n:
            return s["id"]
    for s in stations:
        if s["id"].lower() == n:
            return s["id"]

    def inside(a, b):
        # "maquina 1" no es parte de "maquina 10": se compara por palabras completas.
        return bool(a) and re.search(r"(?<![a-z0-9])" + re.escape(a) + r"(?![a-z0-9])", b) is not None

    for s in stations:
        m = normalize(s["name"])
        if n and (inside(n, m) or inside(m, n)):
            return s["id"]
    return None


STOP = {"de", "del", "la", "las", "el", "los", "con", "en", "para", "por", "una", "uno", "area", "zona", "proceso", "estacion", "maquina"}
# Lo que la IA a veces confunde con estaciones: no son procesos.
NOT_STATION = ("porton", "puerta", "carro", "carretilla", "calle", "pasillo", "patio")


def _stems(name):
    return [w[: max(4, len(w) - 3)] for w in re.findall(r"[a-z]+", normalize(name)) if len(w) >= 4 and w not in STOP]


def _where(name, kind, t):
    """Dónde se menciona en la historia (posición) o None si no aparece."""
    hits = [m.start() for st in _stems(name) for m in [re.search(WORD_START + re.escape(st), t)] if m]
    # Nombres con número o código ("Máquina 3", "M1"): el nombre completo, como palabra.
    full = re.search(WORD_START + re.escape(words_to_digits(normalize(name)).strip()) + r"(?![a-z0-9])", t)
    if full:
        hits.append(full.start())
    if kind != "otro":
        hits += [m.start() for w in KIND[kind]["keywords"] for m in [re.search(WORD_START + re.escape(w), t)] if m]
    return min(hits) if hits else None


def _nice(name):
    name = re.sub(r"\s+", " ", str(name)).strip()[:40]
    return name[:1].upper() + name[1:].lower() if name.isupper() else name[:1].upper() + name[1:]


def _station(i, name, kind, t=None, ops=None, dimensions=None):
    k = KIND[kind]
    ok_t = isinstance(t, (int, float)) and 0 < t < 600
    w, d = dimensions or (k["w"], k["d"])
    return {
        "id": _uid("s", i), "name": name, "kind": kind, "w": w, "d": d,
        "t": float(t) if ok_t else k["t"],
        "ops": int(ops) if isinstance(ops, int) and 0 <= ops < 50 else k["ops"],
        "t_source": "ia" if ok_t else "supuesto",
    }


WEAK = {"recepcion": r"recep|materias? primas?|almacen de entrada", "despacho": r"despach|embarque|area de salida", "mesa": r"mesa de trabajo|banco de trabajo"}
PROBLEM_WORDS = r"problem|falla|retras|demora|desperdic|desorden|cuello de botella|se acumul|amontona|cruce|se pierde|perdemos|tarda demasiado|queja|retrabaj|defect|merma|rechaz|paro|cuesta trabajo"
RETURN_WORDS = r"regres|vuelve|devuelv|retrabaj|reproces|repite|se rehace|otra vez"


def _ai_dims(x, t):
    """Medidas que dio la IA para una estación, solo si las dos cifras están en el texto."""
    w, d = x.get("ancho_m"), x.get("largo_m")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0.2 <= v <= 200 for v in (w, d)):
        return None
    nums = {float(n.replace(",", ".")) for n in re.findall(r"\d+(?:[.,]\d+)?", t)}
    return (float(w), float(d)) if float(w) in nums and float(d) in nums else None


def _reaches(routes, a, b):
    """¿Se llega de a hasta b siguiendo las rutas?"""
    seen, stack = set(), [a]
    while stack:
        k = stack.pop()
        if k == b:
            return True
        if k in seen:
            continue
        seen.add(k)
        stack += [r["to"] for r in routes if r["from"] == k]
    return False


def _name_of(stations, sid):
    return next((s["name"] for s in stations if s["id"] == sid), sid)


def _fit_issues(plant):
    """Estaciones que no caben en el recinto o que quedaron encimadas: se informa, no se encogen."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    out = [f"{s['name']} ({s['w']:g} x {s['d']:g} m) no cabe en el recinto de {W:g} x {D:g} m." for s in plant["stations"] if min(s["w"], s["d"]) > min(W, D) or max(s["w"], s["d"]) > max(W, D)]
    bad = collisions(plant, plant["layout"])
    if bad:
        names = ", ".join(sorted(s["name"] for s in plant["stations"] if s["id"] in bad))
        out.append(f"No hubo lugar libre para {names}: quedaron encimadas; conviene moverlas o agrandar el recinto.")
    return out


def place_zones_default(plant, zone_instances):
    """Zonas en fila contra el frente derecho, como punto de partida.

    Cada instancia es (tipo, nombre, ancho, fondo): una por mención en la historia."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    zones = []
    x = W - EDGE
    for i, (kind, name, w, d) in enumerate(zone_instances):
        if sum(1 for item in zone_instances if item[0] == kind) > 1:
            name = f"{name} {sum(1 for item in zone_instances[:i] if item[0] == kind) + 1}"
        zones.append({"id": f"z{i + 1}", "name": name, "kind": kind, "x": round(x - w / 2, 1), "z": round(D - EDGE - d / 2, 1), "w": w, "d": d})
        x -= w + 1
    return zones


def build_plant(text: str, ai: dict | None, spatial: dict | None = None) -> dict:
    t = words_to_digits(normalize(text))
    # El edificio ("un almacén rectangular de 60 x 40") no es una estación: se lee como recinto.
    t = site.mask(t, site.facility_spans(t))
    rules = by_rules(t)
    ai = ai or {}
    facts = []
    notes = []
    issues = []
    dropped = []

    # --- Estaciones de la IA, solo si la historia las menciona ---
    zone_kw = [(zid, w[:6]) for zid, z in ZONE.items() for w in z["keywords"]]
    found = []  # (posición en el texto, nombre, tipo, minutos, operarios)
    qty = {}  # nombre normalizado -> máquinas iguales que dijo la IA
    for x in ai.get("estaciones", []) or []:
        if not isinstance(x, dict) or not str(x.get("nombre", "")).strip():
            continue
        name = _nice(x["nombre"])
        n = normalize(name)
        if any(re.search(WORD_START + w, n) for w in NOT_STATION) or any(w in n for _, w in zone_kw):
            continue
        kind = _kind_from_name(name)
        if kind == "otro" and x.get("tipo") in KIND:
            kind = x["tipo"]
        pos = _where(name, kind, t)
        if pos is None:
            dropped.append(name)
            continue
        if any(normalize(f[1]) == n for f in found):
            continue
        found.append((pos, name, kind, x.get("minutos_por_pieza"), x.get("operarios"), _ai_dims(x, t)))
        if isinstance(x.get("cantidad"), int) and x["cantidad"] > 1:
            qty[n] = x["cantidad"]
    source = "ia" if found else "reglas"

    # --- Lo que las reglas encontraron y la IA no ---
    covered = {f[2] for f in found}
    names_norm = " ".join(normalize(f[1]) for f in found)
    for kid in rules["kinds"]:
        if kid in covered or any(w[:4] in names_norm for w in KIND[kid]["keywords"] if len(w) >= 4):
            continue
        # "llega", "a mano" o "camión" no bastan para inventar una recepción, una mesa o un despacho
        # cuando la IA ya leyó las estaciones: hace falta el nombre del área.
        if found and kid in WEAK and not re.search(WEAK[kid], t):
            continue
        # Con varias estaciones ya leídas por la IA, una palabra relacionada («barniz», «pruebas»,
        # «materia prima») no basta para agregar un área genérica: el texto debe nombrar esa área.
        if len(found) >= 3 and not re.search(WORD_START + max(normalize(KIND[kid]["name"]).split(), key=len)[:5], t):
            continue
        pos = _where(KIND[kid]["name"], kid, t)
        found.append((pos if pos is not None else len(t), KIND[kid]["name"], kid, None, None, None))
    # Lo que entra va primero y lo que sale al final; lo demás en el orden en que se cuenta.
    found.sort(key=lambda f: (f[2] != "recepcion", f[2] == "despacho", f[0]))
    station_entries = []
    for kind in KIND:
        entries = sorted((entry for entry in found if entry[2] == kind), key=lambda entry: entry[0])
        mentions = _station_instances(t, kind)
        if not entries and found:
            # Con estaciones de la IA, una palabra suelta solo crea estación si trae sus medidas.
            mentions = [m for m in mentions if m[1]]
        if not entries and not mentions:
            continue

        # Repetir una palabra no crea otra máquina: solo cuentan las menciones con medidas propias.
        mentions = [m for m in mentions if m[1]] or mentions[:1]
        count = max(len(entries), len(mentions))
        for i in range(count):
            ai_dims = None
            if i < len(entries):
                entry = entries[i]
                _, name, _, minutes, operators, ai_dims = entry
            else:
                name, minutes, operators = KIND[kind]["name"], None, None
            if i < len(mentions):
                position, dimensions = mentions[i]
            else:
                position, dimensions = entry[0], None
            # Las medidas escritas junto a la mención mandan; luego las de la IA si sus cifras están en el texto.
            dimensions = dimensions or ai_dims
            station_entries.append((position, name, kind, minutes, operators, dimensions))

    station_entries.sort(key=lambda entry: (entry[2] != "recepcion", entry[2] == "despacho", entry[0]))
    kind_counts = {kind: sum(entry[2] == kind for entry in station_entries) for kind in KIND}
    kind_indices = {kind: 0 for kind in KIND}
    stations = []
    for entry in station_entries:
        _, name, kind, minutes, operators, dimensions = entry
        kind_indices[kind] += 1
        if kind_counts[kind] > 1 and name == KIND[kind]["name"]:
            name = f"{name} {kind_indices[kind]}"
        stations.append(_station(len(stations), name, kind, minutes, operators, dimensions))
    # Máquinas iguales en paralelo (H2): solo si la cifra aparece en la historia.
    for st_ in stations:
        q = qty.get(normalize(st_["name"]))
        if q and re.search(rf"\b{q}\b", t):
            bw, bd = units.block_size(q, st_["w"], st_["d"], "bloque" if q > 4 else "fila")
            st_.update(count=q, unit_w=st_["w"], unit_d=st_["d"], arrangement="bloque" if q > 4 else "fila", w=bw, d=bd, ops=st_["ops"] * q)
            notes.append(f"{st_['name']}: {q} máquinas iguales en paralelo.")
        elif q:
            notes.append(f"Se descartó la cantidad de {st_['name']}: la cifra {q} no aparece en la descripción.")
    if dropped:
        notes.append("Se descartó lo que la descripción no menciona: " + ", ".join(dropped) + ".")
    # Sin nada reconocible, una sola caja genérica para empezar a dibujar.
    if not stations:
        stations.append(_station(0, "Proceso 1", "otro", None, 1))
    # Una lista con medidas ("- Máquina de corte M1: 4 x 3 m") manda: ni una estación más ni otras medidas.
    listed = spec.stations(text)
    if listed:
        stations = listed
        notes = [f"Estaciones tomadas de la lista del texto ({len(listed)}), con sus medidas exactas."]

    # --- Flujo: el de la IA si es coherente; si no, en el orden de la historia ---
    # Grafo del proceso: una estación puede alimentar a varias y recibir de varias (ramas y uniones).
    # Primero el flujo escrito en el texto ("A alimenta a B y a C"); si no lo hay, el de la IA.
    routes = spec.routes(text, stations) if listed else []
    if routes:
        notes.append(f"Flujo tomado del texto: {len(routes)} conexiones.")
    for x in [] if routes else ai.get("flujo", []) or []:
        if not isinstance(x, dict):
            continue
        a, b = _match(str(x.get("de", "")), stations), _match(str(x.get("a", "")), stations)
        if not a or not b or a == b or any(r["from"] == a and r["to"] == b for r in routes):
            continue
        pct = x.get("porcentaje")
        frac = pct / 100 if isinstance(pct, (int, float)) and 0 < pct <= 100 else 1.0
        # Un ciclo es un retorno (retrabajo) solo si la historia habla de regresar; si no, es un error de lectura.
        if _reaches(routes, b, a) or x.get("retorno") is True:
            if re.search(RETURN_WORDS, t):
                routes.append({"id": f"r{len(routes) + 1}", "from": a, "to": b, "frac": round(frac if frac < 1 else 0.1, 2), "is_return": True})
                notes.append(f"Retorno: {_name_of(stations, a)} → {_name_of(stations, b)} (retrabajo).")
            else:
                notes.append(f"Se descartó la ruta {_name_of(stations, a)} → {_name_of(stations, b)}: cerraba un ciclo.")
            continue
        routes.append({"id": f"r{len(routes) + 1}", "from": a, "to": b, "frac": round(frac, 2)})
    if not listed:
        # La historia leída oración por oración manda ("de ahí", "pero las que...", "regresa a");
        # la IA solo agrega conexiones de estaciones que la historia no conecta.
        told = spec.narrative_routes(text, stations)
        told_nodes = {r["from"] for r in told} | {r["to"] for r in told}
        if len(told_nodes) >= max(2, 0.6 * len(stations)):
            # Las notas de la primera lectura de la IA ya no aplican.
            notes = [x for x in notes if not x.startswith(("Retorno:", "Se descartó la ruta"))]
            extra = [r for r in routes if r["from"] not in told_nodes or r["to"] not in told_nodes]
            # Recepción y despacho que la historia no nombra van al inicio y al final del flujo contado.
            heads = [r["from"] for r in told if not r.get("is_return") and not any(q["to"] == r["from"] and not q.get("is_return") for q in told)]
            tails = [r["to"] for r in told if not r.get("is_return") and not any(q["from"] == r["to"] for q in told)]
            for s in stations:
                if s["id"] in told_nodes or any(s["id"] in (r["from"], r["to"]) for r in extra):
                    continue
                if s["kind"] == "recepcion" and heads:
                    extra.append({"from": s["id"], "to": heads[0], "frac": 1.0})
                elif s["kind"] == "despacho" and tails:
                    extra.append({"from": tails[-1], "to": s["id"], "frac": 1.0})
            routes = [{**r, "id": f"r{i + 1}", **({"frac": 0.1} if r.get("is_return") else {})} for i, r in enumerate(told + extra)]
            notes.append(f"Flujo leído de la historia ({len(told)} conexiones)" + (f"; la IA completó {len(extra)}." if extra else "."))
            for r in told:
                if r.get("is_return"):
                    notes.append(f"Retorno: {_name_of(stations, r['from'])} → {_name_of(stations, r['to'])} (retrabajo, 10 % supuesto).")
    connected = {r["from"] for r in routes} | {r["to"] for r in routes}
    # El flujo principal (sin retornos) es el que ordena; un retorno no conecta una estación.
    main = [r for r in routes if not r.get("is_return")]
    connected = {r["from"] for r in main} | {r["to"] for r in main}
    prev = None
    guessed = []
    for s in stations:
        if s["id"] not in connected and prev and routes:
            routes.append({"id": f"r{len(routes) + 1}", "from": prev, "to": s["id"], "frac": 1.0})
            guessed.append(s["name"])
        prev = s["id"]
    if guessed:
        notes.append("Sin flujo explícito para " + ", ".join(guessed) + ": se conectó en el orden de la descripción.")
    if not routes:
        for a, b in zip(stations, stations[1:]):
            routes.append({"id": f"r{len(routes) + 1}", "from": a["id"], "to": b["id"], "frac": 1.0})

    # --- Zonas: solo las que la historia menciona ---
    zkinds = [(zid, ZONE[zid]["name"]) for zid in rules["zones"]]

    # --- Números ---
    def pick(key, lo, hi):
        for src, val in (("historia", rules.get(key)), ("ia", ai.get(key))):
            if isinstance(val, (int, float)) and lo <= val <= hi:
                return val, src
        return None, None

    p = dict(DEFAULT_PARAMS)
    prod, src = pick("produccion", 0.1, 100000)
    if prod:
        period = rules["periodo"] if src == "historia" else ai.get("periodo", "dia")
        val, note = per_day(prod, period)
        p["demand"] = val
        facts.append(("demand", val, src))
        if note:
            notes.append(note)
    trucks, src = pick("camiones_al_dia", 1, 50)
    if trucks:
        p["trucks"] = trucks
        facts.append(("trucks", trucks, src))
    people, src = pick("operarios", 1, 500)
    if people:
        working = sorted([s for s in stations if s["t"] > 0], key=lambda s: -s["t"])
        for s in stations:
            s["ops"] = 0
        n = int(people)
        for s in working[:n]:
            s["ops"] = 1
        extra = n - min(n, len(working))
        i = 0
        while extra > 0 and working:
            working[i % len(working)]["ops"] += 1
            extra -= 1
            i += 1
        facts.append(("floor_ops", n, src))

    assumptions = []
    for key, label, unit, why, _ in ASSUMPTIONS:
        val = next((f for f in facts if f[0] == key), None)
        assumptions.append({"key": key, "label": label, "unit": unit, "why": "Tomado de la descripción." if val else why, "value": p[key], "source": val[2] if val else "supuesto"})

    # --- Bodega, portones y acomodo inicial ---
    zone_instances = [
        (kind, name, width, depth)
        for kind, _ in zkinds
        for name, width, depth in _zone_instances(t, kind)
    ]
    area = sum(s["w"] * s["d"] for s in stations) + sum(w * d for _, _, w, d in zone_instances)
    total = max(area * 3.2, 300)
    D = max(14, math.ceil(math.sqrt(total / 2) / 2) * 2)
    W = max(24, math.ceil(total / D / 2) * 2)
    W = max(W, math.ceil((sum(w for _, _, w, _ in zone_instances) + max(0, len(zone_instances) - 1) + 2 * EDGE) / 2) * 2)
    D = max(D, math.ceil((max((d for _, _, _, d in zone_instances), default=0) + 2 * EDGE) / 2) * 2)
    plant = {
        "name": str(ai.get("negocio") or "Mi planta").strip()[:60],
        "industry": str(ai.get("producto") or "").strip()[:60],
        "size": {"w": W, "d": D},
        "gates": [{"id": "A", "x": round(W * 0.15), "label": "Portón A"}, {"id": "B", "x": round(W * 0.45), "label": "Portón B"}],
        "receive_gate": "A",
        "dispatch_gate": "B",
        "stations": stations,
        "zones": [],
        "walls": [],
        "routes": routes,
        "use_assumptions": False,
        "params": p,
        "layout": {},
    }
    # --- Lectura espacial: cada agente aporta solo lo que la historia confirma ---
    spatial_notes = []
    used = []
    default_gates = plant["gates"]
    # Medidas, forma y portones escritos con cifras: mandan sobre lo que interprete la IA.
    explicit = site.apply_site(plant, t, spatial_notes, issues)
    if spatial:
        geometry = (plant["size"], plant.get("outline"))
        apply_building(plant, t, (spatial.get("edificio") or {}).get("data"), spatial_notes)
        if explicit:
            plant["size"], plant["outline"] = geometry
            if plant["outline"] is None:
                plant.pop("outline")
    gates_told = site.apply_gates(plant, t, spatial_notes, issues)
    if gates_told:
        # Los portones contados en el texto reemplazan a los que ubicó el agente.
        spatial_notes[:] = [x for x in spatial_notes if not x.startswith("Portones ubicados en")]
    if not gates_told:
        if plant["gates"] is default_gates:
            # Los de por defecto siguen a las medidas finales del recinto.
            for g, f in zip(plant["gates"], (0.15, 0.45)):
                g["x"], g["z"] = round(plant["size"]["w"] * f), plant["size"]["d"]
        # Los portones de la IA o los de por defecto quedan sobre el contorno real.
        for g in plant["gates"]:
            g["x"], g["z"] = (round(v, 2) for v in gate_pt(plant, g["id"], 0.0))
    plant["zones"] = place_zones_default(plant, zone_instances) + site.aisles(t, plant["size"]["w"], plant["size"]["d"], plant.get("_main"))
    if spatial:
        apply_zones(plant, t, (spatial.get("zonas") or {}).get("data"), spatial_notes)
        fit_zones(plant)
    plant["layout"] = initial_layout(plant)
    if spatial:
        targets, near = station_targets(plant, t, (spatial.get("acomodo") or {}).get("data"))
        if targets or near:
            plant["layout"] = place_with_targets(plant, targets, near)
            where = [s["name"] for s in plant["stations"] if s["id"] in targets or s["id"] in near]
            spatial_notes.append("Ubicación tomada de la descripción: " + ", ".join(where) + ".")
        apply_walls(plant, t, (spatial.get("paredes") or {}).get("data"), spatial_notes)
        used = [k for k, v in spatial.items() if v.get("data") is not None]
    outs, ins = {}, {}
    for r in plant["routes"]:
        outs[r["from"]] = outs.get(r["from"], 0) + 1
        ins[r["to"]] = ins.get(r["to"], 0) + 1
    branching = any(v > 1 for v in list(outs.values()) + list(ins.values()))
    if listed:
        spec.apply(plant, text, spatial_notes, issues, plant.get("_main"))
    else:
        fixed = spec.locks(text, plant["stations"], loose=True)
        for s in plant["stations"]:
            if s["id"] in fixed:
                s["locked"] = True
                s["lock_reason"] = "La descripción dice que no se mueve"
        if fixed:
            spatial_notes.append("Fijas según la descripción: " + ", ".join(s["name"] for s in plant["stations"] if s["id"] in fixed) + ".")
    if listed:
        pass
    elif branching and not (spatial and (spatial.get("acomodo") or {}).get("data")):
        # Con ramas, el acomodo por niveles las abre a los lados en vez de una fila.
        plant["layout"] = spec.flow_layout(plant, None, plant.get("_main"))
    plant.pop("_main", None)
    issues += site.check_gates(plant) + _fit_issues(plant)
    # El acomodo inicial sigue el flujo; se guarda en ese orden.
    order = {sid: i for i, sid in enumerate(flow_order(plant))}
    plant["stations"].sort(key=lambda s: order.get(s["id"], 0))

    # Los problemas de la IA solo se muestran si la historia habla de problemas; si no, el modelo
    # los inventa («fallas en el horno», «retrasos logísticos») y parecen hallazgos reales.
    ai_notes = [impersonal(x) for x in ai.get("problemas", []) or [] if str(x).strip()] if re.search(PROBLEM_WORDS, t) else []
    return {
        "plant": plant,
        "assumptions": assumptions,
        "source": source,
        "notes": ai_notes + notes + spatial_notes + issues,
        "issues": issues,
        "spatial": {"agents": used, "notes": spatial_notes},
        "ai_assumptions": [impersonal(x) for x in ai.get("supuestos", []) or [] if str(x).strip()],
        "rules": rules,
    }
