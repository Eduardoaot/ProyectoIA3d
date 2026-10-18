"""Motor de ingeniería de procesos.

Todo es determinista y trazable: la IA lee la historia y conversa, pero los
números salen de estas fórmulas.

- Recorridos: ruta más corta por pasillos en una malla de 0,5 m que esquiva
  máquinas, zonas bloqueadas (oficina, baños...) y paredes en cualquier ángulo.
  Si la planta tiene una forma propia (L, U, círculo...), no sale de ella.
- Sin supuestos: solo metros que recorre una pieza y relaciones entre áreas.
- Con supuestos: viajes al día, carga y capacidad por estación, cuello de
  botella, tiempo de fabricación (colas con Sakasegawa) y carga de camiones.
"""

from __future__ import annotations

import heapq
import math
from functools import lru_cache

from . import units
from .catalog import CLEAN, DEFAULT_PARAMS, DIRTY

STEP = 0.5      # resolución de la malla (m)
MARGIN = 0.25   # holgura alrededor de cada obstáculo (m)
TURN = 1.0      # castigo por giro (m): prefiere pasillos rectos
WALL_T = 0.3    # grosor de las paredes interiores (m)


# ---------- Geometría ----------

def station_map(plant):
    return {s["id"]: s for s in plant["stations"]}


def dims(st, rot):
    return (st["d"], st["w"]) if round(rot or 0) % 180 else (st["w"], st["d"])


def rect_at(st, pos):
    x, z, *r = pos
    w, d = dims(st, r[0] if r else 0)
    return (x - w / 2, z - d / 2, x + w / 2, z + d / 2)


def zone_rect(zn):
    return (zn["x"] - zn["w"] / 2, zn["z"] - zn["d"] / 2, zn["x"] + zn["w"] / 2, zn["z"] + zn["d"] / 2)


def rect_gap(a, b):
    """Distancia entre dos rectángulos (0 si se tocan o se cruzan)."""
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dz = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return math.hypot(dx, dz)


def seg_dist(px, pz, x1, z1, x2, z2):
    vx, vz = x2 - x1, z2 - z1
    L = vx * vx + vz * vz
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - x1) * vx + (pz - z1) * vz) / L))
    return math.hypot(px - (x1 + t * vx), pz - (z1 + t * vz))


# ---------- Forma de la planta ----------

def outline(plant):
    """Contorno propio de la planta o None si es el rectángulo completo."""
    o = plant.get("outline")
    return tuple((float(p[0]), float(p[1])) for p in o) if o and len(o) >= 3 else None


def rect_outline(plant):
    W, D = plant["size"]["w"], plant["size"]["d"]
    return ((0.0, 0.0), (W, 0.0), (W, D), (0.0, D))


def poly_edges(poly):
    return [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]


def poly_area(poly):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in poly_edges(poly))) / 2


def point_in_poly(poly, x, z):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def gate_pt(plant, gate_id, inset=None):
    """Centro del portón sobre el contorno. Con inset se mete hacia adentro (para llegar a él sin cruzar el muro)."""
    gates = plant.get("gates", [])
    g = next((q for q in gates if q["id"] == gate_id), gates[0] if gates else None)
    W, D = plant["size"]["w"], plant["size"]["d"]
    if not g:
        return (W / 2, D)
    x, z = float(g["x"]), float(g.get("z", D) if g.get("z") is not None else D)
    poly = outline(plant) or rect_outline(plant)
    area2 = sum(a[0] * b[1] - b[0] * a[1] for a, b in poly_edges(poly))
    sign = 1 if area2 >= 0 else -1
    best = None
    for a, b in poly_edges(poly):
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
        dx, dz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        t = L / 2 if L < 4.4 else min(L - 2.2, max(2.2, (x - a[0]) * dx + (z - a[1]) * dz))
        px, pz = a[0] + dx * t, a[1] + dz * t
        d = math.hypot(px - x, pz - z)
        if best is None or d < best[0]:
            best = (d, px, pz, (sign * dz, -sign * dx))
    _, px, pz, n = best
    if inset is None:
        inset = 0.75 if outline(plant) else 0.0
    return (px - n[0] * inset, pz - n[1] * inset)


def obstacles(plant, positions, skip=()):
    st = station_map(plant)
    rects = []
    for sid, pos in positions.items():
        if sid in skip or sid not in st:
            continue
        rects.append(tuple(round(v, 2) for v in rect_at(st[sid], pos)))
    for zn in plant.get("zones", []):
        rects.append(tuple(round(v, 2) for v in zone_rect(zn)))
    segs = tuple((w["x1"], w["z1"], w["x2"], w["z2"]) for w in plant.get("walls", []))
    poly = outline(plant)
    if poly:
        # El contorno funciona como un muro más.
        segs += tuple((a[0], a[1], b[0], b[1]) for a, b in poly_edges(poly))
    return tuple(rects), segs


# ---------- Enrutamiento por pasillos ----------

def _crosses(n1, n2, s):
    """¿El paso entre dos nodos vecinos cruza la pared s?"""
    ax, az, bx, bz = n1[0] * STEP, n1[1] * STEP, n2[0] * STEP, n2[1] * STEP
    x1, z1, x2, z2 = s

    def orient(px, pz, qx, qz, rx, rz):
        v = (qx - px) * (rz - pz) - (qz - pz) * (rx - px)
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)

    o1, o2 = orient(ax, az, bx, bz, x1, z1), orient(ax, az, bx, bz, x2, z2)
    o3, o4 = orient(x1, z1, x2, z2, ax, az), orient(x1, z1, x2, z2, bx, bz)
    return o1 != o2 and o3 != o4


DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


@lru_cache(maxsize=64)
def _base_grid(W, D, segs, poly):
    """Lo que no cambia entre un recorrido y otro de la misma planta: nodos fuera
    del contorno o pegados a una pared, y los pasos que cruzan una pared.
    Se calcula una sola vez por forma y paredes (antes se repetía en cada paso)."""
    nx, ny = int(W / STEP), int(D / STEP)
    blocked = set()
    if poly:
        for i in range(nx + 1):
            for j in range(ny + 1):
                if not point_in_poly(poly, i * STEP, j * STEP):
                    blocked.add((i, j))
    r = WALL_T / 2 + MARGIN
    cut = set()
    for s in segs:
        x1, z1, x2, z2 = s
        i0, i1 = max(0, math.floor((min(x1, x2) - r) / STEP)), min(nx, math.ceil((max(x1, x2) + r) / STEP))
        j0, j1 = max(0, math.floor((min(z1, z2) - r) / STEP)), min(ny, math.ceil((max(z1, z2) + r) / STEP))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                if seg_dist(i * STEP, j * STEP, x1, z1, x2, z2) <= r:
                    blocked.add((i, j))
        # Solo los pasos cerca de la pared pueden cruzarla.
        for i in range(max(0, math.floor(min(x1, x2) / STEP) - 1), min(nx, math.ceil(max(x1, x2) / STEP) + 1) + 1):
            for j in range(max(0, math.floor(min(z1, z2) / STEP) - 1), min(ny, math.ceil(max(z1, z2) / STEP) + 1) + 1):
                for dx, dy in ((1, 0), (0, 1)):
                    n = (i + dx, j + dy)
                    if n[0] <= nx and n[1] <= ny and _crosses((i, j), n, s):
                        cut.add(((i, j), n))
                        cut.add((n, (i, j)))
    return nx, ny, frozenset(blocked), frozenset(cut)


@lru_cache(maxsize=16384)
def _route(W, D, rects, segs, a, b, poly=None):
    nx, ny, base, cut = _base_grid(W, D, segs, poly)
    blocked = set(base)
    for x0, y0, x1, y1 in rects:
        for i in range(max(0, math.ceil((x0 - MARGIN) / STEP + 1e-9)), min(nx, math.floor((x1 + MARGIN) / STEP - 1e-9)) + 1):
            for j in range(max(0, math.ceil((y0 - MARGIN) / STEP + 1e-9)), min(ny, math.floor((y1 + MARGIN) / STEP - 1e-9)) + 1):
                blocked.add((i, j))

    def clip(v, n):
        return max(0, min(n, round(v / STEP)))

    start = (clip(a[0], nx), clip(a[1], ny))
    goal = (clip(b[0], nx), clip(b[1], ny))
    gx, gy = goal

    # A*: la distancia rectilínea al destino nunca sobreestima, así el camino sigue siendo el más corto.
    def h(n):
        return (abs(n[0] - gx) + abs(n[1] - gy)) * STEP

    best = {(start, -1): 0.0}
    parent = {}
    heap = [(h(start), 0.0, start, -1)]
    end = None
    while heap:
        _, c, node, d = heapq.heappop(heap)
        if best.get((node, d), 1e18) < c:
            continue
        if node == goal:
            end = (node, d)
            break
        for k, (dx, dy) in enumerate(DIRS):
            n = (node[0] + dx, node[1] + dy)
            if not (0 <= n[0] <= nx and 0 <= n[1] <= ny) or (n in blocked and n != goal):
                continue
            # Una pared no se cruza ni siquiera saliendo de una máquina.
            if (node, n) in cut:
                continue
            nc = c + STEP + (TURN if d not in (-1, k) else 0.0)
            if nc < best.get((n, k), 1e18):
                best[(n, k)] = nc
                parent[(n, k)] = (node, d)
                heapq.heappush(heap, (nc + h(n), nc, n, k))
    if end is None:
        return None
    nodes = [end[0]]
    cur = end
    while cur in parent:
        cur = parent[cur]
        nodes.append(cur[0])
    nodes.reverse()
    pts = [(a[0], a[1])]
    for i in range(1, len(nodes) - 1):
        p0, p1, p2 = nodes[i - 1], nodes[i], nodes[i + 1]
        if (p1[0] - p0[0], p1[1] - p0[1]) != (p2[0] - p1[0], p2[1] - p1[1]):
            pts.append((p1[0] * STEP, p1[1] * STEP))
    pts.append((b[0], b[1]))
    out = [pts[0]]
    for q in pts[1:]:
        p = out[-1]
        if p[0] != q[0] and p[1] != q[1]:
            out.append((q[0], p[1]))
        out.append(q)
    return tuple(out)


def _path(plant, rects, segs, a, b):
    pts = _route(plant["size"]["w"], plant["size"]["d"], rects, segs, (a[0], a[1]), (b[0], b[1]), outline(plant))
    ok = pts is not None
    if not ok:
        pts = ((a[0], a[1]), (b[0], a[1]), (b[0], b[1]))
    dist = sum(abs(q[0] - p[0]) + abs(q[1] - p[1]) for p, q in zip(pts, pts[1:]))
    return dist, [[round(x, 2), round(y, 2)] for x, y in pts], ok


def route_leg(plant, positions, a_id, b_id):
    rects, segs = obstacles(plant, positions, {a_id, b_id})
    return _path(plant, rects, segs, positions[a_id], positions[b_id])


def route_to_point(plant, positions, a_id, point):
    rects, segs = obstacles(plant, positions, {a_id})
    return _path(plant, rects, segs, positions[a_id], point)


def manhattan(a, b):
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


# ---------- Flujo ----------

def valid_routes(plant, positions):
    return [r for r in plant.get("routes", []) if r["from"] in positions and r["to"] in positions and r["from"] != r["to"]]


def shares(plant):
    """Fracción de las piezas que pasa por cada estación, según las rutas."""
    inc = {}
    for r in plant.get("routes", []):
        inc[r["to"]] = inc.get(r["to"], 0.0) + float(r.get("frac", 1) or 0)
    return {s["id"]: min(1.0, inc[s["id"]]) if s["id"] in inc else 1.0 for s in plant["stations"]}


def ends(plant):
    """Estación donde entra el material y estación donde sale."""
    ids = [s["id"] for s in plant["stations"]]
    kinds = {s["id"]: s["kind"] for s in plant["stations"]}
    inc = {r["to"] for r in plant.get("routes", [])}
    out = {r["from"] for r in plant.get("routes", [])}
    first = next((i for i in ids if kinds[i] == "recepcion"), None) or next((i for i in ids if i in out and i not in inc), None)
    last = next((i for i in ids if kinds[i] == "despacho"), None) or next((i for i in reversed(ids) if i in inc and i not in out), None)
    return first, last


def gate_x(plant, gate_id):
    return gate_pt(plant, gate_id)[0]


def params(plant):
    return {**DEFAULT_PARAMS, **(plant.get("params") or {})}


def sakasegawa_wq(rho, c, te, cv2):
    """Espera promedio en cola (min) para c servidores con utilización rho."""
    r = min(rho, 0.985)
    if r <= 0 or c <= 0:
        return 0.0
    return (cv2 + cv2) / 2 * (r ** (math.sqrt(2 * (c + 1)) - 1)) / (c * (1 - r)) * te


def avoid_hits(plant, positions):
    """Áreas sucias (polvo, ruido, calor) a menos de 4 m de áreas limpias."""
    st = station_map(plant)
    items = [(sid, st[sid]["name"], st[sid]["kind"], rect_at(st[sid], p)) for sid, p in positions.items() if sid in st]
    items += [(z["id"], z["name"], z["kind"], zone_rect(z)) for z in plant.get("zones", [])]
    hits = []
    for a in items:
        if a[2] not in DIRTY:
            continue
        for b in items:
            if b[2] in CLEAN and rect_gap(a[3], b[3]) < 4:
                hits.append({"a": a[0], "b": b[0], "text": f"{a[1]} queda junto a {b[1]}"})
    return hits


def evaluate(plant, positions, ops=None):
    """Métricas de un layout. Sin supuestos solo calcula recorridos."""
    st = station_map(plant)
    legs = []
    piece_m = 0.0
    for r in valid_routes(plant, positions):
        d, path, ok = route_leg(plant, positions, r["from"], r["to"])
        frac = float(r.get("frac", 1) or 0)
        piece_m += frac * d
        legs.append({"id": r["id"], "from": r["from"], "to": r["to"], "frac": frac, "dist": round(d, 1), "path": path, "ok": ok, "meters": round(frac * d, 1)})

    out = {
        "legs": legs,
        "piece_m": round(piece_m, 1),
        "avoid_hits": avoid_hits(plant, positions),
        "blocked_legs": sum(1 for x in legs if not x["ok"]),
        "use_assumptions": bool(plant.get("use_assumptions")),
    }
    if not plant.get("use_assumptions") or not plant["stations"]:
        return out

    p = params(plant)
    ops = {**{s["id"]: units.operators(s) for s in plant["stations"]}, **(ops or {})}
    avail = p["shift_min"] * p["efficiency"]
    share = shares(plant)
    demand = max(float(p["demand"]), 1e-6)
    handling = {sid: 0.0 for sid in st}
    daily_m = 0.0
    for leg in legs:
        trips = demand * leg["frac"] / p["batch"]
        leg["trips"] = round(trips, 1)
        leg["meters"] = round(trips * leg["dist"], 1)
        daily_m += trips * leg["dist"]
        handling[leg["from"]] += trips * 2 * leg["dist"] / p["speed"]

    stations = []
    for s in plant["stations"]:
        sid = s["id"]
        t = units.machine_time(s)
        load = demand * share[sid] * t + handling[sid]
        n = ops.get(sid, 0)
        # Cada operario es un servidor; sin operarios, cada una de las N máquinas (units.servers).
        servers = units.servers(s, n)
        if servers == 0 or load <= 0:
            continue
        util = load / (servers * avail)
        row = {
            "id": sid, "name": s["name"], "ops": n, "auto": n == 0, "servers": servers,
            "load_min": round(load, 1), "handling_min": round(handling[sid], 1),
            "util": round(util, 4), "required": round(load / avail, 2), "capacity": round(servers * avail / (load / demand), 1),
        }
        if units.has_count(s):
            row["count"] = units.count(s)
        stations.append(row)
    stations.sort(key=lambda x: -x["util"])

    takt = avail / demand
    proc = sum(units.stay_time(s) * share[s["id"]] for s in plant["stations"])
    queue = 0.0
    for x in stations:
        sh = max(share[x["id"]], 1e-9)
        te = x["load_min"] / (demand * sh)
        queue += sakasegawa_wq(x["util"], max(x["servers"], 1), te, p["cv2"]) * sh
    batch_wait = sum((p["batch"] - 1) / 2 * takt * min(1.0, leg["frac"]) for leg in legs)
    # Horno o secado por lote: la pieza espera a que se junte el lote (criterios §3.4). No es tiempo de máquina.
    fill_wait = sum((b["size"] - 1) / 2 * takt * share[s["id"]] for s in plant["stations"] if (b := units.batch(s)))
    transport = sum(leg["frac"] * leg["dist"] / p["speed"] for leg in legs)
    lead_min = proc + queue + batch_wait + fill_wait + transport

    parts = {"proceso": round(proc, 1), "cola": round(queue, 1), "lote": round(batch_wait, 1), "transporte": round(transport, 1)}
    if fill_wait:
        parts["espera_lote"] = round(fill_wait, 1)
    out.update({
        "daily_m": round(daily_m, 0),
        "demand": p["demand"],
        "lead_h": round(lead_min / 60, 2),
        "lead_parts": parts,
        "stations": stations,
        "ops": ops,
    })
    if stations:
        out.update({"bottleneck": stations[0]["id"], "bottleneck_util": stations[0]["util"], "capacity": round(min(x["capacity"] for x in stations), 1)})

    first, last = ends(plant)
    if last and last in positions:
        dt, _, _ = route_to_point(plant, positions, last, gate_pt(plant, plant.get("dispatch_gate")))
        out["d_truck"] = round(dt, 1)
        out["loading_min"] = round(p["trucks"] * p["truck_setup"] + p["demand"] * (p["load_min"] + 2 * dt / p["speed"]), 0)
    return out


def rebalance_ops(plant, positions):
    """Reparte los mismos operarios para maximizar la capacidad."""
    # Las estaciones con varias máquinas tienen sus operarios atados a ellas: no entran al reparto.
    free = [s for s in plant["stations"] if units.count(s) == 1]
    total = sum(int(s.get("ops", 0) or 0) for s in free)
    working = [s["id"] for s in free if units.machine_time(s) > 0 and int(s.get("ops", 0) or 0) > 0]
    if not working or total < len(working):
        return None
    ops = {s["id"]: (units.operators(s) if units.count(s) > 1 else 0) for s in plant["stations"]}
    for sid in working:
        ops[sid] = 1
    for _ in range(total - len(working)):
        bn = evaluate(plant, positions, ops).get("bottleneck")
        if bn not in working:
            break
        ops[bn] += 1
    return ops


# ---------- Relaciones entre áreas ----------

def relations(plant):
    """Tabla de relaciones (A, E, I, O, U, X). No depende de supuestos."""
    zones = [z for z in plant.get("zones", []) if z["kind"] not in ("bloqueado", "obstaculo")]
    ids = [s["id"] for s in plant["stations"]] + [z["id"] for z in zones]
    names = {s["id"]: s["name"] for s in plant["stations"]}
    names.update({z["id"]: z["name"] for z in zones})
    kinds = {s["id"]: s["kind"] for s in plant["stations"]}
    kinds.update({z["id"]: z["kind"] for z in zones})
    flow = {}
    for r in plant.get("routes", []):
        k = tuple(sorted([r["from"], r["to"]]))
        flow[k] = flow.get(k, 0) + float(r.get("frac", 1) or 0)
    top = max(flow.values()) if flow else 1
    cells = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            k = tuple(sorted([a, b]))
            ka, kb = kinds[a], kinds[b]
            if (ka in DIRTY and kb in CLEAN) or (kb in DIRTY and ka in CLEAN):
                dirty = names[a] if ka in DIRTY else names[b]
                r, why = "X", f"El polvo, ruido o calor de {dirty.lower()} afecta al área"
            elif k in flow:
                ratio = flow[k] / top
                r = "A" if ratio >= 0.6 else "E" if ratio >= 0.3 else "I"
                why = f"El material pasa directo ({round(flow[k] * 100)} % de las piezas)"
            elif {ka, kb} == {"oficina", "despacho"}:
                r, why = "I", "Remisiones y facturas de cada salida"
            elif {ka, kb} == {"oficina", "recepcion"}:
                r, why = "O", "Verificar lo que llega"
            else:
                r, why = "U", "Sin relación directa"
            cells.append({"a": a, "b": b, "r": r, "why": why})
    return {"ids": ids, "names": names, "cells": cells}


def compare(a, b):
    out = {}
    for k in ("piece_m", "daily_m", "capacity", "lead_h", "loading_min"):
        x, y = a.get(k), b.get(k)
        if x is None or y is None:
            continue
        out[k] = {"before": x, "after": y, "pct": round((y - x) / x * 100) if x else 0}
    return out
