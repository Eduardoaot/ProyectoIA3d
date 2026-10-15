from __future__ import annotations

import math
import re
import unicodedata

from .catalog import ASSUMPTIONS, DEFAULT_PARAMS, KIND, ZONE
from .layout import EDGE, flow_order, initial_layout

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
                    "tipo": {"type": "string", "enum": KIND_IDS},
                    "minutos_por_pieza": {"type": "number"},
                    "operarios": {"type": "integer"},
                },
                "required": ["nombre", "tipo"],
            },
        },
        "flujo": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"de": {"type": "string"}, "a": {"type": "string"}, "porcentaje": {"type": "number"}},
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

STORY_SYSTEM = (
    "Eres un extractor de datos. Lees la historia de una planta o taller y devuelves SOLO un objeto JSON "
    "con el esquema indicado. No conversas, no saludas, no explicas fuera del JSON.\n"
    "Reglas:\n"
    "- 'estaciones': cada máquina, proceso o área por donde pasa el material, en el orden en que pasa. "
    "Usa las palabras de la persona para el nombre (corto, con mayúscula inicial). "
    "No inventes estaciones que la historia no menciona. La oficina, los baños, los portones y los carros NO son estaciones.\n"
    "- 'tipo': el más parecido de la lista. Si ninguno se parece, usa 'otro'.\n"
    "- 'flujo': de qué estación a cuál pasa el material, con los mismos nombres de 'estaciones'. "
    "'porcentaje' es 100 si pasan todas las piezas; si solo algunas, el porcentaje que se intuya.\n"
    "- Números escritos con letra conviértelos a cifra. Si un número no aparece, pon 0.\n"
    "- 'produccion' y 'periodo': cuánto se producía y si era por día, semana o mes.\n"
    "- 'minutos_por_pieza': si no se dice, estima un valor razonable para ese proceso.\n"
    "- 'supuestos': frases cortas en español con lo que tuviste que suponer.\n"
    "- 'problemas': desorden o desperdicio que se intuye en la historia."
)

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
        m = normalize(s["name"])
        if n and (n in m or m in n):
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
    if kind != "otro":
        hits += [m.start() for w in KIND[kind]["keywords"] for m in [re.search(WORD_START + re.escape(w), t)] if m]
    return min(hits) if hits else None


def _nice(name):
    name = re.sub(r"\s+", " ", str(name)).strip()[:40]
    return name[:1].upper() + name[1:].lower() if name.isupper() else name[:1].upper() + name[1:]


def _station(i, name, kind, t=None, ops=None):
    k = KIND[kind]
    ok_t = isinstance(t, (int, float)) and 0 < t < 600
    return {
        "id": _uid("s", i), "name": name, "kind": kind, "w": k["w"], "d": k["d"],
        "t": float(t) if ok_t else k["t"],
        "ops": int(ops) if isinstance(ops, int) and 0 <= ops < 50 else k["ops"],
        "t_source": "ia" if ok_t else "supuesto",
    }


def build_plant(text: str, ai: dict | None) -> dict:
    rules = by_rules(text)
    t = words_to_digits(normalize(text))
    ai = ai or {}
    facts = []
    notes = []
    dropped = []

    # --- Estaciones de la IA, solo si la historia las menciona ---
    zone_kw = [(zid, w[:6]) for zid, z in ZONE.items() for w in z["keywords"]]
    found = []  # (posición en el texto, nombre, tipo, minutos, operarios)
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
        found.append((pos, name, kind, x.get("minutos_por_pieza"), x.get("operarios")))
    source = "ia" if found else "reglas"

    # --- Lo que las reglas encontraron y la IA no ---
    added = False
    covered = {f[2] for f in found}
    names_norm = " ".join(normalize(f[1]) for f in found)
    for kid in rules["kinds"]:
        if kid in covered or any(w[:4] in names_norm for w in KIND[kid]["keywords"] if len(w) >= 4):
            continue
        pos = _where(KIND[kid]["name"], kid, t)
        found.append((pos if pos is not None else len(t), KIND[kid]["name"], kid, None, None))
        added = True
    # Lo que entra va primero y lo que sale al final; lo demás en el orden en que se cuenta.
    found.sort(key=lambda f: (f[2] != "recepcion", f[2] == "despacho", f[0]))
    stations = [_station(i, f[1], f[2], f[3], f[4]) for i, f in enumerate(found)]
    if dropped:
        notes.append("No incluí lo que la historia no menciona: " + ", ".join(dropped) + ".")
    # Sin nada reconocible, una sola caja genérica para empezar a dibujar.
    if not stations:
        stations.append(_station(0, "Proceso 1", "otro", None, 1))

    # --- Flujo: el de la IA si es coherente; si no, en el orden de la historia ---
    order = {s["id"]: i for i, s in enumerate(stations)}
    routes = []
    if not added:
        for x in ai.get("flujo", []) or []:
            if not isinstance(x, dict):
                continue
            a, b = _match(str(x.get("de", "")), stations), _match(str(x.get("a", "")), stations)
            # Una ruta que regresa a una estación anterior casi siempre es un error de lectura.
            if a and b and order[a] < order[b] and not any(r["from"] == a and r["to"] == b for r in routes):
                pct = x.get("porcentaje")
                frac = pct / 100 if isinstance(pct, (int, float)) and 0 < pct <= 100 else 1.0
                routes.append({"id": f"r{len(routes) + 1}", "from": a, "to": b, "frac": round(frac, 2)})
    connected = {r["from"] for r in routes} | {r["to"] for r in routes}
    prev = None
    for s in stations:
        if s["id"] not in connected and prev:
            routes.append({"id": f"r{len(routes) + 1}", "from": prev, "to": s["id"], "frac": 1.0})
        prev = s["id"]
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
        assumptions.append({"key": key, "label": label, "unit": unit, "why": "Tomado de tu historia." if val else why, "value": p[key], "source": val[2] if val else "supuesto"})

    # --- Bodega, portones y acomodo inicial ---
    area = sum(s["w"] * s["d"] for s in stations) + sum(ZONE[k]["w"] * ZONE[k]["d"] for k, _ in zkinds)
    total = max(area * 3.2, 300)
    D = max(14, math.ceil(math.sqrt(total / 2) / 2) * 2)
    W = max(24, math.ceil(total / D / 2) * 2)
    zones = []
    x = W - EDGE
    for i, (k, name) in enumerate(zkinds):
        z = ZONE[k]
        zones.append({"id": f"z{i + 1}", "name": name, "kind": k, "x": round(x - z["w"] / 2, 1), "z": round(D - EDGE - z["d"] / 2, 1), "w": z["w"], "d": z["d"]})
        x -= z["w"] + 1

    plant = {
        "name": str(ai.get("negocio") or "Mi planta").strip()[:60],
        "industry": str(ai.get("producto") or "").strip()[:60],
        "size": {"w": W, "d": D},
        "gates": [{"id": "A", "x": round(W * 0.15), "label": "Portón A"}, {"id": "B", "x": round(W * 0.45), "label": "Portón B"}],
        "receive_gate": "A",
        "dispatch_gate": "B",
        "stations": stations,
        "zones": zones,
        "walls": [],
        "routes": routes,
        "use_assumptions": False,
        "params": p,
        "layout": {},
    }
    plant["layout"] = initial_layout(plant)
    # El acomodo inicial sigue el flujo; se guarda en ese orden.
    order = {sid: i for i, sid in enumerate(flow_order(plant))}
    plant["stations"].sort(key=lambda s: order.get(s["id"], 0))

    ai_notes = [str(x) for x in ai.get("problemas", []) or [] if str(x).strip()]
    return {
        "plant": plant,
        "assumptions": assumptions,
        "source": source,
        "notes": ai_notes + notes,
        "ai_assumptions": [str(x) for x in ai.get("supuestos", []) or [] if str(x).strip()],
        "rules": rules,
    }
