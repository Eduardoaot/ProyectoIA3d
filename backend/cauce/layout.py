"""Distribuciones: acomodo inicial y las tres alternativas de rediseño.

Funciona para cualquier planta: respeta paredes, zonas bloqueadas y portones
que el usuario dibujó. Las alternativas no abren portones ni mueven paredes.

- Flujo en U: las estaciones siguen el orden del flujo por el perímetro, de la
  entrada hacia el fondo y de regreso a la salida.
- Línea recta: el orden del flujo en filas por el centro (en S si no cabe).
- Reordenar en su lugar: las máquinas intercambian sus lugares actuales
  (sin obra) mientras baje el recorrido.
"""

from __future__ import annotations

import math
from functools import lru_cache

from . import units
from .catalog import CLEAN, DIRTY
from .engine import dims, evaluate, gate_pt, gate_x, manhattan, outline, params, point_in_poly, poly_area, poly_edges, rebalance_ops, seg_dist, station_map, zone_rect

GAP = 1.2       # pasillo mínimo entre estaciones (m)
EDGE = 0.4      # separación mínima a las paredes de la bodega (m)
ZONE_GAP = 0.8  # separación mínima a zonas bloqueadas (m)


# ---------- Factibilidad ----------

def _rect(st, x, z, rot):
    w, d = dims(st, rot)
    return (x - w / 2, z - d / 2, x + w / 2, z + d / 2)


def _overlap(a, b, gap):
    return a[0] < b[2] + gap and b[0] < a[2] + gap and a[1] < b[3] + gap and b[1] < a[3] + gap


def _seg_in_rect(x1, z1, x2, z2, x0, y0, xa, ya):
    """¿El segmento entra al rectángulo abierto? (recorte de Liang-Barsky)."""
    t0, t1 = 0.0, 1.0
    dx, dz = x2 - x1, z2 - z1
    for p, q in ((-dx, x1 - x0), (dx, xa - x1), (-dz, z1 - y0), (dz, ya - z1)):
        if p == 0:
            if q <= 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 >= t1:
                return False
    return True


def _hits_wall(r, walls, gap=0.4):
    x0, y0, xa, ya = r[0] - gap, r[1] - gap, r[2] + gap, r[3] + gap
    for w in walls:
        x1, z1, x2, z2 = w["x1"], w["z1"], w["x2"], w["z2"]
        if max(x1, x2) <= x0 or min(x1, x2) >= xa or max(z1, z2) <= y0 or min(z1, z2) >= ya:
            continue
        if _seg_in_rect(x1, z1, x2, z2, x0, y0, xa, ya):
            return True
    return False


@lru_cache(maxsize=64)
def _outline_walls(poly):
    return tuple({"x1": a[0], "z1": a[1], "x2": b[0], "z2": b[1]} for a, b in poly_edges(poly))


_last_outline = (None, None)


def _poly(plant):
    """outline() de la misma lista sin rehacer la tupla en cada prueba (se llama miles de veces)."""
    global _last_outline
    src = plant.get("outline")
    last = _last_outline  # una sola lectura: las peticiones corren en varios hilos
    if last[0] is src:
        return last[1]
    poly = outline(plant)
    _last_outline = (src, poly)
    return poly


def feasible(plant, r, placed):
    W, D = plant["size"]["w"], plant["size"]["d"]
    e = EDGE - 1e-6
    if r[0] < e or r[1] < e or r[2] > W - e or r[3] > D - e:
        return False
    # De la prueba más barata a la más cara.
    if any(_overlap(r, q, GAP) for q in placed):
        return False
    if any(_overlap(r, zone_rect(z), ZONE_GAP) for z in plant.get("zones", [])):
        return False
    if _hits_wall(r, plant.get("walls", [])):
        return False
    poly = _poly(plant)
    if poly:
        # Dentro de la forma de la planta y lejos de su contorno.
        if not all(point_in_poly(poly, x, z) for x, z in ((r[0], r[1]), (r[2], r[1]), (r[0], r[3]), (r[2], r[3]))):
            return False
        if _hits_wall(r, _outline_walls(poly), EDGE):
            return False
    return True


def nearest_free(plant, st, target, placed, prefer_rot=0):
    """El lugar libre más cercano a target, probando las dos orientaciones."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    cands = []
    for rot in (prefer_rot, (prefer_rot + 90) % 180):
        w, d = dims(st, rot)
        nx = int((W - w - 2 * EDGE) / 0.5) + 1
        nz = int((D - d - 2 * EDGE) / 0.5) + 1
        for i in range(max(nx, 0)):
            x = w / 2 + EDGE + i * 0.5
            for j in range(max(nz, 0)):
                z = d / 2 + EDGE + j * 0.5
                cands.append((manhattan((x, z), target) + (0.01 if rot != prefer_rot else 0), x, z, rot))
    cands.sort()
    for _, x, z, rot in cands:
        r = _rect(st, x, z, rot)
        if feasible(plant, r, placed):
            return [round(x, 2), round(z, 2), rot], r
    # No cabe: se deja en el centro para que el usuario lo vea y lo mueva.
    return [W / 2, D / 2, 0], _rect(st, W / 2, D / 2, 0)


# ---------- Orden del flujo ----------

def flow_order(plant):
    """Orden topológico de las estaciones según las rutas (Kahn, desempate por lista)."""
    ids = [s["id"] for s in plant["stations"]]
    idx = {s: i for i, s in enumerate(ids)}
    inc = {s: 0 for s in ids}
    adj = {s: [] for s in ids}
    for r in plant.get("routes", []):
        if r["from"] in adj and r["to"] in inc and r["from"] != r["to"]:
            adj[r["from"]].append(r["to"])
            inc[r["to"]] += 1
    order, ready = [], sorted([s for s in ids if inc[s] == 0], key=idx.get)
    while ready:
        s = ready.pop(0)
        order.append(s)
        for t in adj[s]:
            inc[t] -= 1
            if inc[t] == 0:
                ready.append(t)
                ready.sort(key=idx.get)
    order += [s for s in ids if s not in order]  # ciclos
    return order


def search_cost(plant, positions):
    """Costo rápido para buscar: distancia rectilínea ponderada por el flujo."""
    c = 0.0
    for r in plant.get("routes", []):
        if r["from"] in positions and r["to"] in positions:
            c += float(r.get("frac", 1) or 0) * manhattan(positions[r["from"]], positions[r["to"]])
    kinds = {s["id"]: s["kind"] for s in plant["stations"]}
    # Áreas que ensucian (polvo, ruido, calor) lejos de las que deben quedar limpias.
    dirty = [p for sid, p in positions.items() if kinds.get(sid) in DIRTY]
    if dirty:
        clean = [p for sid, p in positions.items() if kinds.get(sid) in CLEAN] + [(z["x"], z["z"]) for z in plant.get("zones", []) if z["kind"] in CLEAN]
        c += sum(40 for a in dirty for b in clean if manhattan(a, b) < 8)
    for sid, pos in positions.items():
        if kinds.get(sid) == "recepcion":
            c += manhattan(pos, gate_pt(plant, plant.get("receive_gate")))
        if kinds.get(sid) == "despacho":
            c += manhattan(pos, gate_pt(plant, plant.get("dispatch_gate")))
    return c


# ---------- Colocar a lo largo de un trazo ----------

def _point_at(path, s):
    for (x1, z1), (x2, z2) in zip(path, path[1:]):
        L = abs(x2 - x1) + abs(z2 - z1)
        if s <= L:
            t = s / L if L else 0
            return (x1 + (x2 - x1) * t, z1 + (z2 - z1) * t), abs(x2 - x1) > abs(z2 - z1)
        s -= L
    return None, None


def _pin_ends(plant, order, positions, placed):
    """Recepción junto al portón de entrada y despacho junto al de salida."""
    st = station_map(plant)
    rest = []
    for sid in order:
        kind = st[sid]["kind"]
        if kind in ("recepcion", "despacho"):
            w, d = dims(st[sid], 0)
            target = gate_pt(plant, plant.get("receive_gate" if kind == "recepcion" else "dispatch_gate"), d / 2 + EDGE)
            pos, r = nearest_free(plant, st[sid], target, placed)
            positions[sid] = pos
            placed.append(r)
        else:
            rest.append(sid)
    return rest


def fixed_of(plant):
    """Estaciones fijas (locked) con su lugar de hoy: ninguna alternativa las mueve."""
    return {sid: list(plant["layout"][sid]) for sid in units.locked_stations(plant)}


def _seed(plant, fixed):
    st = station_map(plant)
    positions = {k: list(v) for k, v in (fixed or {}).items() if k in st}
    placed = [_rect(st[k], *v) for k, v in positions.items()]
    return positions, placed


def place_along(plant, order, path, fixed=None):
    st = station_map(plant)
    positions, placed = _seed(plant, fixed)
    order = [sid for sid in order if sid not in positions]
    rest = _pin_ends(plant, order, positions, placed)
    total = sum(abs(b[0] - a[0]) + abs(b[1] - a[1]) for a, b in zip(path, path[1:]))
    s = 0.0
    left = []
    for sid in rest:
        x = st[sid]
        long = max(x["w"], x["d"])
        ok = False
        while s + long / 2 <= total:
            pt, horizontal = _point_at(path, s + long / 2)
            # El lado largo sigue la dirección del trazo.
            rot = (0 if x["w"] >= x["d"] else 90) if horizontal else (90 if x["w"] >= x["d"] else 0)
            # Se redondea antes de comprobar, para que lo comprobado sea lo que queda.
            cx, cz = _half(pt[0], dims(x, rot)[0]), _half(pt[1], dims(x, rot)[1])
            r = _rect(x, cx, cz, rot)
            if feasible(plant, r, placed):
                positions[sid] = [cx, cz, rot]
                placed.append(r)
                s += long + GAP
                ok = True
                break
            s += 0.5
        if not ok:
            left.append(sid)
    for sid in left:
        prev = next((positions[o] for o in reversed(order) if o in positions), (plant["size"]["w"] / 2, plant["size"]["d"] / 2))
        pos, r = nearest_free(plant, st[sid], prev, placed)
        positions[sid] = pos
        placed.append(r)
    return positions


def improve_order(plant, order, path, fixed=None):
    """Intercambia estaciones vecinas en el orden mientras baje el costo."""
    order = [sid for sid in order if sid not in (fixed or {})]
    best_pos = place_along(plant, order, path, fixed)
    best = search_cost(plant, best_pos)
    for _ in range(2):
        changed = False
        for i in range(len(order) - 1):
            trial = order[:]
            trial[i], trial[i + 1] = trial[i + 1], trial[i]
            pos = place_along(plant, trial, path, fixed)
            c = search_cost(plant, pos)
            if c < best - 0.5:
                order, best, best_pos, changed = trial, c, pos, True
        if not changed:
            break
    return best_pos


def _half(v, size):
    """Centro en la malla de 0,5 m, de modo que los bordes también caigan en ella si se puede."""
    off = (size / 2) % 0.5
    return round((v - off) * 2) / 2 + off


def _lane(plant):
    shorts = [min(s["w"], s["d"]) for s in plant["stations"]] or [3]
    return math.ceil((EDGE + max(shorts) / 2) * 2) / 2


def u_path(plant):
    """U del ancho justo para las máquinas, centrada entre la entrada y la salida."""
    W, D = plant["size"]["w"], plant["size"]["d"]
    m = _lane(plant)
    rx = gate_x(plant, plant.get("receive_gate"))
    dx = gate_x(plant, plant.get("dispatch_gate"))
    pinned = {"recepcion", "despacho"}
    needed = sum(max(s["w"], s["d"]) + GAP for s in plant["stations"] if s["kind"] not in pinned)
    arm = max(0.0, D - 2 * m)
    width = min(W - 2 * m, max(2 * m + 2 * GAP, needed - 2 * arm, abs(rx - dx)))
    left = min(max(m, (rx + dx) / 2 - width / 2), W - m - width)
    right = left + width
    left_first = rx < dx or (rx == dx and rx <= W / 2)
    path = [(left, D - m), (left, m), (right, m), (right, D - m)]
    return path if left_first else list(reversed(path))


def line_path(plant):
    W, D = plant["size"]["w"], plant["size"]["d"]
    m = _lane(plant)
    rx = gate_x(plant, plant.get("receive_gate"))
    z1 = D * 0.42
    row = 2 * (m - EDGE) + 2 * GAP + 1
    z2 = z1 + row if z1 + row <= D - m else max(m, z1 - row)
    path = [(m, z1), (W - m, z1), (W - m, z2), (m, z2)]
    return path if rx <= W / 2 else [(W - x, z) for x, z in path]


def keep_swap(plant, positions):
    """Reordenar en su lugar: intercambia lugares mientras baje el recorrido."""
    st = station_map(plant)
    pos = {k: list(v) for k, v in positions.items()}
    best = search_cost(plant, pos)
    locked = set(units.locked_stations(plant))
    ids = [s for s in pos if s in st]
    movable = [s for s in ids if s not in locked]
    for _ in range(4):
        changed = False
        for i in range(len(movable)):
            for j in range(i + 1, len(movable)):
                a, b = movable[i], movable[j]
                for ra in (pos[b][2], (pos[b][2] + 90) % 180):
                    for rb in (pos[a][2], (pos[a][2] + 90) % 180):
                        trial = dict(pos)
                        trial[a] = [pos[b][0], pos[b][1], ra]
                        trial[b] = [pos[a][0], pos[a][1], rb]
                        others = [_rect(st[k], *trial[k]) for k in ids if k not in (a, b)]
                        ka = _rect(st[a], *trial[a])
                        kb = _rect(st[b], *trial[b])
                        if not (feasible(plant, ka, others) and feasible(plant, kb, others + [ka])):
                            continue
                        c = search_cost(plant, trial)
                        if c < best - 0.5:
                            pos, best, changed = trial, c, True
                            break
                    else:
                        continue
                    break
        if not changed:
            break
    return pos


def initial_layout(plant):
    """Acomodo inicial a partir de la historia: filas en el orden del flujo.
    No pretende ser la planta real: el usuario la corrige en el editor."""
    st = station_map(plant)
    W, D = plant["size"]["w"], plant["size"]["d"]
    positions, placed = {}, []
    x, z, row_d = EDGE + 0.5, EDGE + 0.5, 0.0
    for sid in flow_order(plant):
        s = st[sid]
        w, d = dims(s, 0)
        if x + w > W - EDGE:
            x, z, row_d = EDGE + 0.5, z + row_d + 2.5, 0.0
        target = (x + w / 2, z + d / 2)
        pos, r = nearest_free(plant, s, target, placed)
        positions[sid] = pos
        placed.append(r)
        x += w + 2.5
        row_d = max(row_d, d)
    return positions


# ---------- Formas de planta ----------

def plant_area(plant):
    poly = outline(plant)
    return round(poly_area(poly) if poly else plant["size"]["w"] * plant["size"]["d"], 1)


def shape_outline(kind, W, D):
    """Las mismas formas base que ofrece el editor. None es el rectángulo completo."""
    def r(v):
        return round(v * 2) / 2

    if kind == "L":
        return [[0, 0], [r(W * 0.5), 0], [r(W * 0.5), r(D * 0.5)], [W, r(D * 0.5)], [W, D], [0, D]]
    if kind == "U":
        return [[0, 0], [r(W * 0.33), 0], [r(W * 0.33), r(D * 0.55)], [r(W * 0.67), r(D * 0.55)], [r(W * 0.67), 0], [W, 0], [W, D], [0, D]]
    if kind == "T":
        return [[0, 0], [W, 0], [W, r(D * 0.45)], [r(W * 0.68), r(D * 0.45)], [r(W * 0.68), D], [r(W * 0.32), D], [r(W * 0.32), r(D * 0.45)], [0, r(D * 0.45)]]
    if kind == "triangulo":
        return [[r(W / 2), 0], [W, D], [0, D]]
    if kind == "circulo":
        return [[round(W / 2 + math.cos(i / 28 * 2 * math.pi) * W / 2, 2), round(D / 2 + math.sin(i / 28 * 2 * math.pi) * D / 2, 2)] for i in range(28)]
    return None


# ---------- Alternativas ----------

ALTERNATIVES = [
    ("u", "Flujo en U", "El material entra, recorre el perímetro hacia el fondo y regresa a la salida.", "Mover máquinas al perímetro.", 1),
    ("i", "Línea recta", "Las estaciones en fila por el centro, en el orden del proceso.", "Mover máquinas al centro.", 1),
    ("keep", "Reordenar en su lugar", "Las máquinas intercambian sus lugares actuales; nada de obra.", "Solo intercambiar máquinas de lugar.", 0),
]


def collisions(plant, positions):
    """Estaciones que quedaron encimadas o fuera de la bodega (no hubo lugar para ellas)."""
    st = station_map(plant)
    W, D = plant["size"]["w"], plant["size"]["d"]
    rects = {k: _rect(st[k], *v) for k, v in positions.items() if k in st}
    bad = set()
    for k, r in rects.items():
        if r[0] < -1e-6 or r[1] < -1e-6 or r[2] > W + 1e-6 or r[3] > D + 1e-6:
            bad.add(k)
        if any(_overlap(r, zone_rect(z), 0) for z in plant.get("zones", [])):
            bad.add(k)
    ks = list(rects)
    for i, a in enumerate(ks):
        for b in ks[i + 1:]:
            if _overlap(rects[a], rects[b], -1e-6):
                bad.update((a, b))
    return bad


def locked_respected(plant, positions):
    return all(positions.get(sid, [None])[:3] == list(plant["layout"][sid])[:3] for sid in units.locked_stations(plant))


def _build(plant, aid, order, fixed):
    if aid == "u":
        return improve_order(plant, order, u_path(plant), fixed)
    if aid == "i":
        return improve_order(plant, order, line_path(plant), fixed)
    return keep_swap(plant, plant["layout"])


def alternatives(plant):
    order = flow_order(plant)
    fixed = fixed_of(plant)
    fixed_names = [x["name"] for x in units.locked_items(plant) if x["type"] != "conveyor"]
    st = station_map(plant)
    out = []
    for aid, name, summary, works, cost in ALTERNATIVES:
        pos = _build(plant, aid, order, fixed)
        ops = rebalance_ops(plant, pos) if plant.get("use_assumptions") else None
        m = evaluate(plant, pos, ops)
        alt = {"id": aid, "name": name, "summary": summary, "works": works, "works_cost": cost, "positions": pos, "metrics": m, "locked_respected": locked_respected(plant, pos)}
        bad = collisions(plant, pos) - set(fixed)
        if bad and aid != "keep":
            names = ", ".join(sorted(st[k]["name"] for k in bad))
            alt["infeasible"] = {"stations": sorted(st[k]["name"] for k in bad), "blocked_by": [], "text": f"No hay lugar para {names} con este acomodo: quedan encimadas."}
            # ¿Cabe sin los fijos? Entonces son ellos los que lo impiden (criterios §3.3).
            if fixed and not collisions(plant, _build({**plant, "stations": [{**s, "locked": False} for s in plant["stations"]]}, aid, order, {})):
                alt["infeasible"].update(blocked_by=fixed_names, text=f"No hay lugar para {names} sin mover lo fijo: " + ", ".join(fixed_names) + ".")
        out.append(alt)
    return out


def score(cur, m, works_cost, use_assumptions):
    if not use_assumptions or "daily_m" not in cur:
        return round(m["piece_m"] / max(cur["piece_m"], 1e-6) + 0.03 * works_cost + 0.2 * len(m["avoid_hits"]), 3)
    s = 0.35 * m["daily_m"] / max(cur["daily_m"], 1e-6) + 0.05 * works_cost + 0.1 * len(m["avoid_hits"])
    if cur.get("capacity") and m.get("capacity"):
        s += 0.25 * cur["capacity"] / m["capacity"]
    if cur.get("lead_h") and m.get("lead_h"):
        s += 0.2 * m["lead_h"] / cur["lead_h"]
    if cur.get("loading_min") and m.get("loading_min"):
        s += 0.1 * m["loading_min"] / cur["loading_min"]
    return round(s, 3)


def ops_moves(plant, ops):
    if not ops:
        return []
    out = []
    for s in plant["stations"]:
        before = int(s.get("ops", 0) or 0)
        after = ops.get(s["id"], 0)
        if before != after:
            out.append({"id": s["id"], "name": s["name"], "before": before, "after": after})
    return out


__all__ = ["alternatives", "initial_layout", "score", "ops_moves", "flow_order", "params", "seg_dist"]
