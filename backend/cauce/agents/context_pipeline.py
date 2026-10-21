"""Intérprete → especialistas ↔ aclaración → consolidador explícito → maestro revisable."""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

from ..context_master import FACT_SCHEMA, TOPICS, assemble, clean_fact
from ..versions import digest

PROMPTS = Path(__file__).parent
PLAN_SCHEMA = {"type": "object", "properties": {
    "entities": {"type": "array", "items": {"type": "string"}},
    "assignments": {"type": "array", "items": {"type": "object", "properties": {"topic": {"type": "string", "enum": list(TOPICS)}, "instructions": {"type": "string"}}, "required": ["topic", "instructions"], "additionalProperties": False}},
    "questions": {"type": "array", "items": {"type": "string"}},
}, "required": ["entities", "assignments", "questions"], "additionalProperties": False}
SPECIALIST_SCHEMA = {"type": "object", "properties": {"facts": {"type": "array", "items": FACT_SCHEMA}, "questions": {"type": "array", "items": {"type": "string"}}}, "required": ["facts", "questions"], "additionalProperties": False}
RESOLVE_SCHEMA = {"type": "object", "properties": {"answers": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "answer": {"type": "string"}, "excerpt": {"type": "string"}}, "required": ["id", "answer", "excerpt"], "additionalProperties": False}}}, "required": ["answers"], "additionalProperties": False}
CONSOLIDATE_SCHEMA = {"type": "object", "properties": {
    "decisions": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "topic": {"type": "string", "enum": list(TOPICS)}, "label": {"type": "string"}, "value": {"type": "string"}, "duplicate_of": {"type": "string"}}, "required": ["id", "topic", "label", "value", "duplicate_of"], "additionalProperties": False}},
    "summary": {"type": "string"}, "questions": {"type": "array", "items": {"type": "string"}},
}, "required": ["decisions", "summary", "questions"], "additionalProperties": False}


def semantic_sources(text, source_id=None, limit=10000):
    """Cortes por párrafo/encabezado; conserva todos los caracteres y offsets."""
    out, start = [], 0
    while start < len(text):
        end = min(len(text), start + limit)
        if end < len(text):
            split = text.rfind("\n\n", start + limit // 2, end)
            if split < 0:
                split = text.rfind("\n", start + limit // 2, end)
            if split >= 0:
                end = split + 1
        out.append({"id": f"{source_id or 'relato'}:{digest(text)[:12]}:{start}", "document_id": source_id, "kind": "text", "offset": start, "text": text[start:end]})
        start = end
    return out


def pages(rows, limit=8000):
    batch, size = [], 0
    for row in rows:
        length = len(json.dumps(row, ensure_ascii=False))
        if batch and size + length > limit:
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += length
    if batch:
        yield batch


async def organize(text, provider, source_id=None, progress=None, previous=None, documents=None, source_policy=None, cache=None):
    from ..agents import check
    sources = semantic_sources(text, source_id)
    for document in documents or []:
        if document.get("id") == source_id or not document.get("text"):
            continue
        parts = semantic_sources(document["text"], document["id"])
        sources.extend({**part, **{k: document[k] for k in ("kind", "name", "entry_id") if k in document}} for part in parts)
    accepted_facts = (previous or {}).get("facts", []) if isinstance(previous, dict) else previous or []
    cache = {} if cache is None else cache
    trace, facts, questions, assignments, entities, handovers, errors = [], [], [], [], [], [], []

    async def phase(stage, **details):
        if progress:
            await progress(stage, details)

    async def ask(role, prompt, payload, schema):
        started = time.monotonic()
        record = {"agent": role, "input": json.loads(json.dumps(payload, ensure_ascii=False)), "status": "running"}
        trace.append(record)
        try:
            serialized = json.dumps(payload, ensure_ascii=False)
            context_limit = getattr(provider, "capabilities", {}).get("max_context", 8192)
            if len(prompt) + len(serialized) > context_limit * 2:
                raise ValueError("La entrega supera el presupuesto de contexto configurado. Divide las fuentes o aumenta CAUCE_OLLAMA_CONTEXT; no se omitirá texto silenciosamente.")
            key = digest([role, prompt, payload, schema, getattr(provider, "model", ""), context_limit])
            record["cache_hit"] = key in cache
            result = cache[key] if key in cache else await provider.json(prompt, serialized, schema)
            problems = check(result, schema)
            if problems:
                raise ValueError("Respuesta fuera de esquema: " + "; ".join(problems[:3]))
            record.update(status="done", output=result)
            valid_delivery = True
            if "facts" in schema.get("properties", {}):
                for raw in result["facts"]:
                    try:
                        clean_fact(raw, next(s for s in sources if raw.get("excerpt") and raw["excerpt"] in s["text"]))
                    except (ValueError, StopIteration):
                        valid_delivery = False
            if "decisions" in schema.get("properties", {}):
                originals = {f["id"]: f for f in payload["facts"]}
                for decision in result["decisions"]:
                    if decision["id"] not in originals:
                        valid_delivery = False
                        continue
                    original = originals[decision["id"]]
                    try:
                        clean_fact({**original, **{k: decision[k] for k in ("topic", "label", "value")}}, next(s for s in sources if s["id"] == original["source_id"]))
                    except (ValueError, StopIteration):
                        valid_delivery = False
            if valid_delivery:
                cache[key] = result
            else:
                cache.pop(key, None)
            return result
        except Exception as exc:
            record.update(status="error", error=str(exc)[:300])
            raise
        finally:
            record["elapsed_s"] = round(time.monotonic() - started, 3)

    def doubt(question, by, source):
        return {"id": "duda-" + digest([question, source["id"]])[:16], "question": question, "asked_by": by, "source_id": source["id"], "status": "unresolved"}

    await phase("interpreting", completed=0, total=len(sources))
    for index, source in enumerate(sources):
        plan = await ask("interprete", PROMPTS.joinpath("interpreter.md").read_text(encoding="utf-8"), {"source": source, "known_entities": entities, "source_policy": source_policy or {"default": "text", "images": "location_only"}}, PLAN_SCHEMA)
        entities = list(dict.fromkeys([*entities, *plan["entities"]]))
        assignments.extend({**task, "source": source} for task in plan["assignments"])
        questions.extend(doubt(q, "interprete", source) for q in plan["questions"])
        await phase("interpreting", completed=index + 1, total=len(sources))
    if not assignments:
        raise ValueError("El intérprete no pudo delegar la lectura. No se generará un contexto vacío como si estuviera completo.")
    await phase("specialists", completed=0, total=len(assignments))
    gate = asyncio.Semaphore(max(1, min(4, int(os.getenv("CAUCE_CONTEXT_CONCURRENCY", "2")))))
    finished = 0

    async def work(task):
        nonlocal finished
        async with gate:
            topic, source = task["topic"], task["source"]
            try:
                result = await ask("especialista:" + topic, PROMPTS.joinpath("context-specialist.md").read_text(encoding="utf-8"), {"assignment": task["instructions"], "topic": topic, "entities": entities, "source": source, "source_policy": source_policy or {"default": "text", "images": "location_only"}}, SPECIALIST_SCHEMA)
                valid = []
                for raw in result["facts"]:
                    try:
                        valid.append(clean_fact(raw, source))
                    except ValueError as exc:
                        errors.append({"agent": topic, "detail": str(exc)})
                facts.extend(valid)
                questions.extend(doubt(q, topic, source) for q in result["questions"])
                handovers.append({"specialist": topic, "source_id": source["id"], "fact_ids": [f["id"] for f in valid], "status": "delivered"})
            except Exception as exc:
                errors.append({"agent": topic, "detail": str(exc)[:300]})
            finished += 1
            await phase("specialists", completed=finished, total=len(assignments))

    await asyncio.gather(*(work(task) for task in assignments))
    handovers.sort(key=lambda handover: (TOPICS.index(handover["specialist"]), handover["source_id"]))
    if not facts:
        raise ValueError("Los especialistas no entregaron afirmaciones con evidencia válida. Revisa el proveedor y las incidencias.")
    await phase("clarifying", completed=0, total=len(questions))
    for source in sources:
        pending = [q for q in questions if q["status"] == "unresolved"]
        if not pending:
            continue
        try:
            resolved = await ask("interprete:aclaracion", PROMPTS.joinpath("interpreter.md").read_text(encoding="utf-8") + "\nResuelve las dudas con evidencia literal de esta fuente; omite las que no puedas resolver. No inventes respuestas.", {"source": source, "questions": pending, "entities": entities}, RESOLVE_SCHEMA)
            known = {q["id"]: q for q in pending}
            for answer in resolved["answers"]:
                if answer["id"] in known and answer["excerpt"] and answer["excerpt"] in source["text"]:
                    known[answer["id"]].update(status="answered", answer=answer["answer"], excerpt=answer["excerpt"], answer_source_id=source["id"])
        except Exception as exc:
            errors.append({"agent": "interprete:aclaracion", "detail": str(exc)[:300]})
    # Cada especialista recibe la respuesta del intérprete y puede corregir su entrega.
    for handover in handovers:
        handover["clarifications"] = [q for q in questions if q["asked_by"] == handover["specialist"]]
        if not any(q["status"] == "answered" for q in handover["clarifications"]):
            continue
        source = next(s for s in sources if s["id"] == handover["source_id"])
        try:
            amended = await ask("especialista:revision:" + handover["specialist"], PROMPTS.joinpath("context-specialist.md").read_text(encoding="utf-8"), {"source": source, "topic": handover["specialist"], "entities": entities, "clarifications": handover["clarifications"], "previous_facts": [f for f in facts if f["id"] in handover["fact_ids"]]}, SPECIALIST_SCHEMA)
            revised = [clean_fact(f, next(s for s in sources if f.get("excerpt") and f["excerpt"] in s["text"])) for f in amended["facts"]]
            if revised:
                facts = [f for f in facts if f["id"] not in handover["fact_ids"]] + revised
                handover["fact_ids"] = [f["id"] for f in revised]
            questions.extend(doubt(q, handover["specialist"], source) for q in amended["questions"])
        except Exception as exc:
            errors.append({"agent": "especialista:revision", "detail": str(exc)[:300]})
    await phase("consolidating", completed=0, total=len(handovers))
    fact_map = {f["id"]: f for f in facts}
    summaries = []
    for index, handover in enumerate(handovers):
        rows = [fact_map[k] for k in handover["fact_ids"]]
        for batch in pages(rows):
            relevant = [{k: f.get(k) for k in ("id", "entity", "field", "target", "number", "unit", "value", "scope")} for f in accepted_facts if f["entity_id"] in {r["entity_id"] for r in batch}]
            result = await ask("consolidador:" + handover["specialist"], PROMPTS.joinpath("master-consolidator.md").read_text(encoding="utf-8"), {"handover": {"specialist": handover["specialist"], "clarifications": handover["clarifications"]}, "entities": entities, "facts": batch, "previous_sections": summaries, "accepted_corrections": relevant, "source_policy": source_policy or {"default": "text", "images": "location_only"}}, CONSOLIDATE_SCHEMA)
            allowed = {f["id"]: f for f in batch}
            delivered = set()
            for decision in result["decisions"]:
                if decision["id"] not in allowed:
                    continue
                original = allowed[decision["id"]]
                # Reformular no permite agregar cifras ni cambiar propiedades estructurales.
                source = next(s for s in sources if s["id"] == original["source_id"])
                try:
                    revised = clean_fact({**original, **{k: decision[k] for k in ("topic", "label", "value")}}, source)
                except ValueError as exc:
                    errors.append({"agent": "consolidador", "detail": str(exc)})
                    continue
                revised["id"] = original["id"]
                fact_map[original["id"]] = revised
                duplicate = fact_map.get(decision["duplicate_of"])
                fields = ("entity_id", "field", "target", "number", "unit", "scope")
                if duplicate and duplicate["id"] < original["id"] and all(revised.get(k) == duplicate.get(k) for k in fields) and (revised["number"] is not None or revised["value"] == duplicate["value"]):
                    revised["duplicate_of"] = duplicate["id"]
                delivered.add(original["id"])
            if delivered != set(allowed):
                errors.append({"agent": "consolidador", "detail": "Se conservaron afirmaciones que el consolidador omitió revisar."})
            if result["summary"]:
                summaries.append({"topic": handover["specialist"], "text": result["summary"]})
            questions.extend(doubt(q, "consolidador", sources[0]) for q in result["questions"])
        handover["status"] = "consolidated"
        await phase("consolidating", completed=index + 1, total=len(handovers))
    for old in accepted_facts:
        fact_map[old["id"]] = old
    old_sources = (previous or {}).get("sources", []) if isinstance(previous, dict) else []
    all_sources = list({s["id"]: s for s in [*old_sources, *sources]}.values())
    master = assemble([f for f in fact_map.values() if not f.get("duplicate_of")], all_sources, questions, "\n".join(f"{s['topic']}: {s['text']}" for s in summaries), trace, handovers)
    master["errors"] = errors
    master["source_policy"] = source_policy or {"default": "text", "images": "location_only"}
    master["pending_visual_sources"] = master["source_policy"].get("default") == "images" and not master["source_policy"].get("manual_image_review") and not any(s.get("kind") == "vision_reading" for s in sources)
    if master["pending_visual_sources"]:
        master["questions"].append({"id": "visual-source-required", "status": "unresolved", "question": "Elegiste las imágenes como referencia principal. Falta interpretarlas con visión o contrastar sus datos manualmente antes de construir."})
    await phase("review", completed=len(master["facts"]), total=len(master["facts"]))
    return {"proposals": master["facts"], "master": master, "warnings": errors, "source": "ia"}
