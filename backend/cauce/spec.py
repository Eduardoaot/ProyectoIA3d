"""Especificaciones escritas como lista: estaciones con medidas, flujo, fijos y lugares.

Cuando el texto trae una lista del tipo "- Máquina de corte M1: 4 × 3 m." esa lista es
la verdad: no se agregan estaciones por cada vez que se repite una palabra ("almacén")
ni se cambian sus medidas. El flujo ("A alimenta a B y a C", "B y C alimentan a D"), lo
que se pide fijar y el lugar pedido ("cerca de la esquina frontal izquierda") también se
leen con reglas. La IA solo completa lo que el texto no dice.

Acomodo por niveles del flujo: cada estación va en la columna de su nivel (la distancia
más larga desde el inicio del proceso), las ramas se abren a los dos lados del pasillo y
lo fijo se coloca primero en el lugar que pidió el texto.
"""

from __future__ import annotations

import re
import unicodedata

from .catalog import KIND
from .engine import dims, gate_pt, station_map
from .layout import EDGE, GAP, _rect, nearest_free
from . import site

ITEM = re.compile(
    r"^\s*(?:[-*•]|\d+[.)])?\s*(?P<name>[^\W\d_][^:\n(]{1,60}?)\s*(?::|\(|,\s*de|\s+de)\s*"
    r"(?P<w>\d+(?:[.,]\d+)?)\s*(?:m(?:etros?)?\s*)?(?:x|×|por)\s*(?P<d>\d+(?:[.,]\d+)?)\s*(?P<u>cm|mm|m(?:etros?)?)?\s*\)?\s*\.?\s*$",
    re.IGNORECASE | re.MULTILINE,
)
# Lo que se describe con medidas pero no es una estación.
NOT_ITEM = r"rectangular|cuadrad|forma de|poligon|recinto|rectangulo|ala\b|nave|edificio|bodega|planta\b|pasillo|porton|puerta|pared|muro|zona|oficina|bano|comedor|dimensiones del"
CODE = re.compile(r"(?<![A-Za-z0-9])([A-Z]{1,3}\d{1,3})(?![A-Za-z0-9])")
STOP = {"de", "del", "la", "las", "el", "los", "y", "en", "a", "al", "con", "para", "por"}


def _norm(s):
    t = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def _kind(name):
    from .story import _kind_from_name

    n = _norm(name)
    if re.search(r"terminad|producto final|despach|embarque", n):
        return "despacho"
    if re.search(r"materias? primas?|insumos|recepcion", n):
        return "recepcion"
    return _kind_from_name(name)


def stations(text):
    """Estaciones de una lista con medidas, en el orden del texto. [] si el texto no trae una lista así."""
    out = []
    for m in ITEM.finditer(text):
        name = re.sub(r"\s+", " ", m.group("name")).strip(" -*•")
        if re.search(NOT_ITEM, _norm(name)):
            continue
        w = site.to_m(float(m.group("w").replace(",", ".")), m.group("u"))
        d = site.to_m(float(m.group("d").replace(",", ".")), m.group("u"))
        if not (0.2 <= w <= 200 and 0.2 <= d <= 200):
            continue
        code = CODE.search(name)
        kind = _kind(name)
        k = KIND[kind]
        out.append({
            "id": f"s{len(out) + 1}", "name": name[:1].upper() + name[1:], "kind": kind, "w": w, "d": d,
            "t": k["t"], "ops": k["ops"], "t_source": "supuesto", **({"code": code.group(1)} if code else {}),
        })
    return out if len(out) >= 2 else []


def _words(name):
    return [w for w in re.findall(r"[a-z0-9]+", _norm(name)) if w not in STOP and len(w) > 1]


def mentions(sentence, sts, loose=False):
    """Estaciones que nombra una oración, en orden de aparición. Las que tienen código (M1) se nombran por él.
    Con loose basta casi todo el nombre ("la cepilladora" nombra a «Cepilladora CNC»)."""
    s = _norm(sentence)
    hits = []
    for st in sts:
        code = st.get("code")
        if code:
            m = re.search(r"(?<![a-z0-9])" + code.lower() + r"(?![0-9])", s)
            if m:
                hits.append((m.start(), st["id"]))
            continue
        ws = [w for w in _words(st["name"]) if w not in ("maquina", "estacion")]
        # Todas las palabras de su nombre, en una ventana corta de la oración.
        pos = [re.search(r"(?<![a-z])" + re.escape(w[: max(4, len(w) - 2)]), s) for w in ws]
        found = [p for p in pos if p]
        need = max(1, len(ws) - 1) if loose else len(ws)
        if ws and len(found) >= need and max(p.start() for p in found) - min(p.start() for p in found) < 40:
            hits.append((min(p.start() for p in found), st["id"]))
    return [sid for _, sid in sorted(hits)]


def sentences(t):
    return [x for x in re.split(r"(?<=[.;:])\s+|\n+", t) if x.strip()]


FLOW_VERB = re.compile(r"\b(?:alimenta|alimentan|abastece|abastecen|surte|surten|envia|envian|pasa|pasan|entrega|entregan|lleva|llevan|va|van|se conecta|se conectan|conecta|conectan|conectad[oa]s?|sigue|siguen)\b(?:\s+(?:tanto|directamente|despues|luego))?\s*(?:a|al|con|hacia|hasta)?\b")


def routes(text, sts):
    """Rutas del texto: "El almacén alimenta tanto a M1 como a M2", "M1 y M2 alimentan a M3"."""
    out = []
    for sen in sentences(text):
        m = FLOW_VERB.search(_norm(sen))
        if not m or re.search(r"\b(?:no|nunca|sin)\s+(?:se\s+)?(?:conect|aliment)", _norm(sen)):
            continue
        src, dst = mentions(sen[: m.start()], sts), mentions(sen[m.end():], sts)
        for a in src:
            for b in dst:
                if a != b and not any(r["from"] == a and r["to"] == b for r in out):
                    out.append({"id": f"r{len(out) + 1}", "from": a, "to": b, "frac": 1.0})
    return out


LOCK = re.compile(
    r"\bfij[ae]n?\b|\bfijalos?\b|\bno (?:muevas|mueva|muevan|rotes|rote|roten|gires|desplaces)\b|\bbloque[ae]\b|\bmanten\w* fij"
    r"|\banclad[oa]s?\b|\bempotrad[oa]s?\b|\bno se (?:puede|pueden) (?:mover|quitar)|\bno se mueven?\b|\besta(?:n)? fij[oa]s?\b"
)
FREE = re.compile(r"(?<!no )(?:puede(?:n)? (?:moverse|distribuirse|reubicarse)|se puede(?:n)? mover)|\blibre")


def locks(text, sts, loose=False):
    """Estaciones que el texto pide fijar. "Fija su posición" se refiere a la de la oración anterior."""
    out, prev = [], []
    for sen in sentences(text):
        here = mentions(sen, sts, loose)
        n = _norm(sen)
        if LOCK.search(n) and not FREE.search(n):
            ids = here or (prev if re.search(r"\bsus?\b|\blo\b|\bla\b", n) else [])
            out += [i for i in ids if i not in out]
        if here:
            prev = here
    return out


REGION_ROW = [("frente", r"frontal|frente|delanter"), ("fondo", r"posterior|fondo|traser")]
REGION_COL = [("izquierda", r"izquierd"), ("derecha", r"derech")]


def targets(text, sts):
    """Lugar pedido para una estación: "coloca el almacén cerca de la esquina frontal izquierda"."""
    out = {}
    for sen in sentences(text):
        n = _norm(sen)
        if not re.search(r"\b(?:coloca|ubica|pon|situa|cerca de|junto a|en la esquina|al fondo|al frente|a la izquierda|a la derecha)\b", n):
            continue
        here = mentions(sen, sts)
        if len(here) != 1:
            continue
        row = next((r for r, p in REGION_ROW if re.search(p, n)), "centro")
        col = next((c for c, p in REGION_COL if re.search(p, n)), "centro")
        if row == "centro" and col == "centro" and not re.search(r"\bcentro\b", n):
            continue
        out[here[0]] = "centro" if row == col == "centro" else f"{row}-{col}"
    return out


def _region_pt(region, box, w, d):
    x0, z0, x1, z1 = box
    row, _, col = region.partition("-")
    if region == "centro":
        row, col = "centro", "centro"
    fx = {"izquierda": 0.0, "centro": 0.5, "derecha": 1.0}[col or "centro"]
    fz = {"fondo": 0.0, "centro": 0.5, "frente": 1.0}[row]
    return (x0 + w / 2 + EDGE + fx * (x1 - x0 - w - 2 * EDGE), z0 + d / 2 + EDGE + fz * (z1 - z0 - d - 2 * EDGE))


def levels(plant):
    """Nivel de cada estación: el camino más largo desde una que no recibe nada."""
    ids = [s["id"] for s in plant["stations"]]
    ins = {k: [] for k in ids}
    for r in plant.get("routes", []):
        if r["from"] in ins and r["to"] in ins and not r.get("is_return"):
            ins[r["to"]].append(r["from"])
    lv = {}

    def depth(k, seen=()):
        if k in lv:
            return lv[k]
        if k in seen:
            return 0
        lv[k] = 0 if not ins[k] else 1 + max(depth(p, seen + (k,)) for p in ins[k])
        return lv[k]

    for k in ids:
        depth(k)
    return lv


def flow_layout(plant, want=None, main=None):
    """Acomodo por niveles del flujo dentro del cuerpo principal, respetando pasillos, zonas y forma.

    Una columna por nivel, de izquierda a derecha. Las estaciones de un nivel se apilan
    centradas en sus predecesoras (una rama sale en abanico y vuelve a juntarse), y una
    estación con un solo predecesor queda a su misma altura: la línea va recta.
    """
    st = station_map(plant)
    box = main or (0, 0, plant["size"]["w"], plant["size"]["d"])
    x0, z0, x1, z1 = box
    want = want or {}
    lv = levels(plant)
    n_lv = max(lv.values(), default=0) + 1
    aisle = next((z for z in plant.get("zones", []) if z["kind"] == "pasillo" and z["w"] >= z["d"]), None)
    preds = {}
    for r in plant.get("routes", []):
        if r["from"] in st and r["to"] in st and not r.get("is_return"):
            preds.setdefault(r["to"], []).append(r["from"])
    positions, placed = {}, []

    def rot_of(s):
        return 0 if s["w"] >= s["d"] else 90

    def put(sid, target):
        pos, r = nearest_free(plant, st[sid], target, placed, rot_of(st[sid]))
        positions[sid] = pos
        placed.append(r)

    def off_aisle(z, d):
        """Una estación no se centra sobre el pasillo: se corre al lado más cercano."""
        if not aisle:
            return z
        a0, a1 = aisle["z"] - aisle["d"] / 2 - GAP, aisle["z"] + aisle["d"] / 2 + GAP
        if z + d / 2 <= a0 or z - d / 2 >= a1:
            return z
        return a0 - d / 2 if z <= aisle["z"] else a1 + d / 2

    # 1) Lo que el texto ubicó (y lo fijo) primero.
    for sid, region in want.items():
        s = st[sid]
        w, d = dims(s, rot_of(s))
        put(sid, _region_pt(region, box, w, d))
    # 2) El inicio del flujo: lo que entra junto a su portón de descarga; si no, a la izquierda al centro.
    starts = [s["id"] for s in plant["stations"] if lv[s["id"]] == 0 and s["id"] not in positions]
    for i, sid in enumerate(starts):
        s = st[sid]
        w, d = dims(s, rot_of(s))
        if s["kind"] == "recepcion":
            put(sid, gate_pt(plant, plant.get("receive_gate"), max(w, d) / 2 + EDGE + 1))
        else:
            put(sid, (x0 + EDGE + w / 2, off_aisle(z0 + (z1 - z0) * (i + 1) / (len(starts) + 1), d)))
    # 3) Las columnas de los demás niveles, en el espacio que queda a la derecha del inicio.
    first = [positions[k] for k in positions if lv.get(k) == 0]
    left = max((p[0] + dims(st[k], p[2])[0] / 2 for k, p in positions.items() if lv.get(k) == 0), default=x0) + GAP + 1
    left = min(left, x0 + (x1 - x0) / 2)
    right = x1 - EDGE
    step = (right - left) / max(n_lv - 1, 1)
    mid = sum(p[1] for p in first) / len(first) if first else (z0 + z1) / 2
    for L in range(1, n_lv):
        group = [s["id"] for s in plant["stations"] if lv[s["id"]] == L and s["id"] not in positions]
        if not group:
            continue

        def bary(sid):
            pz = [positions[p][1] for p in preds.get(sid, []) if p in positions]
            return sum(pz) / len(pz) if pz else mid

        group.sort(key=bary)
        x = left + (L - 0.5) * step
        center = sum(bary(k) for k in group) / len(group)
        depths = [dims(st[k], rot_of(st[k]))[1] for k in group]
        gap = max(depths) + 2 * GAP + 1  # entre una y otra cabe un pasillo
        span = gap * (len(group) - 1)
        # El abanico se corre lo justo para caber dentro del cuerpo principal.
        top = min(max(center - span / 2, z0 + EDGE + max(depths) / 2), z1 - EDGE - max(depths) / 2 - span)
        for i, sid in enumerate(group):
            s = st[sid]
            w, d = dims(s, rot_of(s))
            if s["kind"] == "despacho" and L == n_lv - 1:
                # Sale por el portón de carga más cercano al final del flujo (no uno que obligue a regresar).
                inset = max(w, d) / 2 + EDGE + 1
                loading = [g["id"] for g in plant.get("gates", []) if g.get("use") in ("carga", "mixto")]
                if len(loading) > 1:
                    end = (x, bary(sid))
                    plant["dispatch_gate"] = min(loading, key=lambda gid: abs(gate_pt(plant, gid, inset)[0] - end[0]) + abs(gate_pt(plant, gid, inset)[1] - end[1]))
                put(sid, gate_pt(plant, plant.get("dispatch_gate"), inset))
                continue
            z = bary(sid) if len(group) == 1 else top + i * gap
            put(sid, (x, off_aisle(z, d)))
    return positions


def apply(plant, text, notes, issues, main=None):
    """Fija lo pedido, ubica lo que el texto dice y acomoda por niveles del flujo."""
    sts = plant["stations"]
    locked = locks(text, sts)
    want = targets(text, sts)
    # Lo fijo sin lugar pedido también va primero, en el orden del flujo.
    lv = levels(plant)
    for sid in sorted(locked, key=lambda k: lv.get(k, 0)):
        want.setdefault(sid, None)
    for sid in [k for k, v in want.items() if v is None]:
        want[sid] = "frente-izquierda" if lv.get(sid, 0) == 0 else None
    plant["layout"] = flow_layout(plant, {k: v for k, v in want.items() if v}, main)
    # Lo fijo sin lugar pedido queda donde lo puso el acomodo.
    names = {s["id"]: s["name"] for s in sts}
    for s in sts:
        if s["id"] in locked:
            s["locked"] = True
            s["lock_reason"] = "El texto pide no moverla ni girarla"
    if locked:
        notes.append("Fijas (no se mueven, no giran ni cambian de medidas): " + ", ".join(names[k] for k in locked) + ".")
    placed = [k for k, v in want.items() if v]
    if placed:
        notes.append("Ubicación tomada del texto: " + ", ".join(f"{names[k]} ({want[k].replace('-', ' ')})" for k in placed) + ".")
    return locked


# ---------- Flujo contado como historia ----------

GENERIC = {"maquina", "estacion", "cuarto", "sala", "area", "zona", "mesa", "linea", "proceso", "de", "del", "con", "la", "el"}
FLOW_CUES = re.compile(r"\b(?:pasa|pasan|van|va|llega|llegan|luego|despues|de ahi|siguiente|entra|entran|se lleva|se llevan|se guarda|se guardan|se mete|se meten|se manda|se mandan|termina|terminan|sale|salen|regresa|regresan|vuelve|vuelven|sigue|siguen|continua|alimenta|alimentan)\b")
RETURN = re.compile(r"\b(?:regres\w*|vuelv\w*|devuelv\w*|retrabaj\w*|reprocesa\w*)\b")
# Separadores de ramas ("pero las que...", "una parte va a A y otra a B") y de uniones ("y las dos terminan en C").
CLAUSE = re.compile(r",?\s+(pero|mientras que|en cambio|y las que|y los que|y otras?|otras?|y las dos|y los dos|las dos|los dos|y ambas|y ambos|ambas|ambos|y todas|y todos)\s+")
JOIN = {"y las dos", "y los dos", "las dos", "los dos", "y ambas", "y ambos", "ambas", "ambos", "y todas", "y todos"}


def _heads(sts):
    """Palabras que distinguen a cada estación (las que ninguna otra tiene)."""
    words = {s["id"]: {w for w in _words(s["name"]) if w not in GENERIC and len(w) >= 3} for s in sts}
    out = {}
    for sid, ws in words.items():
        own = {w for w in ws if not any(w in o for k, o in words.items() if k != sid)}
        out[sid] = own or ws
    return out


def _find(sentence, sts, heads):
    """(posición, id) de cada estación nombrada en la oración, por su palabra distintiva."""
    s = _norm(sentence)
    hits = []
    for st in sts:
        best = None
        for w in heads[st["id"]]:
            m = re.search(r"(?<![a-z])" + re.escape(w[: max(4, len(w) - 2)]), s)
            if m and (best is None or m.start() < best):
                best = m.start()
        if best is not None:
            hits.append((best, st["id"]))
    return sorted(hits)


def narrative_routes(text, sts):
    """Rutas de una historia contada: cada oración sigue desde la última estación mencionada;
    'pero las que...' abre una rama desde el mismo punto y 'regresa a' marca un retorno."""
    heads = _heads(sts)
    routes = []

    def add(a, b, ret=False):
        if a and b and a != b and not any(r["from"] == a and r["to"] == b for r in routes):
            routes.append({"id": f"r{len(routes) + 1}", "from": a, "to": b, "frac": 1.0, **({"is_return": True} if ret else {})})

    prev = None
    for sen in sentences(text):
        n = _norm(sen)
        found = _find(sen, sts, heads)
        if not found:
            continue
        if not FLOW_CUES.search(n) and len(found) < 2:
            # "La cepilladora está anclada al piso": describe, no mueve material.
            continue
        entry = prev
        last = prev
        parts = CLAUSE.split(n)
        ends = []  # dónde termina cada rama de esta oración
        for k in range(0, len(parts), 2):
            clause, sep = parts[k], (parts[k - 1] if k else None)
            here = _find(clause, sts, heads)
            if sep in JOIN and ends:
                # Las ramas se juntan: cada una llega a la primera estación que sigue.
                cur = None
                for i, (pos, sid) in enumerate(here):
                    if i == 0:
                        for e in ends:
                            add(e, sid)
                    else:
                        add(cur, sid)
                    cur = sid
                ends = [cur] if cur else ends
                last = cur or last
                continue
            cur = entry
            for pos, sid in here:
                before = clause[:pos]
                if RETURN.search(before[-30:]) and cur:
                    add(cur, sid, ret=True)
                    continue  # el material bueno sigue desde donde se revisó
                add(cur, sid)
                cur = sid
            if cur and cur != entry:
                ends.append(cur)
            # Si la oración empieza nombrando el punto de partida ("del ensamble una parte..."), de ahí nacen las ramas.
            if k == 0 and entry is None and here:
                entry = here[0][1]
            last = cur
        prev = last
    return routes
