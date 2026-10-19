"""Procesos que se ramifican: familias de máquinas iguales, reparto y convergencia.

"10 bobinadoras pasan a 10 armados" ya no es un bloque ×10 con una sola ruta: son 10
estaciones de la misma familia (`family`, `family_name`, `lane`), cada una con sus rutas.

- Reparto equilibrado entre familias: si son iguales, 1 a 1 (bobinado 3 → armado 3); si
  no, se reparten parejo (10 → 4: bobinado 1 a 3 → armado 1, 4 y 5 → armado 2…).
- La fracción de cada ruta es la parte de las piezas que pasa por ella: la de la ruta
  original dividida entre las ramas, así cada rama lleva 1/N y la convergencia suma 100 %.
- Ensamble: si a una estación le llega más del 100 % (núcleo y bobina entran a armado),
  la entrada que viene de más atrás en el proceso es un componente (`component: true`).
  Su traslado se cuenta en metros, pero no suma piezas a la estación.
- Convergencia en banda: si la historia menciona una banda, las ramas que convergen en
  una estación descargan en una banda común (`conveyors`), como en un dibujo de planta.
"""

from __future__ import annotations

from . import flows, units

MAX_EXPAND = 20  # más máquinas iguales que esto siguen siendo un bloque ×N
MIN_BELT = 3  # ramas desde las que una convergencia va en banda


def pairs(n: int, m: int) -> list[tuple[int, int]]:
    """Índices (origen, destino) del reparto equilibrado de n ramas a m ramas."""
    if n == m:
        return [(i, i) for i in range(n)]
    if n > m:
        return [(i, i * m // n) for i in range(n)]
    return [(j * n // m, j) for j in range(m)]


def expand_station(s: dict, start: int) -> list[dict]:
    """Las N máquinas de una estación con count como N estaciones de una familia."""
    n = units.count(s)
    unit_w, unit_d = s.get("unit_w", s["w"]), s.get("unit_d", s["d"])
    per_unit = units.ops_per_unit(s)
    out = []
    for i in range(n):
        m = {k: v for k, v in s.items() if k not in ("count", "unit_w", "unit_d", "arrangement", "ops_per_unit")}
        m.update(
            id=f"s{start + i}",
            name=f"{s['name']} {i + 1}",
            w=unit_w,
            d=unit_d,
            ops=int(round(per_unit)),
            family=s["id"],
            family_name=s["name"],
            lane=i + 1,
        )
        out.append(m)
    return out


def mark_assembly(stations: list[dict], routes: list[dict]) -> list[str]:
    """Marca como componente las entradas de más a una estación que recibe más del 100 %."""
    order = {s["id"]: i for i, s in enumerate(stations)}
    names = {s["id"]: s["name"] for s in stations}
    notes = []
    by_target = {}
    for r in routes:
        if flows.is_material(r) and not r.get("is_return") and not r.get("component"):
            by_target.setdefault(r["to"], []).append(r)
    for sid, ins in by_target.items():
        if len(ins) < 2 or sum(float(r.get("frac", 1) or 0) for r in ins) <= 1.0001:
            continue
        # La línea principal es la que llega desde más cerca en el proceso; lo demás se le junta.
        main = max(ins, key=lambda r: order.get(r["from"], -1))
        for r in ins:
            if r is not main:
                r["component"] = True
        joined = ", ".join(names[r["from"]] for r in ins if r is not main)
        notes.append(f"{names[sid]} junta {joined} con lo que llega de {names[main['from']]} (ensamble).")
    return notes


def expand(stations: list[dict], routes: list[dict], max_expand: int = MAX_EXPAND) -> tuple[list[dict], list[dict], list[str]]:
    """Separa las familias y reparte las rutas entre sus ramas. Devuelve estaciones, rutas y notas."""
    notes = mark_assembly(stations, routes)
    members = {}
    out_st = []
    next_id = max((int(s["id"][1:]) for s in stations if s["id"][1:].isdigit()), default=0) + 1
    for s in stations:
        n = units.count(s)
        if units.has_count(s) and 1 < n <= max_expand:
            fam = expand_station(s, next_id)
            next_id += n
            members[s["id"]] = [m["id"] for m in fam]
            out_st += fam
            notes.append(f"{s['name']}: {n} máquinas, cada una con su propia rama.")
        else:
            out_st.append(s)
    if not members:
        return stations, routes, notes

    out_rt = []
    for r in routes:
        a = members.get(r["from"], [r["from"]])
        b = members.get(r["to"], [r["to"]])
        frac = float(r.get("frac", 1) or 0)
        links = pairs(len(a), len(b))
        for i, j in links:
            nr = {k: v for k, v in r.items() if k != "id"}
            nr.update(id=f"r{len(out_rt) + 1}", **{"from": a[i], "to": b[j]}, frac=round(frac / len(links) if len(a) > 1 or len(b) > 1 else frac, 4))
            out_rt.append(nr)
    return out_st, out_rt, notes


def families(plant: dict) -> dict[str, list[str]]:
    """family → ids de sus estaciones, en el orden de sus ramas."""
    out = {}
    for s in sorted(plant.get("stations", []), key=lambda s: s.get("lane") or 0):
        if s.get("family"):
            out.setdefault(s["family"], []).append(s["id"])
    return out


def convergence_belts(plant: dict, positions: dict) -> list[str]:
    """Una banda común donde convergen las ramas de una familia (si la historia habla de banda).

    La banda corre a lo largo de las ramas, del lado de la estación donde convergen, y
    llega hasta ella. Las rutas de convergencia quedan en la banda."""
    st = {s["id"]: s for s in plant["stations"]}
    notes = []
    belts = plant.setdefault("conveyors", [])
    for fam, ids in families(plant).items():
        ids = [i for i in ids if i in positions]
        outs = [r for r in plant["routes"] if r["from"] in ids and flows.is_material(r) and not r.get("is_return") and not r.get("component")]
        targets = {r["to"] for r in outs}
        if len(ids) < MIN_BELT or len(targets) != 1 or len(outs) < len(ids):
            continue
        target = next(iter(targets))
        if target not in positions or st[target].get("family") == fam:
            continue
        xs = [positions[i][0] for i in ids]
        zs = [positions[i][1] for i in ids]
        half = max(st[i]["d"] for i in ids) / 2
        tx, tz = positions[target][0], positions[target][1]
        # Del lado de las ramas que mira a la estación donde convergen.
        zb = (max(zs) + half + 1.0) if tz >= sum(zs) / len(zs) else (min(zs) - half - 1.0)
        zb = round(min(max(zb, 0.5), plant["size"]["d"] - 0.5), 2)
        far = min(xs) if abs(min(xs) - tx) > abs(max(xs) - tx) else max(xs)
        th = st[target]["d"] / 2 + 0.5
        end_z = tz - th if tz > zb else tz + th
        pts = [[round(far, 2), zb], [round(tx, 2), zb]]
        if abs(end_z - zb) > 0.3:
            pts.append([round(tx, 2), round(end_z, 2)])
        if len(pts) == 2 and pts[0] == pts[1]:
            continue
        bid = f"banda-{len(belts) + 1}"
        name = st[ids[0]].get("family_name") or "Ramas"
        belts.append({"id": bid, "name": f"Banda de {name}", "from": ids[0], "to": target, "points": pts, "capacity_ppm": 1, "speed_mpm": 6, "locked": False, "merge": True})
        for r in outs:
            r["conveyor"] = bid
        notes.append(f"Las {len(ids)} ramas de {name} descargan en una banda común hasta {st[target]['name']}.")
    if not belts:
        plant.pop("conveyors", None)
    return notes
