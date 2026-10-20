"""Flujos separados, retornos y bandas (H3, contrato v3 §4.3 y §4.4).

- Cada ruta tiene `flow`: material (la pieza), personas, vehiculos o carga. Las métricas
  de siempre (metros por pieza, metros al día, capacidad, tiempo) son del material; cada
  flujo tiene además sus propios metros en `flows`.
- `is_return` marca un regreso (por ejemplo pruebas → configuración): es una arista de
  regreso, no cambia el orden del proceso. Los ciclos se detectan con componentes
  fuertemente conexas (Tarjan) y no se mandan al final del orden.
- Una ruta con `conveyor` viaja en la banda: su tramo usa la longitud y la velocidad de
  la banda, y nadie camina ese tramo (no suma a los metros de manejo al día).
"""

from __future__ import annotations

import math

FLOWS = ("material", "personas", "vehiculos", "carga")
# Peso de cada flujo en el costo de búsqueda de las alternativas.
SEARCH_WEIGHT = {"material": 1.0, "carga": 1.0, "vehiculos": 0.5, "personas": 0.3}


def flow_of(r: dict) -> str:
    f = r.get("flow") or "material"
    return f if f in FLOWS else "material"


def is_material(r: dict) -> bool:
    return flow_of(r) == "material"


def material_routes(plant: dict) -> list[dict]:
    return [r for r in plant.get("routes", []) if is_material(r)]


# ---------- Bandas ----------

def conveyors(plant: dict) -> dict:
    out = {}
    for c in plant.get("conveyors", []) or []:
        pts = c.get("points") or []
        if c.get("id") and len(pts) >= 2:
            out[c["id"]] = c
    return out


def poly_len(pts) -> float:
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def belt_leg(positions: dict, r: dict, belt: dict):
    """Tramo en banda: de la estación al inicio de la banda, la banda, y del final a la estación.
    Las puntas se cuentan en línea rectilínea (son tramos cortos de carga y descarga)."""
    a, b = positions[r["from"]], positions[r["to"]]
    pts = [list(p) for p in belt["points"]]
    reach = abs(a[0] - pts[0][0]) + abs(a[1] - pts[0][1]) + abs(b[0] - pts[-1][0]) + abs(b[1] - pts[-1][1])
    on = poly_len(pts)
    path = [[round(a[0], 2), round(a[1], 2)]] + [[round(x, 2), round(z, 2)] for x, z in pts] + [[round(b[0], 2), round(b[1], 2)]]
    return on + reach, on, path


# ---------- Ciclos y orden ----------

def scc(ids: list[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    """Componentes fuertemente conexas (Tarjan, iterativo)."""
    adj = {k: [] for k in ids}
    for a, b in edges:
        if a in adj and b in adj:
            adj[a].append(b)
    index, low, on, stack, out = {}, {}, set(), [], []
    counter = [0]
    for root in ids:
        if root in index:
            continue
        work = [(root, 0)]
        while work:
            v, i = work.pop()
            if i == 0:
                index[v] = low[v] = counter[0]
                counter[0] += 1
                stack.append(v)
                on.add(v)
            if i < len(adj[v]):
                work.append((v, i + 1))
                w = adj[v][i]
                if w not in index:
                    work.append((w, 0))
                elif w in on:
                    low[v] = min(low[v], index[w])
                continue
            for w in adj[v]:
                if w in on:
                    low[v] = min(low[v], low[w])
            if low[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                out.append(comp)
    return out


def ordered(plant: dict) -> list[str]:
    """Orden del proceso: topológico sobre las componentes fuertemente conexas del flujo de
    material, sin los retornos. Dentro de un ciclo se respeta el orden de la lista. Así un
    regreso (pruebas → configuración) no manda estaciones al final."""
    ids = [s["id"] for s in plant["stations"]]
    idx = {s: i for i, s in enumerate(ids)}
    edges = [(r["from"], r["to"]) for r in material_routes(plant) if not r.get("is_return") and r["from"] != r["to"]]
    comps = scc(ids, edges)
    comp_of = {k: i for i, c in enumerate(comps) for k in c}
    for c in comps:
        c.sort(key=idx.get)
    n = len(comps)
    inc = [0] * n
    adj = [set() for _ in range(n)]
    for a, b in edges:
        ca, cb = comp_of.get(a), comp_of.get(b)
        if ca is not None and cb is not None and ca != cb and cb not in adj[ca]:
            adj[ca].add(cb)
            inc[cb] += 1
    ready = sorted((i for i in range(n) if inc[i] == 0), key=lambda i: idx[comps[i][0]])
    order = []
    while ready:
        i = ready.pop(0)
        order += comps[i]
        for j in adj[i]:
            inc[j] -= 1
            if inc[j] == 0:
                ready.append(j)
        ready.sort(key=lambda i: idx[comps[i][0]])
    return order + [k for k in ids if k not in order]


def cycles(plant: dict) -> list[list[str]]:
    """Ciclos del flujo de material, con los retornos incluidos (lo que se dibuja como regreso)."""
    ids = [s["id"] for s in plant["stations"]]
    idx = {s: i for i, s in enumerate(ids)}
    edges = [(r["from"], r["to"]) for r in material_routes(plant) if r["from"] != r["to"]]
    return [sorted(c, key=idx.get) for c in scc(ids, edges) if len(c) > 1]


def has_cycles_without_returns(plant: dict) -> bool:
    ids = [s["id"] for s in plant["stations"]]
    edges = [(r["from"], r["to"]) for r in material_routes(plant) if not r.get("is_return") and r["from"] != r["to"]]
    return any(len(c) > 1 for c in scc(ids, edges))
