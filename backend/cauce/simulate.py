"""Simulación de eventos discretos con SimPy (criterios §6, contrato §6.5).

La simulación no reemplaza a las fórmulas del motor: las valida con variabilidad.
- Cada pieza entra al ritmo de la demanda y sigue las rutas de material, eligiendo el
  siguiente paso según los porcentajes (los retornos se recorren de verdad).
- Cada estación es un recurso con tantos servidores como `units.servers()`.
- Tiempo de proceso: triangular (mínimo, moda, máximo) cuando hay rango y el dato no es
  medido; determinista cuando es medido o no hay rango.
- Lote (horno, secado): la pieza espera a que se junte el lote; esa espera va a `lote`.
- Traslados: las distancias del motor a la velocidad del carro (o de la banda).
- Semilla y réplicas en la respuesta: el mismo caso da el mismo resultado.
Un KPI sin datos suficientes es null (el frontend muestra "sin datos"); nada se inventa.
"""

from __future__ import annotations

import random
import statistics

import simpy

from . import flows, units
from .engine import ends, evaluate, params, shares


def _pct(values: list[float], q: float) -> float:
    vs = sorted(values)
    if not vs:
        return 0.0
    k = (len(vs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(vs) - 1)
    return vs[lo] + (vs[hi] - vs[lo]) * (k - lo)


def band(values: list[float], nd: int = 2) -> dict | None:
    if not values:
        return None
    return {"p10": round(_pct(values, 0.1), nd), "p50": round(_pct(values, 0.5), nd), "p90": round(_pct(values, 0.9), nd)}


def _sampler(s: dict, rng: random.Random):
    """Minutos de máquina por pieza (o por lote si hay `batch`)."""
    b = units.batch(s)
    rangev = s.get("t_cycle_min")
    varies = isinstance(rangev, list) and len(rangev) == 2 and s.get("t_source") != "medido"
    if b:
        # El lote dura t_min; si además hay rango de ciclo (por lote), varía dentro de él.
        base = b["t_min"]
        if varies and min(rangev) <= base <= max(rangev) and min(rangev) < max(rangev):
            return lambda: rng.triangular(float(min(rangev)), float(max(rangev)), base)
        return lambda: base
    if varies:
        lo, hi = float(min(rangev)), float(max(rangev))
        mode = (lo + hi) / 2
        return lambda: rng.triangular(lo, hi, mode)
    t = units.cycle(s)
    return lambda: t


WARMUP_DAYS = 2  # la planta arranca vacía: estos días no se miden


def _run(plant: dict, legs: dict, seed: int, days: int) -> dict | None:
    p = params(plant)
    rng = random.Random(seed)
    env = simpy.Environment()
    st = {s["id"]: s for s in plant["stations"]}
    avail = p["shift_min"] * p["efficiency"]
    demand = float(p["demand"])
    warm = avail * WARMUP_DAYS
    horizon = warm + avail * days
    first, last = ends(plant)
    if not first or demand <= 0:
        return None
    nxt, joins = {}, {}
    # Los componentes de ensamble se suponen a la mano: su traslado está en las métricas, no en la pieza.
    mat = [r for r in flows.material_routes(plant) if r["from"] in st and r["to"] in st and r["from"] != r["to"] and not flows.is_component(r)]
    # Retorno: el marcado con is_return o el que vuelve hacia atrás en el orden del proceso.
    rank = {k: i for i, k in enumerate(flows.ordered(plant))}
    back = {r["id"] for r in mat if r.get("is_return") or rank.get(r["to"], 0) <= rank.get(r["from"], 0)}
    for r in mat:
        nxt.setdefault(r["from"], []).append((r["to"], float(r.get("frac", 1) or 0), r["id"], r["id"] in back))
    share = shares(plant)
    for r in mat:
        # Un ensamble espera a cada entrada por la que pasan todas las piezas que llegan a la
        # estación. Si las entradas son ramas (cada una con una parte), convergen: no se espera
        # a las demás. Los retornos no se esperan.
        if r["id"] not in back and float(r.get("frac", 1) or 0) >= share.get(r["to"], 1.0) - 1e-3:
            joins[r["to"]] = joins.get(r["to"], 0) + 1
    family = {sid: s.get("family") or sid for sid, s in st.items()}
    servers = {sid: max(1, units.servers(s)) for sid, s in st.items()}
    res = {sid: simpy.Resource(env, capacity=servers[sid]) for sid in st}
    sample = {sid: _sampler(s, rng) for sid, s in st.items()}
    busy = {sid: 0.0 for sid in st}
    batch_q = {sid: [] for sid in st if units.batch(st[sid])}
    lead, waits = [], {"lote": 0.0, "cola": 0.0}
    done = [0]

    def process(sid):
        s = st[sid]
        if sid in batch_q:
            b = units.batch(s)
            ev = env.event()
            batch_q[sid].append((env.now, ev))
            if len(batch_q[sid]) >= b["size"]:
                group, batch_q[sid] = batch_q[sid][: b["size"]], batch_q[sid][b["size"] :]
                env.process(run_batch(sid, group))
            yield ev
            return
        t0 = env.now
        with res[sid].request() as req:
            yield req
            waits["cola"] += env.now - t0
            dt = max(0.0, sample[sid]())
            busy[sid] += dt
            yield env.timeout(dt)

    def run_batch(sid, group):
        start = env.now
        for t_in, _ in group:
            waits["lote"] += start - t_in
        with res[sid].request() as req:
            yield req
            dt = max(0.0, sample[sid]())
            busy[sid] += dt
            yield env.timeout(dt)
        for _, ev in group:
            ev.succeed()

    def pick(opts, total):
        """Una opción elegida según sus porcentajes (elección exclusiva)."""
        x, acc = rng.random() * max(total, 1e-9), 0.0
        for o in opts:
            acc += o[1]
            if x <= acc:
                return o
        return opts[-1]

    def token(cur, ps, via_return=False, delay=0.0):
        """Una parte de la pieza llega a `cur`. Con varias entradas (ensamble) se espera a
        todas; un retorno (retrabajo) no espera. Con más de 100 % de salida, se divide."""
        if delay:
            yield env.timeout(delay)
        need = joins.get(cur, 1)
        if need > 1 and not via_return:
            ps["arr"][cur] = ps["arr"].get(cur, 0) + 1
            if cur in ps["fired"] or ps["arr"][cur] < need:
                return
            ps["fired"].add(cur)
        ps["hops"] += 1
        if ps["hops"] > 500:
            return
        yield from process(cur)
        if cur == last:
            if warm <= env.now <= horizon and not ps["done"]:
                ps["done"] = True
                done[0] += 1
                lead.append(env.now - ps["t_in"])
            return
        opts = nxt.get(cur)
        if not opts:
            return
        total = sum(o[1] for o in opts)
        if total > 1.0001:
            # Se divide en paralelo: cada destino (o cada familia de ramas, de la que se toma
            # una sola rama) se toma si es seguro o con su probabilidad.
            groups = {}
            for o in opts:
                groups.setdefault(family[o[0]], []).append(o)
            chosen = []
            for g in groups.values():
                gsum = sum(o[1] for o in g)
                if gsum >= 0.999 or rng.random() < gsum:
                    chosen.append(pick(g, min(gsum, 1.0)))
            chosen = chosen or [max(opts, key=lambda o: o[1])]
        else:
            chosen = [pick(opts, total)]
        for o in chosen:
            env.process(token(o[0], ps, o[3], legs.get(o[2], 0.0)))

    def piece():
        ps = {"t_in": env.now, "arr": {}, "fired": set(), "hops": 0, "done": False}
        yield from token(first, ps)

    def source():
        gap = avail / demand
        i = 0
        while env.now < horizon:
            env.process(piece())
            i += 1
            yield env.timeout(gap)

    env.process(source())
    env.run(until=horizon)
    cap_time = {sid: servers[sid] * horizon for sid in st}  # utilización sobre todo el periodo
    util = {sid: min(1.0, busy[sid] / cap_time[sid]) for sid in st if units.machine_time(st[sid]) > 0}
    idle = sum(cap_time[sid] - busy[sid] for sid in util)
    return {
        "piezas_dia": done[0] / days,
        "lead_time_min": statistics.fmean(lead) if lead else None,
        "utilizacion": util,
        "lote": waits["lote"] / days,
        "material": idle / days,
        "wip": (done[0] / (horizon - warm)) * statistics.fmean(lead) if lead else None,
    }


def simulate(plant: dict, positions: dict, replicas: int = 30, seed: int = 42, days: int = 5) -> dict:
    replicas = max(1, min(int(replicas), 200))
    days = max(1, min(int(days), 30))
    out = {"seed": seed, "replicas": replicas, "days": days, "kpis": None, "notes": []}
    has_times = any(units.machine_time(s) > 0 for s in plant.get("stations", []))
    if not plant.get("use_assumptions") or not has_times:
        out["notes"].append("Sin tiempos ni producción no hay qué simular: activa los supuestos o carga tiempos medidos.")
        out["kpis"] = {"piezas_dia": None, "lead_time_min": None, "utilizacion": None, "tiempo_muerto": None, "oee": None, "takt_min": None, "wip": None, "throughput_dia": None}
        return out
    p = params(plant)
    m = evaluate(plant, positions)
    speed = float(p["speed"])
    belts = flows.conveyors(plant)
    legs = {}
    for leg in m["legs"]:
        if leg.get("flow", "material") != "material":
            continue
        belt_m = leg.get("belt_m", 0.0)
        mins = (leg["dist"] - belt_m) / speed
        if belt_m:
            mins += belt_m / max(float(belts[leg["conveyor"]].get("speed_mpm") or speed), 1e-6)
        legs[leg["id"]] = mins
    runs = [r for r in (_run(plant, legs, seed + i, days) for i in range(replicas)) if r]
    if not runs:
        out["notes"].append("No se encontró por dónde entra el material: revisa las rutas.")
        return out
    avail = p["shift_min"] * p["efficiency"]
    util = {sid: band([r["utilizacion"][sid] for r in runs], 3) for sid in runs[0]["utilizacion"]}
    pieces = band([r["piezas_dia"] for r in runs], 1)
    lead_vals = [r["lead_time_min"] for r in runs if r["lead_time_min"] is not None]
    wip_vals = [r["wip"] for r in runs if r["wip"] is not None]
    # OEE = disponibilidad × rendimiento × calidad: solo si el usuario dio disponibilidad y calidad.
    a, q = p.get("availability"), p.get("quality")
    oee = None
    if a is not None and q is not None and pieces:
        ideal = float(p["demand"])
        oee = band([float(a) * min(1.0, r["piezas_dia"] / ideal) * float(q) for r in runs], 3)
    out["kpis"] = {
        "piezas_dia": pieces,
        "throughput_dia": pieces,
        "lead_time_min": band(lead_vals, 1) if lead_vals else None,
        "utilizacion": util,
        "tiempo_muerto": {
            "falla": None,  # sin datos de paros
            "material": band([r["material"] for r in runs], 1),
            "personal": None,  # sin datos de ausencias
            "cambio": None,  # sin datos de cambios de herramienta
            "lote": band([r["lote"] for r in runs], 1) if any(r["lote"] for r in runs) else None,
        },
        "oee": oee,
        "takt_min": round(avail / float(p["demand"]), 2) if p["demand"] else None,
        "wip": band(wip_vals, 1) if wip_vals else None,
    }
    out["bottleneck"] = max(util, key=lambda k: util[k]["p50"]) if util else None
    out["notes"].append("Tiempos con rango y no medidos: distribución triangular; medidos o sin rango: fijos.")
    return out
