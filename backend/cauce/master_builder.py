"""Construcción y comprobación desde el maestro aceptado, sin reextraer el relato."""
from __future__ import annotations

import math

from .catalog import DEFAULT_PARAMS
from .context_master import entity_id
from .engine import rect_at, rect_gap
from .layout import collisions, nearest_free
from .story import _kind_from_name
from .units import block_size
from .versions import digest
from .workspace import normalize


def meters(fact):
    number = fact.get("number")
    if number is None:
        return None
    unit = normalize(fact.get("unit", "")).split("/")[0]
    if unit in ("cm", "centimetros", "centimetro"):
        return float(number) / 100
    if unit in ("mm", "milimetros", "milimetro"):
        return float(number) / 1000
    if unit in ("m", "metro", "metros"):
        return float(number)
    return None


def current_facts(master):
    if master.get("schema_version") != 2 or master.get("status") != "accepted":
        raise ValueError("Primero revisa y confirma los datos del contexto maestro.")
    if master.get("pending_manual_ids"):
        raise ValueError("Hay datos manuales nuevos que todavía no fueron integrados al maestro. Vuelve a organizar el contexto antes de construir.")
    if master.get("pending_source_policy"):
        raise ValueError("Cambió la prioridad de las fuentes. Vuelve a organizar el contexto con ese criterio antes de construir.")
    if master.get("pending_visual_sources"):
        raise ValueError("Las imágenes son tu referencia principal y todavía no se han interpretado ni contrastado manualmente. No se dibujará una distribución como si se hubieran leído.")
    return [f for f in master.get("facts", []) if f.get("status") == "confirmed" and f.get("scope") == "current" and not f.get("needs_reinterpretation")]


def region_of(value):
    text = normalize(value)
    vertical = "fondo" if "fondo" in text or "superior" in text or "arriba" in text else "frente" if "frente" in text or "inferior" in text or "abajo" in text else "centro"
    horizontal = "izquierda" if "izquierd" in text else "derecha" if "derech" in text else "centro"
    return vertical, horizontal


def region_point(value, width, depth):
    row, col = region_of(value)
    return width * {"izquierda": 0.15, "centro": 0.5, "derecha": 0.85}[col], depth * {"fondo": 0.15, "centro": 0.5, "frente": 0.85}[row]


def _region_matches(value, point, width, depth):
    row, col = region_of(value)
    x, z = point[:2]
    return (col == "centro" or (x < width / 3 if col == "izquierda" else x > 2 * width / 3)) and (row == "centro" or (z < depth / 3 if row == "fondo" else z > 2 * depth / 3))


def verify(master, plant):
    facts = current_facts(master)
    stations = {s.get("master_entity_id", s["id"]): s for s in plant.get("stations", [])}
    zones = {s.get("master_entity_id", s["id"]): s for s in plant.get("zones", [])}
    gates = {s.get("master_entity_id", s["id"]): s for s in plant.get("gates", [])}
    mapped = {**stations, **zones, **gates}
    width, depth = plant["size"]["w"], plant["size"]["d"]
    rows = []
    for fact in master.get("facts", []):
        if fact.get("status") != "confirmed":
            continue
        row = {"fact_id": fact["id"], "entity": fact["entity"], "requirement": fact["value"], "status": "unverifiable", "reason": "No hay una comprobación geométrica definida para esta afirmación."}
        if fact not in facts:
            row["reason"] = "Objetivo, propuesta o corrección que requiere reinterpretación; no se aplicó como distribución actual."
            rows.append(row)
            continue
        field, eid = fact["field"], fact["entity_id"]
        if fact["entity_type"] == "organization" or field in ("description", "cycle_time", "operators", "goal"):
            row.update(status="not_geometric", reason="Dato conservado en el maestro; no afirma una posición ni un cálculo geométrico.")
            rows.append(row)
            continue
        item = mapped.get(eid)
        pos = plant.get("layout", {}).get(item["id"]) if eid in stations else [item["x"], item["z"]] if item else None
        ok = None
        if fact["entity_type"] == "building" and field in ("width", "depth"):
            expected = meters(fact)
            ok = expected is not None and math.isclose(width if field == "width" else depth, expected, abs_tol=0.01)
        elif field == "count" and item:
            ok = item.get("count", 1) == fact["number"]
        elif field in ("width", "depth") and item:
            expected = meters(fact)
            ok = expected is not None and math.isclose(item["w" if field == "width" else "d"], expected, abs_tol=0.01)
        elif field in ("x", "z") and pos:
            expected = meters(fact)
            ok = expected is not None and math.isclose(pos[0 if field == "x" else 1], expected, abs_tol=0.01)
        elif field == "location" and pos:
            ok = _region_matches(fact["target"] or fact["value"], pos, width, depth)
        elif field == "locked" and item:
            ok = item.get("locked") is True
        elif field == "flow_to" and item:
            target = mapped.get(entity_id(fact["target"]))
            ok = bool(target) and any(r["from"] == item["id"] and r["to"] == target["id"] for r in plant.get("routes", []))
        elif field == "near" and item and pos:
            target = mapped.get(entity_id(fact["target"]))
            other = plant.get("layout", {}).get((target or {}).get("id"))
            if target and other:
                ok = rect_gap(rect_at(item, pos), rect_at(target, other)) <= 2.0
        if ok is not None:
            row.update(status="met" if ok else "unmet", reason="Comprobado contra el plano." if ok else "El plano no satisface esta afirmación aceptada.")
        rows.append(row)
    bad = sorted(collisions(plant, plant.get("layout", {})))
    if bad:
        rows.append({"fact_id": "geometry", "entity": "Planta", "requirement": "Equipos sin solapes y dentro del recinto", "status": "unmet", "reason": ", ".join(bad)})
    totals = {status: sum(r["status"] == status for r in rows) for status in ("met", "unmet", "unverifiable")}
    assumptions = plant.get("construction", {}).get("assumptions", [])
    unresolved = [q for q in master.get("questions", []) if q.get("status") == "unresolved"]
    return {"master_revision": digest([(f["id"], f["value"]) for f in facts]), "requirements": rows, "totals": totals,
            "status": "needs_review" if totals["unmet"] or totals["unverifiable"] or assumptions or unresolved else "verified", "assumptions": assumptions, "questions": unresolved}


def build(master):
    facts = current_facts(master)
    groups = {}
    for fact in facts:
        groups.setdefault(fact["entity_id"], []).append(fact)
    def one(rows, field):
        matches = [f for f in rows if f["field"] == field]
        if len({(m.get("number"), m.get("unit"), m.get("target")) for m in matches}) > 1:
            raise ValueError(f"Hay afirmaciones incompatibles para {rows[0]['entity']}: {field}. Acláralas antes de construir.")
        return matches[-1] if matches else None
    building = [f for f in facts if f["entity_type"] == "building"]
    w, d = one(building, "width"), one(building, "depth")
    width, depth = meters(w) if w else None, meters(d) if d else None
    if width is None or depth is None or not (2 <= width <= 2000 and 2 <= depth <= 2000):
        raise ValueError("Falta confirmar el ancho y el fondo del recinto con sus unidades. No se inventará un tamaño de planta.")
    plant = {"schema_version": 3, "name": "Planta desde contexto aceptado", "industry": "", "size": {"w": width, "d": depth}, "stations": [], "zones": [], "gates": [], "walls": [], "conveyors": [], "routes": [], "layout": {}, "use_assumptions": False, "params": dict(DEFAULT_PARAMS), "construction": {"master_revision": master["revision"], "assumptions": []}}
    assumed = plant["construction"]["assumptions"]
    targets, fixed, relations = {}, {}, []
    for eid, rows in groups.items():
        name, kind = rows[0]["entity"], rows[0]["entity_type"]
        if kind in ("building", "organization"):
            continue
        count = one(rows, "count")
        n = int(count["number"]) if count else 1
        if not 1 <= n <= 500:
            raise ValueError(f"Cantidad no representable para {name}: {n}")
        if not count:
            assumed.append(f"{name}: se dibuja una entidad; falta confirmar su cantidad.")
        wf, df = one(rows, "width"), one(rows, "depth")
        sw, sd = meters(wf) if wf else None, meters(df) if df else None
        location = one(rows, "location")
        region = (location["target"] or location["value"]) if location else "centro"
        if sw is None or sd is None:
            # Huella ilustrativa, identificada como supuesto; nunca se llama dimensión observada.
            sw, sd = block_size(n, 1.5, 1.2, "columna" if "izquierd" in normalize(region) or "derech" in normalize(region) else "bloque")
            assumed.append(f"{name}: dimensiones ilustrativas para dibujar; faltan medidas del bloque.")
        if sw <= 0 or sd <= 0:
            raise ValueError(f"Dimensiones inválidas para {name}")
        item = {"id": eid, "master_entity_id": eid, "name": name, "kind": _kind_from_name(name), "w": sw, "d": sd, "count": n, "t": 0, "t_source": "supuesto", "ops": 0}
        if one(rows, "locked"):
            item.update(locked=True, lock_reason="Restricción del contexto aceptado")
        point = region_point(region, width, depth)
        xf, zf = one(rows, "x"), one(rows, "z")
        if xf and zf and meters(xf) is not None and meters(zf) is not None:
            point = (meters(xf), meters(zf))
            fixed[eid] = [*point, 0]
        elif not location:
            assumed.append(f"{name}: falta confirmar su ubicación física; la posición dibujada es provisional.")
        targets[eid] = point
        if kind == "gate":
            row, col = region_of(region)
            gate_point = point if xf and zf else (0 if col == "izquierda" else width, point[1]) if row == "centro" and col != "centro" else (point[0], 0 if row == "fondo" else depth)
            item.update(x=gate_point[0], z=gate_point[1], label=name)
            plant["gates"].append(item)
        elif kind == "zone":
            item.update(kind="pasillo" if "pasillo" in normalize(name) else "area", x=point[0], z=point[1])
            plant["zones"].append(item)
        elif kind == "conveyor":
            assumed.append(f"{name}: falta confirmar la trayectoria del transportador; no se inventó una banda.")
        else:
            plant["stations"].append(item)
        relations.extend(f for f in rows if f["field"] in ("flow_to", "near"))
    if not plant["stations"]:
        raise ValueError("No hay máquinas o estaciones aceptadas para construir el plano.")
    placed = []
    for station in sorted(plant["stations"], key=lambda s: (s["id"] not in fixed, s["id"] not in targets)):
        eid = station["id"]
        if eid in fixed:
            pos = fixed[eid]
        else:
            target = targets[eid]
            near = next((r for r in relations if r["entity_id"] == eid and r["field"] == "near"), None)
            if near:
                other_id = entity_id(near["target"])
                other = next((s for s in plant["stations"] if s["id"] == other_id), None)
                other_pos = plant["layout"].get(other_id)
                if other and other_pos:
                    target = (other_pos[0] + (station["w"] + other["w"]) / 2 + 1.2, other_pos[1])
            pos, _ = nearest_free(plant, station, target, placed)
        plant["layout"][eid] = pos
        placed.append(rect_at(station, pos))
    known = {s["id"] for s in plant["stations"]}
    def reaches(start, end):
        todo, seen = [start], set()
        while todo:
            node = todo.pop()
            if node == end:
                return True
            if node not in seen:
                seen.add(node)
                todo.extend(r["to"] for r in plant["routes"] if r["from"] == node)
        return False
    for relation in relations:
        a, b = relation["entity_id"], entity_id(relation["target"])
        if relation["field"] == "flow_to" and a in known and b in known and a != b and not any(r["from"] == a and r["to"] == b for r in plant["routes"]):
            plant["routes"].append({"id": "ruta-" + digest([a, b])[:16], "from": a, "to": b, "flow": "material", "frac": 1.0, "is_return": reaches(b, a), "frequency_unknown": True, "master_fact_id": relation["id"]})
    if plant["gates"]:
        plant.update(receive_gate=plant["gates"][0]["id"], dispatch_gate=plant["gates"][-1]["id"])
    report = verify(master, plant)
    return {"plant": plant, "source": "maestro aceptado", "notes": ["Reconstrucción desde las afirmaciones aceptadas; revisa los requisitos y las posiciones provisionales.", *assumed], "verification": report,
            "assumptions": [], "ai_assumptions": [], "spatial": {"agents": ["constructor del maestro", "verificador"], "notes": []}, "context_version": report["master_revision"], "error": None}
