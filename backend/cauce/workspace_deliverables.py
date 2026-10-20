"""Entregables estructurados calculados con datos aceptados, sin cifras de IA."""
from __future__ import annotations

import math
from collections import Counter

from .versions import context_version, plant_version


def finite(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except (ValueError, TypeError):
        return None


def build(context, plant=None, analysis=None):
    context = context if isinstance(context, dict) else {}
    activities = [a for a in context.get("activities", []) if a.get("status") == "confirmed"]
    rows, edges, warnings = [], [], []
    source = "accepted_activities"
    if activities:
        external_ids = {}
        for a in activities:
            if a.get("externalId"):
                external_ids.setdefault(a["externalId"], []).append(a["id"])
        for a in activities:
            time = finite(a.get("time"))
            factor = {"s": 1 / 60, "min": 1, "h": 60}.get(a.get("timeUnit", "min"))
            rows.append({"id": a["id"], "sequence": a.get("sequence"), "description": a.get("description"), "type": a.get("type"),
                "time_min": round(time * factor, 6) if time is not None and factor is not None else None,
                "distance_m": finite(a.get("distance")), "station_id": a.get("stationId") or None,
                "route_id": a.get("routeId") or None, "source_id": a.get("source_id") or a.get("sourceId") or None,
                "excerpt": a.get("excerpt"), "origin": "document" if a.get("source_id") or a.get("sourceId") else "user"})
            for predecessor in a.get("predecessors", []):
                candidates = external_ids.get(predecessor, [predecessor] if any(p["id"] == predecessor for p in activities) else [])
                if len(candidates) == 1:
                    edges.append({"from": candidates[0], "to": a["id"]})
                else:
                    warnings.append(f"Predecesora sin resolver: {predecessor} en {a['id']}")
    elif plant:
        source = "plant_draft"
        for station in plant.get("stations", []):
            rows.append({"id": station["id"], "description": station["name"], "type": "operacion", "time_min": None,
                "distance_m": None, "station_id": station["id"], "source_id": None, "origin": "plant_model"})
        edges = [{"from": r["from"], "to": r["to"], "flow": r.get("flow", "material"), "is_return": bool(r.get("is_return"))} for r in plant.get("routes", [])]
        warnings.append("Borrador derivado del plano: una estación no sustituye un estudio de actividades observado.")
    times = [row["time_min"] for row in rows if row["time_min"] is not None]
    distances = [row["distance_m"] for row in rows if row["distance_m"] is not None]
    return {"context_version": context_version(context), "plant_version": plant_version(plant) if plant else None,
        "source": source, "rows": rows, "edges": edges, "warnings": warnings,
        "counts": dict(Counter(row["type"] for row in rows)),
        "totals": {"activities": len(rows), "known_time_rows": len(times), "missing_time_rows": len(rows) - len(times),
            "known_distance_rows": len(distances), "known_time_sum_min": round(sum(times), 6) if times else None,
            "known_distance_sum_m": round(sum(distances), 6) if distances else None},
        "note": "La suma de duraciones conocidas no es el lead time de un proceso ramificado. Sin mediciones no es un estudio cronometrado.",
        "studies": [
            {"type": "cursograma_analitico", "label": "Cursograma analítico actual", "status": "draft" if rows else "missing_data"},
            {"type": "hoja_tiempos", "label": "Tabla de tiempos conocidos", "status": "partial" if times else "missing_data"},
            {"type": "mapa_proceso", "label": "Relaciones de proceso", "status": "draft" if edges else "missing_data"},
            {"type": "cursograma_propuesto", "label": "Cursograma propuesto", "status": "missing_data", "reason": "Requiere actividades y relaciones sustentadas del rediseño; no se copia el estudio actual."},
        ]}
