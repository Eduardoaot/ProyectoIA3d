"""Decisión multicriterio (criterios §5.2 y §5.3, contrato §6.2).

Cada alternativa recibe un puntaje entre 0 y 1 por criterio (1 es lo mejor entre hoy y
las alternativas) y un total ponderado con los pesos del usuario. Más metros nunca dan
mejor puntaje de manejo, así una alternativa que camina más no puede ganar por distancia.

| criterio      | se mide con                                  | puntaje                     |
|---------------|----------------------------------------------|-----------------------------|
| manejo        | m al día (con supuestos) o m por pieza       | menor / valor               |
| lead_time     | horas por pieza                              | menor / valor               |
| capacidad     | piezas al día                                | valor / mayor               |
| obra          | estaciones que cambian de lugar y obra       | 1 − movidas / total − 0,25 × obra |
| seguridad     | avisos de áreas sucias junto a limpias       | 1 / (1 + avisos)            |
| flexibilidad  | área libre de la planta                      | libre / mayor libre         |

Un criterio sin datos (por ejemplo tiempos sin supuestos) no cuenta y su peso se reparte
entre los demás.
"""

from __future__ import annotations

CRITERIA = ("manejo", "lead_time", "capacidad", "obra", "seguridad", "flexibilidad")
DEFAULT_WEIGHTS = {"manejo": 0.25, "lead_time": 0.20, "capacidad": 0.15, "obra": 0.15, "seguridad": 0.15, "flexibilidad": 0.10}
LABELS = {"manejo": "costo de manejo", "lead_time": "tiempo por pieza", "capacidad": "capacidad", "obra": "obra", "seguridad": "seguridad", "flexibilidad": "espacio libre"}


class WeightsError(ValueError):
    pass


def normalize(weights: dict | None) -> tuple[dict, str | None]:
    """Pesos validados que suman 1. Devuelve (pesos, nota) o lanza WeightsError."""
    if weights is None:
        return dict(DEFAULT_WEIGHTS), None
    if not isinstance(weights, dict):
        raise WeightsError("weights debe ser un objeto { criterio: peso }")
    unknown = sorted(set(weights) - set(CRITERIA))
    if unknown:
        raise WeightsError(f"Criterios desconocidos: {', '.join(unknown)}. Válidos: {', '.join(CRITERIA)}")
    w = {}
    for k in CRITERIA:
        v = weights.get(k, 0)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            raise WeightsError(f"El peso de {k} debe ser un número mayor o igual a 0")
        w[k] = float(v)
    total = sum(w.values())
    if total <= 0:
        raise WeightsError("Al menos un peso debe ser mayor que 0")
    out = {k: round(v / total, 4) for k, v in w.items()}
    note = None if abs(total - 1) < 1e-6 else f"Los pesos sumaban {round(total, 4)}; se normalizaron para que sumen 1."
    return out, note


def handling(m: dict):
    return m.get("daily_m") if m.get("daily_m") is not None else m.get("piece_m")


def raw(plant: dict, m: dict, positions: dict, works_cost: float, area: float) -> dict:
    layout = plant.get("layout") or {}
    ids = [s["id"] for s in plant["stations"] if s["id"] in layout]
    moved = sum(1 for k in ids if list(positions.get(k, layout[k]))[:3] != list(layout[k])[:3])
    fp = m.get("footprint_m2")
    return {
        "manejo": handling(m),
        "lead_time": m.get("lead_h"),
        "capacidad": m.get("capacity"),
        "obra": (moved / len(ids) if ids else 0) + 0.25 * (works_cost or 0),
        "seguridad": len(m.get("avoid_hits") or []),
        "flexibilidad": max(0.0, 1 - fp / area) if fp is not None and area else None,
    }


def scores(options: dict[str, dict]) -> dict[str, dict]:
    """options: id -> valores crudos. Devuelve id -> puntaje 0..1 por criterio (None sin datos)."""
    out = {k: {} for k in options}
    for c in CRITERIA:
        vals = [v[c] for v in options.values()]
        if any(x is None for x in vals):
            for k in options:
                out[k][c] = None
            continue
        for k, v in options.items():
            x = v[c]
            if c in ("manejo", "lead_time"):
                lo = min(vals)
                s = 1.0 if x <= 0 else (lo / x if lo > 0 else 0.0)
            elif c == "capacidad":
                hi = max(vals)
                s = x / hi if hi > 0 else 1.0
            elif c == "obra":
                s = max(0.0, 1 - x)
            elif c == "seguridad":
                s = 1 / (1 + x)
            else:
                hi = max(vals)
                s = x / hi if hi > 0 else 1.0
            out[k][c] = round(s, 4)
    return out


def total(sc: dict, weights: dict) -> float:
    used = {c: w for c, w in weights.items() if sc.get(c) is not None}
    t = sum(used.values())
    if t <= 0:
        return 0.0
    return round(sum(sc[c] * w for c, w in used.items()) / t, 4)


def winner(alts: list[dict], sc: dict, weights: dict) -> str | None:
    best = None
    for a in alts:
        v = total(sc[a["id"]], weights)
        # Empate: gana la de menos obra (la que menos cambia).
        key = (v, sc[a["id"]].get("obra") or 0)
        if best is None or key > best[0]:
            best = (key, a["id"])
    return best[1] if best else None


def viable(a: dict) -> bool:
    return a.get("locked_respected", True) and not a.get("infeasible")


def rank(plant: dict, current: dict, alts: list[dict], weights: dict, area: float) -> dict:
    """Puntajes, recomendada (viable), ideal (mejor técnica sin obra ni fijos) y sensibilidad."""
    options = {"hoy": raw(plant, current, plant.get("layout") or {}, 0, area)}
    for a in alts:
        options[a["id"]] = raw(plant, a["metrics"], a["positions"], a.get("works_cost", 0), area)
    sc = scores(options)
    pool = [a for a in alts if viable(a)] or alts
    rec = winner(pool, sc, weights)
    ideal = winner(alts, sc, {**weights, "obra": 0.0})
    sens = {}
    for c, w in weights.items():
        if w <= 0 or all(sc[k].get(c) is None for k in sc):
            continue
        for f, tag in ((0.5, "x0.5"), (2.0, "x2")):
            w2 = {**weights, c: w * f}
            s = sum(w2.values())
            sens[f"{c}_{tag}"] = "misma" if winner(pool, sc, {k: v / s for k, v in w2.items()}) == rec else "cambia"
    return {"scores": sc, "recommended": rec, "ideal": ideal, "sensitivity": sens, "totals": {k: total(v, weights) for k, v in sc.items()}}
