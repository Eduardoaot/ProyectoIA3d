"""Cantidades, tiempos y elementos fijos de una estación (contrato v3 §4.2, criterios §3).

Una estación con `count: N` son N máquinas idénticas en paralelo. Su posición y su
tamaño (`w`, `d`) siguen siendo los del bloque completo; `unit_w`/`unit_d` son de
cada unidad y `arrangement` dice cómo se acomodan dentro del bloque.

Sin `count` la estación se calcula exactamente como antes (formato v2).
"""

from __future__ import annotations

import math

ARRANGEMENTS = ("fila", "columna", "bloque")
T_SOURCES = ("medido", "estimado", "supuesto", "usuario")
UNIT_GAP = 0.6  # pasillo entre unidades de un mismo bloque (m)


def has_count(s: dict) -> bool:
    return s.get("count") is not None


def count(s: dict) -> int:
    try:
        return max(1, int(s.get("count") or 1))
    except (TypeError, ValueError):
        return 1


def ops_per_unit(s: dict) -> float:
    """Operarios por unidad. Por defecto, los operarios actuales repartidos entre las N unidades."""
    v = s.get("ops_per_unit")
    if v is None:
        return float(s.get("ops", 0) or 0) / count(s)
    return max(0.0, float(v))


def operators(s: dict) -> int:
    if not has_count(s):
        return int(s.get("ops", 0) or 0)
    return int(round(ops_per_unit(s) * count(s)))


def servers(s: dict, ops: int | None = None) -> int:
    """Servidores en paralelo para colas y capacidad.

    v2 (sin count): los operarios, o 1 si es automática y tiene tiempo.
    v3 (con count): una por máquina; si hay menos de un operario por máquina, los operarios
    limitan (0,6 operarios por unidad en 10 unidades = 6 servidores). Con 0 operarios por
    unidad las máquinas trabajan solas: N servidores.
    """
    if not has_count(s):
        n = int(s.get("ops", 0) or 0) if ops is None else ops
        return n if n > 0 else (1 if machine_time(s) > 0 else 0)
    n, opu = count(s), ops_per_unit(s)
    if machine_time(s) <= 0 and opu <= 0:
        return 0
    if opu <= 0 or opu >= 1:
        return n
    return max(1, int(round(n * opu)))


def _mean(v) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, (list, tuple)) and v and all(isinstance(x, (int, float)) for x in v):
        return sum(float(x) for x in v) / len(v)
    return None


def batch(s: dict) -> dict | None:
    b = s.get("batch")
    if not isinstance(b, dict):
        return None
    try:
        size, t = int(b.get("size") or 0), float(b.get("t_min") or 0)
    except (TypeError, ValueError):
        return None
    return {"size": size, "t_min": t} if size >= 1 and t > 0 else None


def cycle(s: dict) -> float:
    """Minutos por pieza (o por lote) que declara la estación: t_cycle_min si viene, si no t."""
    m = _mean(s.get("t_cycle_min"))
    return m if m is not None else float(s.get("t", 0) or 0)


def machine_time(s: dict) -> float:
    """Minutos de máquina por pieza (carga). En un lote, el tiempo del lote se reparte entre sus piezas."""
    b = batch(s)
    if b:
        return b["t_min"] / b["size"]
    return cycle(s)


def stay_time(s: dict) -> float:
    """Minutos que una pieza pasa dentro de la estación (tiempo de fabricación): en un lote, el lote completo."""
    b = batch(s)
    return b["t_min"] if b else cycle(s)


def block_size(n: int, unit_w: float, unit_d: float, arrangement: str = "fila", gap: float = UNIT_GAP) -> tuple[float, float]:
    """Ancho y fondo del bloque de N unidades."""
    n = max(1, int(n))
    if arrangement == "columna":
        cols, rows = 1, n
    elif arrangement == "bloque":
        cols = math.ceil(math.sqrt(n))
        rows = math.ceil(n / cols)
    else:
        cols, rows = n, 1
    return round(cols * unit_w + (cols - 1) * gap, 2), round(rows * unit_d + (rows - 1) * gap, 2)


def is_locked(item: dict) -> bool:
    return bool(item.get("locked"))


def locked_stations(plant: dict) -> list[str]:
    return [s["id"] for s in plant.get("stations", []) if is_locked(s) and s["id"] in (plant.get("layout") or {})]


def locked_items(plant: dict) -> list[dict]:
    """Todo lo fijo (estaciones, zonas y bandas) con su nombre y su motivo."""
    out = []
    for s in plant.get("stations", []):
        if is_locked(s):
            out.append({"id": s["id"], "name": s.get("name", s["id"]), "type": "station", "reason": s.get("lock_reason") or ""})
    for z in plant.get("zones", []):
        if is_locked(z):
            out.append({"id": z["id"], "name": z.get("name", z["id"]), "type": "zone", "reason": z.get("lock_reason") or z.get("reason") or ""})
    for c in plant.get("conveyors", []) or []:
        if is_locked(c):
            out.append({"id": c["id"], "name": c.get("name", c["id"]), "type": "conveyor", "reason": c.get("lock_reason") or ""})
    return out
