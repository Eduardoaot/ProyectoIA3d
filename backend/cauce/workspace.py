"""Consolidación y revisión deterministas del contexto; ninguna IA guarda hechos."""
from __future__ import annotations

import copy
import re
import uuid

from . import context as ctx
from .versions import digest
from .workspace_store import now

TOPICS = (*ctx.SEGMENTS, "estudios")


def normalize(value):
    import unicodedata
    return re.sub(r"\s+", " ", "".join(c for c in unicodedata.normalize("NFD", str(value)) if unicodedata.category(c) != "Mn")).strip().lower()


def prepare(project):
    p = copy.deepcopy(project)
    workspace = p.setdefault("contextWorkspace", {})
    for key in ("proposals", "attachments", "activities", "operators", "questions", "study_inventory"):
        workspace.setdefault(key, [])
    p.setdefault("context", {"segments": {}})
    detect_conflicts(p)
    return p


def merge_result(project, result):
    """Solo agrega propuestas nuevas. Respeta descartes, revisiones y ediciones manuales."""
    workspace = project.setdefault("contextWorkspace", {})
    for key in ("proposals", "activities"):
        existing = workspace.setdefault(key, [])
        def fingerprint(value):
            if value.get("entity_id"):
                return digest([value["entity_id"], value.get("field"), value.get("target"), value.get("scope"), value.get("number"), value.get("unit"), value.get("excerpt"), value.get("source_id"), value.get("value")])
            return digest([value.get("topic"), value.get("excerpt"), value.get("label") or value.get("description")])
        seen = {v.get("fingerprint") or fingerprint(v) for v in existing}
        for value in result.get(key, []):
            fp = value.get("fingerprint") or fingerprint(value)
            if fp not in seen:
                existing.append({**value, "fingerprint": fp})
                seen.add(fp)
    if result.get("inventory"):
        workspace["study_inventory"] = result["inventory"]
    if result.get("master"):
        workspace["masterDraft"] = result["master"]
        workspace["questions"] = result["master"].get("questions", [])
    workspace["last_interpretation"] = {k: result.get(k) for k in ("source", "warnings", "coverage", "blocks")}
    detect_conflicts(project)


def detect_conflicts(project):
    proposals = project.get("contextWorkspace", {}).get("proposals", [])
    grouped = {}
    for item in proposals:
        if item.get("status") in ("pending", "blocked"):
            if item.get("entity_id") and item.get("field"):
                key = (item["entity_id"], item["field"], item.get("target"), item.get("scope"))
                if item["field"] not in ("count", "width", "depth", "x", "z", "operators", "location", "locked"):
                    key = (*key, item["id"])
            else:
                key = (item.get("topic"), normalize(item.get("label")))
            grouped.setdefault(key, []).append(item)
    for items in grouped.values():
        def signature(p):
            if p.get("entity_id") and p.get("number") is not None:
                factor = {"cm": 0.01, "mm": 0.001}.get(normalize(p.get("unit", "")), 1)
                return str(round(p["number"] * factor, 8))
            return digest([normalize(p.get("value")), p.get("unit")])
        conflict = len({signature(p) for p in items}) > 1
        if conflict:
            for item in items:
                item.update(status="blocked", conflict_kind="inconsistent_values", conflict="Hay valores diferentes para este dato. Corrige o descarta antes de confirmar.")
        else:
            for item in items:
                if item.get("conflict_kind") == "inconsistent_values":
                    item.update(status="pending")
                    item.pop("conflict", None)
                    item.pop("conflict_kind", None)


def confirm(project, ids, target="proposals"):
    workspace = project.setdefault("contextWorkspace", {})
    collection = workspace.setdefault(target, [])
    found = {v["id"] for v in collection}
    if set(ids) - found:
        raise ValueError("El lote contiene identificadores que no existen en esta revisión.")
    accepted, blocked = [], []
    for value in collection:
        if value["id"] not in ids:
            continue
        if value.get("status") == "confirmed":
            accepted.append(value["id"])
            continue
        if value.get("status") in ("blocked", "discarded") or value.get("conflict"):
            blocked.append({"id": value["id"], "reason": value.get("conflict") or "Propuesta descartada o bloqueada"})
            continue
        if target == "proposals":
            topic, label = value.get("topic"), str(value.get("label") or "").strip()
            if topic not in TOPICS or not label or value.get("value") in (None, ""):
                blocked.append({"id": value["id"], "reason": "Falta tema, descripción o valor"})
                continue
            context = project.setdefault("context", {"segments": {}})
            typed_key = f"{topic}.{value['entity_id']}.{value['field']}.{value.get('scope', 'current')}.{normalize(value.get('target', ''))}" if value.get("entity_id") and value.get("field") else None
            key = value.get("key") or typed_key or f"{topic}.{label}"
            previous = next((v for v in ctx.current(context) if v.get("key") == key), None)
            segment = context.setdefault("segments", {}).setdefault(topic, [])
            entry = {
                "id": f"{topic}-{uuid.uuid4().hex}", "segment": topic, "key": key,
                "version": (previous.get("version", 1) + 1) if previous else 1,
                "date": now()[:10], "value": value["value"], "source": value.get("source") or "usuario",
                "label": f"{value['entity']} — {label}" if value.get("entity") else label,
                "confidence": value.get("confidence") or "baja",
                "evidence": {"excerpt": value.get("excerpt", ""), "source_id": value.get("source_id"), "proposal_id": value["id"]},
            }
            for optional in ("unit", "owner", "category", "entity", "field"):
                if value.get(optional):
                    entry[optional] = value[optional]
            if previous:
                entry["supersedes"] = previous["id"]
            segment.append(entry)
            value["entry_id"] = entry["id"]
        elif not str(value.get("name") if target == "operators" else value.get("description") or "").strip():
            blocked.append({"id": value["id"], "reason": "Actividad sin descripción"})
            continue
        value.update(status="confirmed", confirmedAt=now())
        accepted.append(value["id"])
    project["printed"] = False
    return {"accepted": accepted, "blocked": blocked}


def accepted_context(project):
    context = copy.deepcopy(project.get("context") or {"segments": {}})
    if isinstance(context, str):
        context = {"story": context, "segments": {}}
    workspace = project.get("contextWorkspace", {})
    context["activities"] = [a for a in workspace.get("activities", []) if a.get("status") == "confirmed"]
    context["operators"] = [o for o in workspace.get("operators", []) if o.get("status") == "confirmed"]
    from .context_master import accepted_master
    context["master"] = accepted_master(project)
    return context


def coverage(project):
    plant = project.get("draft") or project.get("plant") or {}
    entries = ctx.current(project.get("context"))
    topics = {v.get("segment") for v in entries}
    questions = []
    def ask(key, topic, question, reason, blocking=False):
        questions.append({"id": key, "topic": topic, "question": question, "reason": reason, "blocking": blocking})
    if not plant.get("stations") and "maquinas" not in topics:
        ask("resources", "maquinas", "¿Qué máquinas o áreas intervienen y cuántas unidades hay?", "Necesitamos identificar los recursos para preparar el plano.", True)
    if not plant.get("routes") and "flujo" not in topics and "operaciones" not in topics:
        ask("flow", "flujo", "¿Por dónde empieza el material, qué caminos toma y dónde termina?", "El proceso puede tener varias ramas y regresos.")
    # Un tamaño de boceto generado no constituye una medición de la distribución actual.
    measured_space = any(e.get("segment") == "maquinas" and re.search(r"metro|\bm\b|ancho|fondo|ubic|junto|frente", normalize(str(e.get("value")) + " " + str(e.get("unit", "")))) for e in entries)
    if not measured_space:
        ask("space", "maquinas", "¿Cuáles son las medidas del lugar y dónde están hoy los equipos?", "Un proceso describe el orden del trabajo, pero no sus posiciones físicas.")
    if "restricciones" not in topics and not any(s.get("locked") for s in plant.get("stations", [])):
        ask("fixed", "restricciones", "¿Qué equipos o áreas no se pueden mover?", "Evita proponer cambios que no se puedan ejecutar.")
    if "negocio" not in topics:
        ask("goals", "negocio", "¿Qué produces y qué problema quieres mejorar primero?", "Permite evaluar la mejora en función de tu objetivo.")
    for value in project.get("contextWorkspace", {}).get("proposals", []):
        if value.get("status") == "blocked":
            ask(f"conflict-{value['id']}", value.get("topic"), f"¿Cuál es el valor correcto de «{value.get('label')}»?", value.get("conflict", "Hay datos incompatibles."))
    master = project.get("contextWorkspace", {}).get("masterDraft") or {}
    for item in master.get("questions", []):
        if item.get("status") == "unresolved":
            ask(item["id"], "maquinas", item["question"], "El intérprete y los especialistas no pudieron resolverlo con las fuentes disponibles.")
    answers = project.get("contextWorkspace", {}).get("question_answers", {})
    return {"questions": [q for q in questions if not answers.get(q["id"])], "topics_with_data": sorted(topics), "accepted_entries": len(entries)}
