"""Lugar, tamaño, cantidad y fijos que la historia dice con palabras (sin IA).

El plano se mira desde arriba: el origen (0, 0) es la esquina superior izquierda, x crece
hacia la derecha y y (z en el plano) hacia abajo. Arriba es el norte o el fondo; abajo, el
sur o el frente (donde están los portones); la derecha es el este.

Se entiende, en la misma oración que nombra al elemento:
- Coordenadas del centro: "en x=10, y=4", "en (10, 4)".
- Distancia a una pared: "a 2 m de la pared norte" (hasta el borde del elemento).
- Pared, esquina o centro: "contra la pared norte", "en la esquina sureste", "al fondo",
  "en el centro". Una familia de máquinas iguales se pone en fila a lo largo de la pared.
- Tamaño: "mide 6x3", "de 6 por 3 metros".
- Fijo: "no se puede mover", "está fijo", "anclado", "empotrado". El motivo es la oración.
Los portones: "la entrada está en la pared este", "la salida está fija".
"""

from __future__ import annotations

import re

from .catalog import KIND, ZONE
from .layout import EDGE

NUM = r"(\d+(?:[.,]\d+)?)"
WORD_START = r"(?<![a-z])"
SENTENCE = re.compile(r"[;\n]+|\.(?!\d)")

LOCK = re.compile(
    WORD_START + r"(?:fij[oa]s?\b|no se (?:puede[n]? )?mueve[n]?|no se puede[n]? mover|no puede[n]? mover(?:se)?|no (?:lo|la|los|las) (?:puedo|podemos|pueden) mover"
    r"|inamovible|anclad[oa]s?|empotrad[oa]s?|no se (?:debe[n]? )?mover|no mover)"
)
COORDS = [
    re.compile(r"x\s*[=:]\s*" + NUM + r"\s*(?:m(?:etros?)?)?[^\d]{0,12}?(?:y|z)\s*[=:]\s*" + NUM),
    re.compile(r"\(\s*" + NUM + r"\s*(?:m)?\s*,\s*" + NUM + r"\s*(?:m)?\s*\)"),
]
SIDE = r"(norte|sur|este|oeste|izquierd[oa]|derech[oa]|del fondo|de(?:l)? frente|trasera|delantera|de arriba|de abajo|superior|inferior)"
DIST = re.compile(r"a\s+" + NUM + r"\s*(?:m(?:etros?)?)?\s+de\s+la\s+(?:pared|muro)\s+" + SIDE)
WALL = re.compile(r"(?:contra|junto a|pegad[oa]s? a|en|sobre|a lo largo de)\s+(?:la\s+|el\s+)?(?:pared|muro|lado)\s+" + SIDE)
CORNER = re.compile(r"esquina\s+((?:[a-z]+\s*){1,4})")
PLAIN = re.compile(WORD_START + r"(?:al|en el) (fondo|frente)\b|" + WORD_START + r"(?:en el centro|en medio)")
SIZE = re.compile(r"(?:mide|miden|medidas? de|tamano de|dimensiones? de|ocupa[n]?)\s*" + NUM + r"\s*(?:m(?:etros?)?)?\s*(?:x|×|por)\s*" + NUM)
FACILITY = re.compile(WORD_START + r"(?:planta|fabrica|taller|nave|edificio|terreno|local|carpinteria|tamaleria|bodega)")
PERIOD = re.compile(r"\b(?:al|por|cada|a la) (?:dia|semana|mes|hora|turno)\b|diari|semanal|mensual")

ENTRY_GATE = ("porton de entrada", "puerta de entrada", "entrada", "acceso")
EXIT_GATE = ("porton de salida", "puerta de salida", "salida")


def _num(s):
    return float(s.replace(",", "."))


def sentences(t: str) -> list[str]:
    return [s for s in SENTENCE.split(t) if s.strip()]


def _side(word: str) -> str | None:
    w = word.strip()
    # "oeste" antes que "este": noroeste contiene las dos.
    if "oeste" in w or "izquierd" in w:
        return "left"
    if "este" in w or "derech" in w:
        return "right"
    if "nor" in w or "fondo" in w or "trasera" in w or "arriba" in w or "superior" in w:
        return "top"
    if "sur" in w or "frente" in w or "delantera" in w or "abajo" in w or "inferior" in w:
        return "bottom"
    return None


def _corner(words: str) -> tuple[str, str] | None:
    w = words.strip()
    v = "top" if any(k in w for k in ("nor", "superior", "fondo", "arriba")) else "bottom" if any(k in w for k in ("sur", "inferior", "frente", "abajo")) else None
    h = "left" if any(k in w for k in ("oeste", "izquierd")) else "right" if any(k in w for k in ("este", "derech")) else None
    return (v, h) if v and h else None


def _station_words(s: dict) -> list[str]:
    from .story import _stems

    name = s.get("family_name") or s["name"]
    words = _stems(name)
    if s.get("kind") in KIND:
        words += KIND[s["kind"]]["keywords"]
    return [w for w in words if w]


def items_of(plant: dict) -> list[dict]:
    """Lo que la historia puede nombrar: estaciones (una familia es un solo elemento), zonas y portones."""
    out, seen = [], {}
    for s in plant["stations"]:
        fam = s.get("family")
        if fam and fam in seen:
            seen[fam]["ids"].append(s["id"])
            continue
        it = {"type": "station", "ids": [s["id"]], "words": _station_words(s), "name": s.get("family_name") or s["name"]}
        if fam:
            seen[fam] = it
        out.append(it)
    for z in plant.get("zones", []):
        from .story import _stems

        words = _stems(z["name"]) + (ZONE[z["kind"]]["keywords"] if z["kind"] in ZONE else [])
        out.append({"type": "zone", "ids": [z["id"]], "words": words, "name": z["name"]})
    for key, words in (("receive_gate", ENTRY_GATE), ("dispatch_gate", EXIT_GATE)):
        gid = plant.get(key)
        if gid:
            out.append({"type": "gate", "ids": [gid], "words": list(words), "name": "la entrada" if key == "receive_gate" else "la salida"})
    return out


def _mentions(sentence: str, it: dict) -> list[int]:
    return sorted({m.start() for w in it["words"] for m in re.finditer(WORD_START + re.escape(w), sentence)})


def _owners(sentence: str, items: list[dict], pos: int, after_ok: bool = True) -> list[dict]:
    """Los elementos nombrados justo antes de `pos` en la oración (o, para un lugar, el primero después)."""
    before, after = [], []
    for it in items:
        ms = _mentions(sentence, it)
        b = [m for m in ms if m <= pos]
        if b:
            before.append((max(b), it))
        elif ms:
            after.append((min(ms), it))
    if before:
        top = max(p for p, _ in before)
        # Una planta, taller o nave entre el nombre y el dato: el dato es del edificio.
        if FACILITY.search(sentence[top:pos]):
            return []
        return [it for p, it in before if p == top]
    # "En la esquina está el horno": el dato antes del nombre. Si antes se habló del edificio, es suyo.
    if after and after_ok and not FACILITY.search(sentence[:pos]):
        top = min(p for p, _ in after)
        return [it for p, it in after if p == top]
    return []


def read(plant: dict, t: str) -> dict:
    """Todo lo que la historia dice de cada elemento: {item_index: {lock, coords, dist, wall, corner, center, size}}."""
    items = items_of(plant)
    found = {}
    for sentence in sentences(t):
        def put(pos, key, value):
            # Tamaño y fijo son de lo ya nombrado ("el horno mide 6x3 y no se mueve").
            for it in _owners(sentence, items, pos, key not in ("size", "lock")):
                found.setdefault(id(it), {"item": it})[key] = value

        for m in LOCK.finditer(sentence):
            put(m.start(), "lock", sentence.strip())
        for rx in COORDS:
            for m in rx.finditer(sentence):
                put(m.start(), "coords", (_num(m.group(1)), _num(m.group(2))))
        for m in DIST.finditer(sentence):
            side = _side(m.group(2))
            if side:
                for it in _owners(sentence, items, m.start()):
                    found.setdefault(id(it), {"item": it}).setdefault("dist", {})[side] = _num(m.group(1))
        for m in WALL.finditer(sentence):
            side = _side(m.group(1))
            if side:
                put(m.start(), "wall", side)
        for m in CORNER.finditer(sentence):
            c = _corner(m.group(1))
            if c:
                put(m.start(), "corner", c)
        for m in PLAIN.finditer(sentence):
            put(m.start(), "wall" if m.group(1) else "center", ("top" if m.group(1) == "fondo" else "bottom") if m.group(1) else True)
        for m in SIZE.finditer(sentence):
            w, d = _num(m.group(1)), _num(m.group(2))
            if w > 0 and d > 0:
                put(m.start(), "size", (w, d))
    return {k: v for k, v in found.items()}


# ---------- Cantidades ----------

def quantity(t: str, words: list[str]) -> int | None:
    """"10 bobinadoras", "3 sierras de corte": la cifra justo antes del nombre (2 a 50)."""
    for w in words:
        if len(w) < 4:
            continue
        for m in re.finditer(r"(?<![\d.,x])(\d+)\s+(?:[a-z]+\s+)?" + WORD_START + re.escape(w) + r"[a-z]*", t):
            n = int(m.group(1))
            tail = t[m.end():m.end() + 24]
            if 2 <= n <= 50 and not PERIOD.search(tail) and not re.match(r"\s*(?:x|por)\s*\d", tail):
                return n
    return None


# ---------- Aplicar al plano ----------

def _wall_point(side, W, D, w, d, cur):
    x, z = cur
    if side == "top":
        return x, EDGE + d / 2
    if side == "bottom":
        return x, D - EDGE - d / 2
    if side == "left":
        return EDGE + w / 2, z
    return W - EDGE - w / 2, z


def _target(info, W, D, w, d, cur):
    """Centro pedido para un elemento de w × d, partiendo de donde está."""
    if "coords" in info:
        return info["coords"]
    x, z = cur
    if "corner" in info:
        v, h = info["corner"]
        x = EDGE + w / 2 if h == "left" else W - EDGE - w / 2
        z = EDGE + d / 2 if v == "top" else D - EDGE - d / 2
    elif "wall" in info:
        x, z = _wall_point(info["wall"], W, D, w, d, (x, z))
    elif info.get("center"):
        x, z = W / 2, D / 2
    for side, dist in (info.get("dist") or {}).items():
        if side == "left":
            x = dist + w / 2
        elif side == "right":
            x = W - dist - w / 2
        elif side == "top":
            z = dist + d / 2
        else:
            z = D - dist - d / 2
    return x, z


def _row(info, W, D, sts, first):
    """Centros de una familia en fila desde `first`, a lo largo de su pared (o en horizontal)."""
    vertical = info.get("wall") in ("left", "right")
    gap = 1.5
    size = (lambda s: s["d"]) if vertical else (lambda s: s["w"])
    span = sum(size(s) for s in sts) + gap * (len(sts) - 1)
    a = first[1] if vertical else first[0]
    # Solo la pared: la fila se centra en ella. Con coordenadas o esquina, empieza ahí.
    only_wall = "wall" in info and not ({"coords", "corner"} & set(info))
    start = a - span / 2 if only_wall else a - size(sts[0]) / 2
    if info.get("corner") and info["corner"][1 if not vertical else 0] in ("right", "bottom"):
        start = a + size(sts[0]) / 2 - span  # desde una esquina derecha o de abajo, la fila crece hacia adentro
    limit = D if vertical else W
    start = max(EDGE, min(limit - EDGE - span, start))
    out = []
    for s in sts:
        c = start + size(s) / 2
        out.append((first[0], c) if vertical else (c, first[1]))
        start += size(s) + gap
    return out


def apply_sizes(plant: dict, found: dict) -> list[str]:
    notes = []
    st = {s["id"]: s for s in plant["stations"]}
    for info in found.values():
        it = info["item"]
        if "size" not in info or it["type"] == "gate":
            continue
        w, d = info["size"]
        for i in it["ids"]:
            el = st.get(i) or next((z for z in plant.get("zones", []) if z["id"] == i), None)
            if el:
                el["w"], el["d"] = w, d
                if el.get("count"):
                    el["unit_w"], el["unit_d"] = w, d
        notes.append(f"Medidas de {it['name']}: {w:g} × {d:g} m, tomadas de la descripción.")
    return notes


def apply_gates(plant: dict, found: dict) -> list[str]:
    from .engine import gate_pt

    W, D = plant["size"]["w"], plant["size"]["d"]
    notes = []
    for info in found.values():
        it = info["item"]
        if it["type"] != "gate":
            continue
        g = next((q for q in plant["gates"] if q["id"] == it["ids"][0]), None)
        if not g:
            continue
        side = info.get("wall") or (info["corner"][1] if "corner" in info else None)
        if "coords" in info:
            g["x"], g["z"] = info["coords"]
        elif side:
            x = float(g["x"])
            g["x"], g["z"] = {"top": (x, 0.0), "bottom": (x, D), "left": (0.0, D / 2), "right": (W, D / 2)}[side]
        if "coords" in info or side:
            g["x"], g["z"] = (round(v, 2) for v in gate_pt(plant, g["id"], 0.0))
            notes.append(f"Portón de {it['name'][3:]}: donde lo indica la descripción.")
    # Si los dos quedaron en el mismo punto, se separan sobre el mismo muro.
    a = next((q for q in plant["gates"] if q["id"] == plant.get("receive_gate")), None)
    b = next((q for q in plant["gates"] if q["id"] == plant.get("dispatch_gate")), None)
    if a and b and a is not b and abs(a["x"] - b["x"]) < 5 and abs(float(a.get("z") or D) - float(b.get("z") or D)) < 5:
        if a.get("z") in (0.0, D) or a.get("z") is None:
            b["x"] = round(min(W - 2.5, a["x"] + 6), 2)
        else:
            b["z"] = round(min(D - 2.5, float(a["z"]) + 6), 2)
    return notes


def apply_zones(plant: dict, found: dict) -> list[str]:
    W, D = plant["size"]["w"], plant["size"]["d"]
    notes = []
    for info in found.values():
        it = info["item"]
        if it["type"] != "zone" or not ({"coords", "dist", "wall", "corner", "center"} & set(info)):
            continue
        z = next(q for q in plant["zones"] if q["id"] == it["ids"][0])
        z["x"], z["z"] = (round(v, 2) for v in _target(info, W, D, z["w"], z["d"], (z["x"], z["z"])))
        notes.append(f"{z['name']}: en el lugar que indica la descripción.")
    return notes


def station_targets(plant: dict, found: dict) -> dict:
    """Centro pedido para cada estación (las familias en fila)."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    st = {s["id"]: s for s in plant["stations"]}
    pos = plant.get("layout") or {}
    targets = {}
    for info in found.values():
        it = info["item"]
        if it["type"] != "station" or not ({"coords", "dist", "wall", "corner", "center"} & set(info)):
            continue
        sts = [st[i] for i in it["ids"]]
        cur = pos.get(sts[0]["id"], (W / 2, D / 2))
        first = _target(info, W, D, sts[0]["w"], sts[0]["d"], (cur[0], cur[1]))
        if len(sts) == 1:
            targets[sts[0]["id"]] = first
            continue
        for s, p in zip(sts, _row(info, W, D, sts, first)):
            targets[s["id"]] = p
    return targets


def exact(plant: dict, targets: dict) -> list[str]:
    """Lo que la historia ubicó se deja en el punto exacto si ahí cabe (el acomodo usa una
    malla de 0,5 m). Devuelve los ids que quedaron exactos."""
    from .layout import _rect, feasible

    st = {s["id"]: s for s in plant["stations"]}
    pos = plant["layout"]
    done = []
    for sid, (x, z) in targets.items():
        rot = 0  # el punto se calculó con el ancho y el fondo sin girar
        others = [_rect(st[k], *pos[k]) for k in pos if k != sid and k in st]
        if feasible(plant, _rect(st[sid], x, z, rot), others):
            pos[sid] = [round(x, 2), round(z, 2), rot]
            done.append(sid)
    return done


def apply_locks(plant: dict, found: dict) -> list[str]:
    notes = []
    st = {s["id"]: s for s in plant["stations"]}
    for info in found.values():
        it = info["item"]
        if "lock" not in info:
            continue
        reason = info["lock"][:1].upper() + info["lock"][1:120]
        for i in it["ids"]:
            el = st.get(i) or next((z for z in plant.get("zones", []) if z["id"] == i), None) or next((g for g in plant.get("gates", []) if g["id"] == i), None)
            if el is not None:
                el["locked"] = True
                el["lock_reason"] = reason
        notes.append(f"Fijo según la descripción: {it['name']}.")
    return notes
