"""Métrica principal, razón de la recomendada y sus contrapartidas (criterios §1.6 y §5.2).

Todo sale de plantillas de texto con los números del motor: la IA no interviene.
Si la recomendada empeora algo frente a hoy, recommended_tradeoffs lo dice.
"""

from __future__ import annotations

# clave, etiqueta, campo de las métricas, dirección buena, unidad
METRICS = (
    ("manejo", "Costo de manejo", None, "min", None),
    ("lead_time", "Tiempo por pieza", "lead_h", "min", "h"),
    ("capacidad", "Capacidad", "capacity", "max", "piezas al día"),
    ("camiones", "Carga de camiones", "loading_min", "min", "min al día"),
    ("seguridad", "Áreas sucias junto a limpias", "avoid_n", "min", "avisos"),
)


def handling_field(m: dict) -> tuple[str, str]:
    """Con supuestos el costo de manejo es metros al día (viajes × distancia); sin supuestos, metros por pieza."""
    return ("daily_m", "m al día") if m.get("daily_m") is not None else ("piece_m", "m por pieza")


def value(m: dict, key: str):
    if key == "manejo":
        return m.get(handling_field(m)[0])
    if key == "seguridad":
        return len(m.get("avoid_hits") or [])
    field = next(f for k, _, f, _, _ in METRICS if k == key)
    return m.get(field)


def main_metric(plant: dict, current: dict) -> dict:
    field, unit = handling_field(current)
    if plant.get("use_assumptions") and current.get("lead_h") is not None:
        return {
            "key": "lead_time",
            "label": "Tiempo por pieza",
            "direction": "min",
            "field": "lead_h",
            "unit": "h",
            "also": [{"key": "capacidad", "label": "Capacidad", "direction": "max", "field": "capacity", "unit": "piezas al día"}],
        }
    return {"key": "manejo", "label": "Costo de manejo", "direction": "min", "field": field, "unit": unit}


def pct(before, after):
    if before is None or after is None or not before:
        return None
    return round((after - before) / before * 100, 1)


def fmt(v) -> str:
    if v is None:
        return "sin dato"
    r = round(float(v), 1)
    s = f"{r:.1f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def signed(p) -> str:
    return ("+" if p and p > 0 else "") + fmt(p)


def _worse(direction, before, after, tol=0.5):
    p = pct(before, after)
    if p is None:
        return False
    return p > tol if direction == "min" else p < -tol


def _better(direction, before, after, tol=0.5):
    p = pct(before, after)
    if p is None:
        return False
    return p < -tol if direction == "min" else p > tol


def _label_unit(key, m):
    for k, label, _, direction, unit in METRICS:
        if k == key:
            return label, (handling_field(m)[1] if key == "manejo" else unit), direction
    raise KeyError(key)


def tradeoffs(current: dict, m: dict) -> list[dict]:
    """Lo que la alternativa empeora frente a hoy."""
    out = []
    for key, *_ in METRICS:
        before, after = value(current, key), value(m, key)
        if before is None or after is None:
            continue
        label, unit, direction = _label_unit(key, current)
        if key == "seguridad":
            if after > before:
                out.append({"metric": key, "label": label, "delta_pct": None, "before": before, "after": after, "note": f"{label}: {after} avisos frente a {before} hoy."})
            continue
        if _worse(direction, before, after):
            p = pct(before, after)
            out.append({"metric": key, "label": label, "delta_pct": p, "before": before, "after": after, "note": f"{label}: {fmt(after)} {unit} frente a {fmt(before)} {unit} hoy ({signed(p)} %)."})
    return out


def gains(current: dict, m: dict) -> list[str]:
    out = []
    for key, *_ in METRICS:
        before, after = value(current, key), value(m, key)
        if before is None or after is None or key == "seguridad":
            continue
        label, unit, direction = _label_unit(key, current)
        if _better(direction, before, after):
            out.append(f"{label.lower()} {fmt(after)} {unit} frente a {fmt(before)} hoy")
    return out


def reason(plant: dict, current: dict, best: dict, alts: list[dict]) -> str:
    mm = main_metric(plant, current)
    m = best["metrics"]
    before, after = value(current, mm["key"]), value(m, mm["key"])
    p = pct(before, after)
    head = f"Se recomienda «{best['name']}»"
    main_txt = f"{mm['label'].lower()} {fmt(after)} {mm['unit']} frente a {fmt(before)} {mm['unit']} hoy" + (f" ({signed(p)} %)" if p is not None else "")
    works = "sin obra: solo se intercambian máquinas de lugar" if not best.get("works_cost") else f"con obra ({best.get('works', '').rstrip('.').lower()})"
    parts = []
    if _worse(mm["direction"], before, after):
        others = gains(current, m)
        better_alt = [a["name"] for a in alts if a is not best and _better(mm["direction"], value(m, mm["key"]), value(a["metrics"], mm["key"]))]
        txt = f"{head} aunque empeora la métrica principal: {main_txt}."
        if others:
            txt += " Gana por otros criterios: " + "; ".join(others) + "."
        if better_alt:
            txt += " En la métrica principal es mejor: " + ", ".join(f"«{x}»" for x in better_alt) + "."
        parts.append(txt)
    elif not _better(mm["direction"], before, after):
        parts.append(f"{head}: {main_txt}. Ninguna alternativa mejora claramente a hoy en esta métrica.")
    else:
        parts.append(f"{head}: {main_txt}.")
    parts.append(f"Se hace {works}.")
    for x in mm.get("also", []):
        b, a = value(current, x["key"]), value(m, x["key"])
        if b is not None and a is not None:
            parts.append(f"{x['label']}: {fmt(a)} {x['unit']} frente a {fmt(b)} hoy.")
    return " ".join(parts)


def summary(plant: dict, current: dict, alts: list[dict], recommended: str) -> dict:
    best = next(a for a in alts if a["id"] == recommended)
    return {
        "main_metric": main_metric(plant, current),
        "recommended_reason": reason(plant, current, best, alts),
        "recommended_tradeoffs": tradeoffs(current, best["metrics"]),
    }
