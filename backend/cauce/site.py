"""Recinto, pasillos y portones leídos del texto de forma determinista.

La IA ayuda a interpretar, pero las medidas, la forma y los portones que el usuario
escribe con cifras se leen aquí con reglas y se validan con geometría: lo que dice
el texto prevalece sobre lo que adivine el modelo.

Convenciones (las mismas del motor y del frontend): metros; x crece de izquierda a
derecha, z de fondo (0) a frente (D, la calle). Un portón es un punto sobre el
contorno con ancho `w` (4,4 m si no se dice), alto `h`, `use` (carga, descarga o
mixto) y `side` (frente, fondo, izquierda, derecha).
"""

from __future__ import annotations

import math
import re

from .engine import outline, poly_edges, rect_outline, seg_dist

GATE_W = 4.4   # ancho por defecto (el mismo hueco de siempre)
GATE_H = 4.5   # alto por defecto
GATE_MARGIN = 0.6  # muro mínimo entre portones y hasta las esquinas (m)

NUM = r"(\d+(?:[.,]\d+)?)"
UNIT = r"\s*(cm|mm|centimetros?|milimetros?|m(?:etros?|ts?)?)?"


def _f(v):
    return float(str(v).replace(",", "."))


def to_m(value, unit):
    """Convierte a metros: cm y mm se dividen; sin unidad o en metros queda igual."""
    u = (unit or "").strip()
    if u.startswith(("cm", "centim")):
        return value / 100
    if u.startswith(("mm", "milim")):
        return value / 1000
    return value


# ---------- Medidas del recinto ----------

FACILITY = r"(?:almacen|bodega|nave|recinto|edificio|galpon|planta|fabrica|taller|carpinteria|tamaleria)"
SHAPES = r"(?:rectangular|cuadrad[oa]|en forma de [lut]|en [lut]|industrial|principal|nuev[oa])"
# "de 60 metros de largo por 40 metros de ancho"
LARGO_ANCHO = re.compile(
    NUM + UNIT + r"\s+de\s+(largo|ancho|fondo|frente|profundidad)\s*(?:,|por|x|×|y)\s*" + NUM + UNIT + r"\s+de\s+(largo|ancho|fondo|frente|profundidad)"
)
# "de 60 x 40 m", "mide 80 por 50 metros"
W_BY_D = re.compile(r"(?:de|mide|tiene|con|:)?\s*" + NUM + r"\s*(?:m(?:etros?)?\s*)?(?:x|×|por)\s*" + NUM + UNIT)


def _largo_ancho(m):
    a, ua, ka, b, ub, kb = m.groups()
    a, b = to_m(_f(a), ua or ub), to_m(_f(b), ub or ua)
    depth_words = ("ancho", "fondo", "profundidad")
    # largo/frente van sobre x; ancho/fondo/profundidad sobre z. Con "ancho" y "fondo" juntos, ancho es x.
    if ka in depth_words and kb in depth_words:
        return (a, b) if ka == "ancho" else (b, a)
    if ka in depth_words:
        return b, a
    return a, b


def facility_dims(t):
    """(W, D, (inicio, fin) de la palabra del recinto) o None. Solo medidas de 6 m o más por lado."""
    for m in re.finditer(r"(?<![a-z])" + FACILITY + r"[a-z]*", t):
        tail = t[m.end():m.end() + 120]
        # Hasta 6 palabras entre el recinto y sus medidas, sin cruzar a otra oración ni a otra cifra.
        ctx = re.match(r"^((?:\s+(?!\d)[a-z]+){0,6}?)\s*(?:,|:)?\s*(?=\d)", tail)
        if not ctx:
            continue
        rest = tail[ctx.end():]
        la = LARGO_ANCHO.match(rest)
        if la:
            w, d = _largo_ancho(la)
        else:
            wd = W_BY_D.match(rest)
            if not wd:
                continue
            w, d = to_m(_f(wd.group(1)), wd.group(3)), to_m(_f(wd.group(2)), wd.group(3))
        words = ctx.group(1)
        # Un "almacén de 6 x 3" es una estación; el recinto se reconoce por su tamaño o por su forma.
        if m.group(0).startswith("almacen") and w * d < 200 and not re.search(SHAPES, words):
            continue
        if w >= 6 and d >= 6:
            return w, d, (m.start(), m.end())
    return None


# ---------- Forma ----------

def dims_at(s):
    """Medidas al inicio de s: "60 m de largo x 30 m de ancho" o "20 m x 15 m" → (x, z) en metros."""
    la = LARGO_ANCHO.match(s)
    if la:
        return _largo_ancho(la)
    m = re.match(r"\s*" + NUM + UNIT + r"\s*(?:x|×|por)\s*" + NUM + UNIT, s)
    if not m:
        return None
    u = m.group(4) or m.group(2)
    return to_m(_f(m.group(1)), m.group(2) or u), to_m(_f(m.group(3)), u)


def _dims_after(t, words):
    """Medidas que siguen a una palabra ("ala de 20 x 15", "rectángulo principal: 60 m de largo x 30 m de ancho")
    y la oración donde aparecen."""
    for m in re.finditer(r"(?<![a-z])(?:" + words + r")[a-z]*((?:\s+(?!de\b)[a-z]+){0,3}?)\s*(?::|\bde\b|\bmide\b)?\s*(?=\d)", t):
        d = dims_at(t[m.end():m.end() + 80])
        if d:
            a = max(t.rfind(".", 0, m.start()), t.rfind("\n", 0, m.start())) + 1
            b = min([i for i in (t.find(".", m.end()), t.find("\n", m.end())) if i >= 0] or [len(t)])
            return d, t[a:b]
    return None


def rects_outline(rects):
    """Contorno de la unión de rectángulos alineados a los ejes (x0, z0, x1, z1), sin huecos ni paredes duplicadas."""
    xs = sorted({v for r in rects for v in (r[0], r[2])})
    zs = sorted({v for r in rects for v in (r[1], r[3])})

    def inside(i, j):
        cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
        return any(r[0] <= cx <= r[2] and r[1] <= cz <= r[3] for r in rects)

    nx, nz = len(xs) - 1, len(zs) - 1
    cell = {(i, j) for i in range(nx) for j in range(nz) if inside(i, j)}
    nxt = {}
    # Lados de celda con dentro a la izquierda del recorrido (sentido horario en pantalla, como el resto de las formas).
    for i, j in cell:
        if (i, j - 1) not in cell:
            nxt[(xs[i], zs[j])] = (xs[i + 1], zs[j])
        if (i + 1, j) not in cell:
            nxt[(xs[i + 1], zs[j])] = (xs[i + 1], zs[j + 1])
        if (i, j + 1) not in cell:
            nxt[(xs[i + 1], zs[j + 1])] = (xs[i], zs[j + 1])
        if (i - 1, j) not in cell:
            nxt[(xs[i], zs[j + 1])] = (xs[i], zs[j])
    start = min(nxt)
    pts, p = [start], nxt[start]
    while p != start and len(pts) <= len(nxt):
        pts.append(p)
        p = nxt[p]
    # Fuera los vértices que solo continúan una recta.
    out = []
    for k, q in enumerate(pts):
        a, b = pts[k - 1], pts[(k + 1) % len(pts)]
        if (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]) != 0:
            out.append([round(q[0], 2), round(q[1], 2)])
    return out


def _wing_place(sentence):
    """Dónde va el ala según la oración: lado (frente, fondo, izquierda, derecha) y extremo."""
    side = "fondo" if re.search(r"posterior|traser|fondo|atras", sentence) else "frente" if re.search(r"frontal|frente|delanter", sentence) else None
    end = "derecha" if re.search(r"derech", sentence) else "izquierda" if re.search(r"izquierd", sentence) else None
    if side is None and end and re.search(r"(?:lado|costado|pared)\s+(?:" + end[:6] + ")", sentence):
        side, end = end, None
    return side or "frente", end or "izquierda"


def shape_geometry(t):
    """Forma con medidas por partes → (W, D, contorno, nota, rectángulo principal) o None.

    L: rectángulo principal A x B y un ala C x E pegada al lado y extremo que diga el texto
    ("en el extremo derecho de la parte posterior"); sin decirlo, al frente a la izquierda.
    U: base A x B al fondo y dos brazos C x E en los extremos hacia el frente.
    """
    poly = vertices(t)
    if poly:
        W, D = max(p[0] for p in poly), max(p[1] for p in poly)
        return W, D, poly, f"Contorno de {len(poly)} vértices tomado de la descripción.", None
    if re.search(r"forma de l\b|\ben l\b", t):
        main = _dims_after(t, r"rectangulo principal|tramo principal|cuerpo principal|nave principal|parte principal|area principal|tramo|cuerpo")
        wing = _dims_after(t, r"ala|brazo|anexo|extension")
        if main and wing:
            (A, B), _ = main
            (C, E), sentence = wing
            side, end = _wing_place(sentence)
            if side in ("frente", "fondo"):
                x0 = A - C if end == "derecha" else 0
                wing_r = (x0, B if side == "frente" else -E, x0 + C, B + E if side == "frente" else 0)
            else:
                z0 = 0 if end == "fondo" else B - E
                wing_r = (A if side == "derecha" else -C, z0, A + C if side == "derecha" else 0, z0 + E)
            main_r = (0, 0, A, B)
            dx, dz = -min(main_r[0], wing_r[0]), -min(main_r[1], wing_r[1])
            main_r = (main_r[0] + dx, main_r[1] + dz, main_r[2] + dx, main_r[3] + dz)
            wing_r = (wing_r[0] + dx, wing_r[1] + dz, wing_r[2] + dx, wing_r[3] + dz)
            poly = rects_outline([main_r, wing_r])
            W, D = max(p[0] for p in poly), max(p[1] for p in poly)
            where = f"{'al ' + side if side in ('frente', 'fondo') else 'a la ' + side}, extremo {end}"
            return W, D, poly, f"Forma en L: rectángulo principal de {A:g} x {B:g} m y ala de {C:g} x {E:g} m {where} (sin áreas superpuestas).", main_r
    if re.search(r"forma de u\b|\ben u\b", t):
        base = _dims_after(t, r"base|rectangulo principal|tramo principal|cuerpo principal|tramo")
        arm = _dims_after(t, r"brazos?|alas?")
        if base and arm and 2 * arm[0][0] < base[0][0]:
            (A, B), (C, E) = base[0], arm[0]
            poly = rects_outline([(0, 0, A, B), (0, B, C, B + E), (A - C, B, A, B + E)])
            return A, B + E, poly, f"Forma en U: base de {A:g} x {B:g} m y dos brazos de {C:g} x {E:g} m.", (0, 0, A, B)
    return None


def wall_height(t):
    """Altura de las paredes si el texto la dice ("altura de las paredes: 6 m")."""
    m = re.search(r"altura de (?:las |los )?(?:paredes|muros)[^0-9.\n]{0,12}" + NUM + UNIT, t) or re.search(r"(?:paredes|muros) de " + NUM + UNIT + r" de alt", t)
    if not m:
        return None
    h = to_m(_f(m.group(1)), m.group(2))
    return h if 2 <= h <= 30 else None


def aisles(t, W, D, main=None):
    """Pasillos reservados: "reserva un pasillo central de 4 metros de ancho". Van por el centro del cuerpo principal."""
    out = []
    x0, z0, x1, z1 = main or (0, 0, W, D)
    mw, md = x1 - x0, z1 - z0
    for m in re.finditer(r"pasillo\s+(central|principal|longitudinal|transversal)?[^.;\n]{0,40}?de\s+(?:al menos\s+|minimo\s+|un minimo de\s+)?" + NUM + UNIT + r"\s*(?:de\s+ancho)?", t):
        where, width = m.group(1) or "central", to_m(_f(m.group(2)), m.group(3))
        if not 1 <= width <= min(mw, md) / 2:
            continue
        along_x = where != "transversal" if mw >= md else where == "transversal"
        z = {"id": f"p{len(out) + 1}", "name": "Pasillo " + where, "kind": "pasillo", "locked": True, "lock_reason": "Pasillo reservado en la descripción"}
        if along_x:
            z.update(x=(x0 + x1) / 2, z=(z0 + z1) / 2, w=mw, d=width)
        else:
            z.update(x=(x0 + x1) / 2, z=(z0 + z1) / 2, w=width, d=md)
        out.append(z)
    return out


def vertices(t):
    """Contorno escrito como lista de vértices: "(0, 0), (60, 0), (60, 30)..."."""
    if not re.search(r"vertice|poligon|coordenad|puntos", t):
        return None
    pts = [(_f(a), _f(b)) for a, b in re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*\)", t)]
    if len(pts) < 3:
        return None
    x0, z0 = min(p[0] for p in pts), min(p[1] for p in pts)
    return [[round(x - x0, 2), round(z - z0, 2)] for x, z in pts]


# ---------- Portones ----------

SIDE_WORDS = [
    ("frente", r"frontal|frente|delanter|fachada|calle"),
    ("fondo", r"posterior|traser|fondo|atras"),
    ("izquierda", r"izquierd"),
    ("derecha", r"derech"),
]
# Lo que cuenta como portón industrial. Una "puerta peatonal" o una puerta a secas no.
GATE_NOUN = r"(?:portones|porton|cortinas|cortina|andenes|anden|muelles|muelle|puertas? (?:de carga|de descarga|industrial(?:es)?|de camion(?:es)?))"
GATE_COUNT = re.compile(r"(\d+)\s+(?:[a-z]+\s+)?" + GATE_NOUN)
GATE_SINGLE = re.compile(r"(?<![a-z])(?:el|la)\s+" + GATE_NOUN)


def _use(clause):
    if re.search(r"carga y descarga|descarga y carga|mixt|ambos|entrada y salida", clause):
        return "mixto"
    if re.search(r"descarga|recepcion|entrada|recib|llega", clause):
        return "descarga"
    if re.search(r"carga|despacho|salida|sale\b|embarque|envio", clause):
        return "carga"
    return None


def _sentence_before(t, a):
    """Lo que dice la oración antes de la mención ("la madera llega por el portón...")."""
    return t[max(t.rfind(".", 0, a), t.rfind("\n", 0, a)) + 1:a]


def _side(clause):
    for side, pat in SIDE_WORDS:
        if re.search(pat, clause):
            return side
    return None


def gate_requests(t):
    """Grupos de portones pedidos: [{'n', 'use', 'side', 'w', 'h'}]. Nunca cuenta dos veces la misma mención."""
    hits = [(m.start(), m.end(), int(m.group(1))) for m in GATE_COUNT.finditer(t)]
    counted_sides = {_side(t[b:b + 60]) for _, b, _ in hits}
    # "El portón de atrás" cuenta como uno más si ninguna cantidad habló de ese lado;
    # si no, se refiere a uno ya contado. Mencionarlo dos veces no lo duplica.
    seen = set()
    for m in GATE_SINGLE.finditer(t):
        side = _side(t[m.start():m.start() + 40])
        key = (_use(t[m.start():m.start() + 60]) or _use(_sentence_before(t, m.start())), side)
        if key in seen or (hits and (side is None or side in counted_sides)):
            continue
        seen.add(key)
        hits.append((m.start(), m.end(), 1))
    hits.sort()
    out = []
    for i, (a, b, n) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(t)
        stop = re.search(r"[.;\n]", t[b:end])
        clause = t[a:b + stop.start()] if stop else t[a:end]
        if re.search(r"peatonal|de personas|de emergencia", clause[: b - a + 20]):
            continue
        w = re.search(NUM + UNIT + r"\s+de\s+ancho|ancho\s+de\s+" + NUM + UNIT, clause)
        h = re.search(NUM + UNIT + r"\s+de\s+alt[oa]|alt[oa]\s+de\s+" + NUM + UNIT, clause)
        wv = to_m(_f(w.group(1) or w.group(3)), w.group(2) or w.group(4)) if w else None
        hv = to_m(_f(h.group(1) or h.group(3)), h.group(2) or h.group(4)) if h else None
        # "Los portones son de 5 m de ancho" en otra oración sirve para todos los que no dicen el suyo.
        use = _use(clause) or _use(_sentence_before(t, a)) or "mixto"
        out.append({"n": n, "use": use, "side": _side(clause[b - a:]) or _side(clause), "w": wv, "h": hv, "text": clause.strip(), "sent": len(re.findall(r"[.;\n]", t[:a]))})
    # "tres de carga al frente y dos de descarga atrás, de 5 m de ancho": una sola medida en la oración vale para todos.
    for key in ("w", "h"):
        for g in out:
            same = {x[key] for x in out if x["sent"] == g["sent"] and x[key]}
            if not g[key] and len(same) == 1:
                g[key] = same.pop()
    # "Cada portón tiene 5 m de ancho y 4 m de alto": medida común para los que no dicen la suya.
    for key, word in (("w", "ancho"), ("h", "alt[oa]")):
        common = re.search(r"(?:portones|porton|cortinas|cortina)[^.;\n]{0,40}?" + NUM + UNIT + r"\s+de\s+" + word, t)
        if common:
            v = to_m(_f(common.group(1)), common.group(2))
            for g in out:
                g[key] = g[key] or v
    out = [g for g in out if 1 <= g["n"] <= 40]
    # "Exactamente cinco portones: tres de carga al frente y dos de descarga atrás": el total no es otro grupo.
    detail = [g for g in out if g["side"]]
    if detail:
        for g in [g for g in out if not g["side"]]:
            if g["n"] >= sum(x["n"] for x in detail) or re.search(r"exactamente|en total|total de", g["text"]):
                out.remove(g)
                g_total = sum(x["n"] for x in detail)
                if g["n"] != g_total:
                    detail[0].setdefault("warn", f"El texto dice {g['n']} portones en total pero el detalle por pared suma {g_total}: se usa el detalle.")
    return out


SIDE_NORMAL = {"frente": (0, 1), "fondo": (0, -1), "izquierda": (-1, 0), "derecha": (1, 0)}


def side_edges(plant, side):
    """Lados del contorno que miran hacia `side` (normal hacia afuera), del más largo al más corto."""
    poly = outline(plant) or rect_outline(plant)
    area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in poly_edges(poly))
    sign = 1 if area2 >= 0 else -1
    nx, nz = SIDE_NORMAL[side]
    out = []
    for a, b in poly_edges(poly):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-6:
            continue
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        n = (sign * dz, -sign * dx)
        if n[0] * nx + n[1] * nz > 0.9:
            # Se recorre de izquierda a derecha (o de fondo a frente): los ids quedan en orden de lectura.
            out.append((a, b, L) if (b[0] - a[0]) + (b[1] - a[1]) > 0 else (b, a, L))
    # El exterior de verdad: en una L el lado del frente más alejado del centro es la fachada.
    # Primero la fachada (el lado más hacia afuera); en una U el frente son los brazos, no el fondo del entrante.
    return sorted(out, key=lambda e: (-round((e[0][0] + e[1][0]) * nx + (e[0][1] + e[1][1]) * nz, 1), -e[2]))


def _letters(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


USE_LABEL = {"carga": "carga", "descarga": "descarga", "mixto": "carga y descarga"}


def place_gates(plant, requests, notes, issues):
    """Coloca cada grupo repartido a lo largo de su pared. Lo que no cabe no se encoge: se informa."""
    gates = []
    by_side = {}
    for r in requests:
        by_side.setdefault(r["side"] or "frente", []).append(r)
    for side, reqs in by_side.items():
        edges = side_edges(plant, side)
        if not edges:
            issues.append(f"No hay una pared exterior hacia {side} para {sum(r['n'] for r in reqs)} portón(es).")
            continue
        items = [(r, k) for r in reqs for k in range(r["n"])]
        # Se llena la pared más larga y, si no alcanza, las siguientes del mismo lado.
        queue = list(items)
        for a, b, L in edges:
            if not queue:
                break
            fit, used = [], GATE_MARGIN
            for r, k in queue:
                w = r["w"] or GATE_W
                if used + w + GATE_MARGIN > L + 1e-6:
                    break
                fit.append((r, w))
                used += w + GATE_MARGIN
            if not fit:
                continue
            queue = queue[len(fit):]
            free = (L - sum(w for _, w in fit)) / (len(fit) + 1)
            s = 0.0
            dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
            for r, w in fit:
                s += free + w / 2
                gid = _letters(len(gates))
                gates.append({
                    "id": gid, "x": round(a[0] + dx * s, 2), "z": round(a[1] + dz * s, 2),
                    "label": f"Portón {gid} ({USE_LABEL[r['use']]})", "use": r["use"], "side": side,
                    "w": round(w, 2), "h": round(r["h"] or GATE_H, 2),
                })
                s += w / 2
        if queue:
            issues.append(f"No caben {len(queue)} de los portones pedidos en la pared {side}: se colocaron {len(items) - len(queue)} de {len(items)} sin reducir su ancho.")
    return gates


def apply_gates(plant, t, notes, issues):
    """Si el texto pide portones con cifras o con uso, reemplazan a los de la IA o a los de por defecto."""
    reqs = gate_requests(t)
    if not reqs:
        return False
    issues += [g["warn"] for g in reqs if g.get("warn")]
    gates = place_gates(plant, reqs, notes, issues)
    if not gates:
        return False
    plant["gates"] = gates
    recv = next((g["id"] for g in gates if g["use"] == "descarga"), None) or next((g["id"] for g in gates if g["use"] == "mixto"), gates[0]["id"])
    r0 = next(g for g in gates if g["id"] == recv)
    far = lambda g: -math.hypot(g["x"] - r0["x"], g["z"] - r0["z"])  # noqa: E731
    # Sale por el portón de carga más lejano a la entrada: el flujo cruza la planta en vez de volver.
    disp = next(iter(sorted((g for g in gates if g["use"] == "carga"), key=far)), None)
    disp = disp["id"] if disp else next((g["id"] for g in sorted(gates, key=far) if g["use"] == "mixto" and g["id"] != recv), recv)
    plant["receive_gate"], plant["dispatch_gate"] = recv, disp
    count = {}
    for g in gates:
        count[g["use"]] = count.get(g["use"], 0) + 1
    parts = ", ".join(f"{n} de {USE_LABEL[u]}" for u, n in count.items())
    notes.append(f"Portones industriales: {len(gates)} ({parts}), según la descripción.")
    return True


def check_gates(plant):
    """Errores de portones: fuera de un muro, más anchos que su pared, encimados o con id repetido."""
    poly = outline(plant) or rect_outline(plant)
    edges = poly_edges(poly)
    errs = []
    seen = set()
    spans = []
    for g in plant.get("gates", []):
        if g["id"] in seen:
            errs.append(f"Portón {g['id']} repetido.")
        seen.add(g["id"])
        x, z = float(g["x"]), float(g.get("z", plant["size"]["d"]) if g.get("z") is not None else plant["size"]["d"])
        k, (a, b) = min(enumerate(edges), key=lambda e: seg_dist(x, z, e[1][0][0], e[1][0][1], e[1][1][0], e[1][1][1]))
        if seg_dist(x, z, a[0], a[1], b[0], b[1]) > 0.3:
            errs.append(f"Portón {g['id']} no está sobre un muro exterior.")
            continue
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        s = math.hypot(x - a[0], z - a[1])
        half = float(g.get("w") or GATE_W) / 2
        if s - half < -1e-6 or s + half > L + 1e-6:
            errs.append(f"Portón {g['id']} se sale de su pared.")
        for k2, s2, h2, id2 in spans:
            if k2 == k and abs(s - s2) < half + h2 - 1e-6:
                errs.append(f"Portones {id2} y {g['id']} se enciman.")
        spans.append((k, s, half, g["id"]))
    return errs


def apply_site(plant, t, notes, issues):
    """Medidas y forma del recinto escritas en el texto. True si se tomaron de ahí."""
    span = None
    h = wall_height(t)
    if h:
        plant["wall_h"] = h
        notes.append(f"Paredes de {h:g} m de alto.")
    geo = shape_geometry(t)
    if geo:
        W, D, poly, note, main = geo
        if main:
            plant["_main"] = main  # cuerpo principal: ahí van los pasillos (no se guarda en el plano)
        plant["size"] = {"w": W, "d": D}
        plant["outline"] = poly if len(poly) != 4 or poly != [[0, 0], [W, 0], [W, D], [0, D]] else None
        if plant["outline"] is None:
            plant.pop("outline")
        notes.append(note)
        return True
    else:
        fd = facility_dims(t)
        if fd:
            W, D, span = fd
            plant["size"] = {"w": W, "d": D}
            plant.pop("outline", None)
            if re.search(r"cuadrad", t[span[0]:span[1] + 60]) and W != D:
                issues.append(f"Se pidió un recinto cuadrado pero las medidas son {W:g} x {D:g} m: se respetan las medidas.")
            notes.append(f"El recinto mide {W:g} x {D:g} m, según la descripción.")
            # Forma sin medidas por partes: la misma silueta base del editor.
            from .layout import shape_outline

            for kind, pat in (("L", r"forma de l\b|\ben l\b"), ("U", r"forma de u\b|\ben u\b"), ("T", r"forma de t\b")):
                if re.search(pat, t):
                    plant["outline"] = shape_outline(kind, W, D)
                    notes.append(f"Forma en {kind} con proporciones de base: no se dieron las medidas de cada tramo.")
                    break
    return span is not None


BUILDING_HINT = re.compile(r"^(?:\s+[a-z]+){0,4}?\s+(?:(?:tiene|cuenta con)\s+\d+\s+(?:[a-z]+\s+)?(?:porton|cortina|anden|muelle)|rectangular|cuadrad|en forma de|en [lut]\b|industrial|de \d+(?:[.,]\d+)?\s*(?:m(?:etros?)?\s*)?(?:x|×|por|de largo|de ancho))")


def facility_spans(t):
    """Menciones que son el edificio y no una estación ("construye un almacén rectangular de 60 x 40")."""
    out = []
    fd = facility_dims(t)
    if fd:
        out.append(fd[2])
    for m in re.finditer(r"(?<![a-z])(?:almacen|bodega|nave|recinto)[a-z]*", t):
        if (m.start(), m.end()) in out:
            continue
        tail = t[m.end():m.end() + 80]
        if BUILDING_HINT.match(tail) and (m.group(0).startswith(("nave", "recinto")) or not re.match(r"^\s+de\s+(?:materia|producto|insumo|refaccion|herramienta)", tail)):
            dims = re.match(r"^(?:\s+[a-z]+){0,4}?\s+de\s+" + NUM + r"\s*(?:m(?:etros?)?\s*)?(?:x|×|por)\s*" + NUM, tail)
            if dims and _f(dims.group(1)) * _f(dims.group(2)) < 200 and m.group(0).startswith("almacen"):
                continue
            out.append((m.start(), m.end()))
    return sorted(out)


def mask(t, spans):
    """Cambia el nombre del edificio por 'recinto' para que no se lea como estación."""
    for a, b in sorted(spans, reverse=True):
        t = t[:a] + "recinto" + t[b:]
    return t
