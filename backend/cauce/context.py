"""Contexto de la planta: texto libre (formato actual) u objeto segmentado (contrato §4.5).

Las entradas no se borran: una entrada nueva reemplaza a otra con `supersedes`.
La vigente de cada `key` es la que ninguna otra reemplazó. facts() usa solo las vigentes.
"""

from __future__ import annotations

SEGMENTS = ("negocio", "operaciones", "tiempos", "maquinas", "flujo", "personal", "calidad", "restricciones", "estudios", "referencias")


def entries(context) -> list[dict]:
    """Todas las entradas válidas de un contexto segmentado (lista vacía si es texto)."""
    if not isinstance(context, dict):
        return []
    out = []
    for seg, items in (context.get("segments") or {}).items():
        if seg not in SEGMENTS or not isinstance(items, list):
            continue
        for e in items:
            if isinstance(e, dict) and e.get("id"):
                out.append({**e, "segment": e.get("segment") or seg})
    return out


def current(context) -> list[dict]:
    """Entradas vigentes: las que nadie reemplazó. Si dos vigentes comparten key, gana la de mayor versión."""
    all_ = entries(context)
    replaced = {e["supersedes"] for e in all_ if e.get("supersedes")}
    live = [e for e in all_ if e["id"] not in replaced]
    by_key: dict[str, dict] = {}
    loose = []
    for e in live:
        k = e.get("key")
        if not k:
            loose.append(e)
            continue
        prev = by_key.get(k)
        if prev is None or (e.get("version") or 0) >= (prev.get("version") or 0):
            by_key[k] = e
    return loose + list(by_key.values())


def _value(v) -> str:
    if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
        return f"{v[0]} a {v[1]}"
    if isinstance(v, (list, dict)):
        return str(v)
    return str(v)


def lines(context) -> list[str]:
    """Líneas para facts(): el texto tal cual, o una línea por entrada vigente con su procedencia."""
    if isinstance(context, str):
        t = context.strip()
        return [f"Contexto del usuario: {t}"] if t else []
    out = []
    story = str(context.get("story") or "").strip() if isinstance(context, dict) else ""
    if story:
        out.append(f"Contexto del usuario: {story}")
    for e in current(context):
        if e.get("segment") == "referencias" and not e.get("value"):
            continue
        tag = ", ".join(x for x in (e.get("source"), f"confianza {e['confidence']}" if e.get("confidence") else None, e.get("date")) if x)
        unit = f" {e['unit']}" if e.get("unit") else ""
        out.append(f"Dato ({e.get('segment')}{', ' + tag if tag else ''}): {e.get('key') or e['id']} = {_value(e.get('value'))}{unit}.")
    if isinstance(context, dict):
        for activity in context.get("activities", []):
            if activity.get("status") == "confirmed":
                out.append(f"Actividad aceptada: {activity.get('description', '')}. Fuente: {activity.get('source_id') or activity.get('sourceId') or 'usuario'}.")
        for person in context.get("operators", []):
            if person.get("status") == "confirmed":
                out.append(f"Asignación aportada: {person.get('name')}; área {person.get('station')}; máquina {person.get('machine')}; turno {person.get('shift')}. No implica eficiencia calculada.")
    return out
