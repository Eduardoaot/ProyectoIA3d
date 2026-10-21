"""Plantilla común con evidencia, identidades estables y revisión derivada de hechos aceptados."""
from __future__ import annotations

import copy
import math
import re

from . import context as ctx
from .versions import digest
from .workspace import normalize

TOPICS = ctx.SEGMENTS
FIELDS = ("description", "count", "width", "depth", "x", "z", "location", "near", "flow_to", "locked", "cycle_time", "operators", "constraint", "goal")
ENTITY_TYPES = ("station", "building", "zone", "gate", "conveyor", "organization")
SCOPES = ("current", "goal", "proposal", "uncertain")

FACT_SCHEMA = {"type": "object", "properties": {
    "topic": {"type": "string", "enum": list(TOPICS)}, "label": {"type": "string"}, "value": {"type": "string"},
    "excerpt": {"type": "string"}, "entity": {"type": "string"}, "entity_type": {"type": "string", "enum": list(ENTITY_TYPES)},
    "field": {"type": "string", "enum": list(FIELDS)}, "target": {"type": "string"},
    "number": {"type": ["number", "null"]}, "unit": {"type": "string"},
    "scope": {"type": "string", "enum": list(SCOPES)},
}, "required": ["topic", "label", "value", "excerpt", "entity", "entity_type", "field", "target", "number", "unit", "scope"], "additionalProperties": False}


def entity_id(name):
    return "ent-" + digest(normalize(name))[:16]


def clean_fact(raw, source, topic=None):
    """El modelo interpreta; la evidencia y las magnitudes se comprueban en código."""
    if not isinstance(raw, dict):
        raise ValueError("Afirmación inválida")
    row = {k: raw.get(k) for k in FACT_SCHEMA["properties"]}
    for key in ("label", "value", "excerpt", "entity", "target", "unit"):
        row[key] = str(row[key] or "").strip()
    row["topic"] = topic or row["topic"]
    if row["topic"] not in TOPICS or row["field"] not in FIELDS or row["entity_type"] not in ENTITY_TYPES or row["scope"] not in SCOPES:
        raise ValueError("Tema, entidad, propiedad o alcance inválido")
    if not all(row[k] for k in ("label", "value", "excerpt", "entity")):
        raise ValueError("Falta descripción, entidad o evidencia")
    offset = source["text"].find(row["excerpt"])
    if offset < 0:
        raise ValueError("La evidencia no aparece en la fuente original")
    extract_numbers = lambda text: {float(n.replace(",", ".")) for n in re.findall(r"(?<!\w)-?\d+(?:[.,]\d+)?", text)}
    if not extract_numbers(row["value"]).issubset(extract_numbers(row["excerpt"])):
        raise ValueError("La explicación añade cifras que su evidencia no contiene")
    if row["number"] is not None:
        number = row["number"]
        numbers = [float(n.replace(",", ".")) for n in re.findall(r"(?<!\w)-?\d+(?:[.,]\d+)?", row["excerpt"])]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or float(number) not in numbers:
            raise ValueError("Magnitud sin respaldo literal; las conversiones se realizan en código")
        if row["field"] in ("count", "operators") and (number < 0 or number != int(number)):
            raise ValueError("La cantidad debe ser un entero no negativo")
    if row["field"] in ("count", "width", "depth", "x", "z", "operators") and row["number"] is None:
        raise ValueError("Falta la magnitud explícita")
    if row["field"] in ("near", "flow_to") and not row["target"]:
        raise ValueError("Falta el destino de la relación")
    row.update(entity_id=entity_id(row["entity"]), source_id=source["id"], offset=source.get("offset", 0) + offset,
               source="usuario", confidence="baja", status="pending")
    row["id"] = "hecho-" + digest([row["entity_id"], row["field"], row["target"], source["id"], row["offset"], row["value"]])[:24]
    return row


def assemble(facts, sources, questions=None, summary="", trace=None, handovers=None):
    unique = {f["id"]: f for f in facts}
    entities = {}
    for fact in unique.values():
        entities.setdefault(fact["entity_id"], {"id": fact["entity_id"], "name": fact["entity"], "type": fact["entity_type"], "fact_ids": []})["fact_ids"].append(fact["id"])
    grouped = {}
    for f in unique.values():
        if f["scope"] == "current" and f["field"] in ("count", "width", "depth", "x", "z", "operators"):
            grouped.setdefault((f["entity_id"], f["field"]), []).append(f)
    conflicts = []
    for (entity, field), rows in grouped.items():
        if len({(f["number"], f["unit"]) for f in rows}) > 1:
            conflict = {"id": "duda-" + digest([entity, field])[:16], "question": f"¿Cuál es el valor vigente de {field} para {rows[0]['entity']}?", "fact_ids": [f["id"] for f in rows], "status": "unresolved"}
            conflicts.append(conflict)
            for f in rows:
                f.update(status="blocked", conflict=conflict["question"])
    revision = digest(sorted((f["id"], f["topic"], f["value"]) for f in unique.values()))
    return {"schema_version": 2, "revision": revision, "status": "draft", "summary": summary,
            "sources": [{k: s[k] for k in ("id", "text", "offset", "kind", "name") if k in s} for s in sources],
            "entities": list(entities.values()), "facts": list(unique.values()),
            "questions": [*(questions or []), *conflicts], "handovers": handovers or [], "trace": trace or [],
            "sections": {t: [f["id"] for f in unique.values() if f["topic"] == t] for t in TOPICS}}


def accepted_master(project):
    """Construye una revisión desde las entradas vigentes, incluidas correcciones manuales."""
    draft = project.get("contextWorkspace", {}).get("masterDraft")
    if not isinstance(draft, dict) or draft.get("schema_version") != 2:
        return None
    accepted = {e.get("evidence", {}).get("proposal_id"): e for e in ctx.current(project.get("context"))}
    facts = []
    for original in draft.get("facts", []):
        entry = accepted.get(original["id"])
        if not entry:
            continue
        row = copy.deepcopy(original)
        row.update(value=entry["value"], topic=entry.get("segment", row["topic"]), status="confirmed")
        # Una corrección de redacción no autoriza reutilizar magnitudes/relaciones anteriores.
        changed = str(entry["value"]) != str(original["value"])
        if changed:
            row.update(scope="uncertain", needs_reinterpretation=True)
        row.pop("conflict", None)
        facts.append(row)
    result = assemble(facts, draft.get("sources", []), draft.get("questions", []), draft.get("summary", ""))
    result.update(status="accepted" if facts else "unaccepted", draft_revision=draft["revision"])
    return result
