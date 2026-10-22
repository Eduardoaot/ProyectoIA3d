"""Intérprete → especialistas ↔ aclaración → consolidador explícito → maestro revisable."""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

from ..agent_input import InputBudget, chunk_limit, entity_memory, memory_slice, split_text
from ..context_master import FACT_SCHEMA, TOPICS, assemble, clean_fact, locate
from ..workspace import normalize
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


# Señales por tema para no depender solo del intérprete al repartir el trabajo.
TOPIC_CUES = {
    "negocio": ("negocio", "cliente", "demanda", "venta", "pedido", "producto", "empresa", "mercado"),
    "operaciones": ("operacion", "proceso", "ensambl", "fabricacion", "etapa", "secuencia", "montaje"),
    "tiempos": ("tiempo", "minuto", "hora", "segundo", "ciclo", "turno", "takt", "espera"),
    "maquinas": ("maquina", "equipo", "estacion", "nave", "metro", "dimension", "area", "superficie"),
    "flujo": ("flujo", "material", "recorrido", "transporte", "traslado", "almacen", "montacarga", "ruta"),
    "personal": ("personal", "operador", "operari", "supervisor", "trabajador", "plantilla"),
    "calidad": ("calidad", "inspeccion", "prueba", "defecto", "retrabajo", "rechazo"),
    "restricciones": ("restriccion", "fijo", "no se puede", "no puede moverse", "limite", "presupuesto", "norma"),
    "estudios": ("estudio", "cursograma", "cronometr", "hoja de tiempos", "diagrama de proceso"),
    "referencias": ("imagen", "foto", "plano adjunto", "layout"),
}
TOPIC_NAMES = {"negocio": "negocio", "operaciones": "operaciones", "tiempos": "tiempos", "maquinas": "maquinas", "flujo": "flujo de materiales", "personal": "personal", "calidad": "calidad", "restricciones": "restricciones", "estudios": "estudios del trabajo", "referencias": "imagenes y layouts"}


def topic_hits(topic, text):
    """Cuántas señales del tema hay en el texto; un encabezado con su nombre pesa más."""
    folded = normalize(text)
    hits = sum(folded.count(cue) for cue in TOPIC_CUES.get(topic, ()))
    headings = [normalize(line) for line in text.splitlines() if line.lstrip().startswith("#")]
    if any(TOPIC_NAMES[topic].split()[0] in heading for heading in headings):
        hits += 10
    return hits


def source_for(excerpt, sources):
    """Fuente que contiene la evidencia, aunque el modelo haya cambiado espacios o formato."""
    return next(s for s in sources if excerpt and locate(excerpt, s["text"])[0] >= 0)


def semantic_sources(text, source_id=None, limit=None):
    """Cortes por párrafo/encabezado; conserva todos los caracteres y offsets."""
    prefix = f"{source_id or 'relato'}:{digest(text)[:12]}"
    return [{"id": f"{prefix}:{part['offset']}", "document_id": source_id, "kind": "text", **part} for part in split_text(text, limit)]


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
    budget = InputBudget(provider)
    policy = source_policy or {"default": "text", "images": "location_only"}
    interpreter_prompt = PROMPTS.joinpath("interpreter.md").read_text(encoding="utf-8")
    specialist_prompt = PROMPTS.joinpath("context-specialist.md").read_text(encoding="utf-8")
    consolidator_prompt = PROMPTS.joinpath("master-consolidator.md").read_text(encoding="utf-8")

    def shared(source):
        names, unloaded = entity_memory(entities, source["text"])
        return {"entities": names, "entities_not_loaded": unloaded, "source_policy": policy}

    async def phase(stage, **details):
        if progress:
            await progress(stage, details)

    async def ask(role, prompt, payload, schema):
        started = time.monotonic()
        record = {"agent": role, "input": json.loads(json.dumps(payload, ensure_ascii=False)), "status": "running"}
        trace.append(record)
        try:
            serialized = json.dumps(payload, ensure_ascii=False)
            record["input_budget"] = budget.require(prompt, payload, schema)
            key = digest([role, prompt, payload, schema, getattr(provider, "model", ""), budget.window, budget.output])
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
                        clean_fact(raw, source_for(raw.get("excerpt"), sources))
                    except (ValueError, StopIteration):
                        valid_delivery = False
            if "decisions" in schema.get("properties", {}):
                originals = {f["id"]: f for f in payload["facts"]}
                if {decision["id"] for decision in result["decisions"]} != set(originals):
                    valid_delivery = False
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
        context = shared(source)
        plan = await ask("interprete", interpreter_prompt, {"source": source, "known_entities": context.pop("entities"), **context}, PLAN_SCHEMA)
        entities = list(dict.fromkeys([*entities, *plan["entities"]]))
        assignments.extend({**task, "source": source} for task in plan["assignments"])
        questions.extend(doubt(q, "interprete", source) for q in plan["questions"])
        await phase("interpreting", completed=index + 1, total=len(sources))
    # Un modelo pequeño suele dejar temas sin delegar. Cada tema con señales en el texto se
    # encarga, como mínimo, en las dos fuentes donde más aparece.
    covered = {task["topic"] for task in assignments}
    for topic in TOPICS:
        if topic in covered:
            continue
        ranked = sorted(((topic_hits(topic, source["text"]), index) for index, source in enumerate(sources)), reverse=True)
        for hits, index in ranked[:2]:
            if hits >= 2:
                assignments.append({"topic": topic, "source": sources[index], "instructions": f"Extrae los datos de {TOPIC_NAMES[topic]} que aparecen en esta fuente, cada uno con su evidencia literal."})
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
                result = await ask("especialista:" + topic, specialist_prompt, {"assignment": task["instructions"], "topic": topic, "source": source, **shared(source)}, SPECIALIST_SCHEMA)
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
    clarification_prompt = interpreter_prompt + "\nResuelve las dudas con evidencia literal de esta fuente; omite las que no puedas resolver. No inventes respuestas."
    for source in sources:
        pending = [q for q in questions if q["status"] == "unresolved"]
        if not pending:
            continue
        payload = lambda batch: {"source": source, "questions": batch, **shared(source)}
        for batch in budget.pages(pending, payload, clarification_prompt, RESOLVE_SCHEMA):
            try:
                resolved = await ask("interprete:aclaracion", clarification_prompt, payload(batch), RESOLVE_SCHEMA)
                known = {q["id"]: q for q in batch}
                for answer in resolved["answers"]:
                    if answer["id"] in known and answer["excerpt"] and answer["excerpt"] in source["text"]:
                        known[answer["id"]].update(status="answered", answer=answer["answer"], excerpt=answer["excerpt"], answer_source_id=source["id"])
            except Exception as exc:
                errors.append({"agent": "interprete:aclaracion", "detail": str(exc)[:300]})
            await phase("clarifying", completed=sum(q["status"] == "answered" for q in questions), total=len(questions))
    # Cada especialista recibe la respuesta del intérprete y puede corregir su entrega.
    for handover in handovers:
        handover["clarifications"] = [q for q in questions if q["asked_by"] == handover["specialist"] and q["source_id"] == handover["source_id"]]
        if not any(q["status"] == "answered" for q in handover["clarifications"]):
            continue
        source = next(s for s in sources if s["id"] == handover["source_id"])
        # Cada aclaración es un ciclo independiente; no vuelve a crecer la lista completa.
        for clarification in handover["clarifications"]:
            if clarification["status"] != "answered":
                continue
            previous_rows = [f for f in facts if f["id"] in handover["fact_ids"]]
            payload = lambda batch: {"source": source, "topic": handover["specialist"], "clarifications": [clarification], "previous_facts": batch, **shared(source)}
            for batch in budget.pages(previous_rows, payload, specialist_prompt, SPECIALIST_SCHEMA, max_items=2):
                try:
                    amended = await ask("especialista:revision:" + handover["specialist"], specialist_prompt, payload(batch), SPECIALIST_SCHEMA)
                    revised = [clean_fact(f, source_for(f.get("excerpt"), sources)) for f in amended["facts"]]
                    for row in revised:
                        # Una revisión parcial no borra el resto de la entrega.
                        identity = ("entity_id", "field", "target", "scope")
                        replaced = {f["id"] for f in batch if all(f.get(k) == row.get(k) for k in identity)}
                        facts = [f for f in facts if f["id"] not in replaced] + [row]
                        handover["fact_ids"] = list(dict.fromkeys([k for k in handover["fact_ids"] if k not in replaced] + [row["id"]]))
                    questions.extend(doubt(q, handover["specialist"], source) for q in amended["questions"])
                except Exception as exc:
                    errors.append({"agent": "especialista:revision", "detail": str(exc)[:300]})
    await phase("consolidating", completed=0, total=len(handovers))
    fact_map = {f["id"]: f for f in facts}
    summaries = []
    for index, handover in enumerate(handovers):
        rows = [fact_map[k] for k in handover["fact_ids"]]
        source = next(s for s in sources if s["id"] == handover["source_id"])
        def payload(batch):
            relevant = [{k: f.get(k) for k in ("id", "entity", "field", "target", "number", "unit", "value", "scope")} for f in accepted_facts if f["entity_id"] in {r["entity_id"] for r in batch}]
            corrections, remaining = memory_slice(relevant)
            recent, older = memory_slice(list(reversed(summaries)))
            clarifications, omitted = memory_slice(handover["clarifications"])
            return {"handover": {"specialist": handover["specialist"], "clarifications": clarifications, "clarifications_not_loaded": omitted}, **shared(source), "facts": batch, "previous_sections": recent, "previous_sections_not_loaded": older, "accepted_corrections": corrections, "accepted_corrections_not_loaded": remaining}
        for batch in budget.pages(rows, payload, consolidator_prompt, CONSOLIDATE_SCHEMA, max_items=2):
            try:
                result = await ask("consolidador:" + handover["specialist"], consolidator_prompt, payload(batch), CONSOLIDATE_SCHEMA)
            except Exception as exc:
                errors.append({"agent": "consolidador", "detail": str(exc)[:300]})
                continue
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
    # La misma duda puede surgir de varios agentes sobre la misma fuente: se conserva una vez.
    questions = list({q["id"]: q for q in questions}.values())
    master = assemble([f for f in fact_map.values() if not f.get("duplicate_of")], all_sources, questions, "\n".join(f"{s['topic']}: {s['text']}" for s in summaries), trace, handovers)
    master["errors"] = errors
    master["processing"] = {"chunk_chars": chunk_limit(), "source_chunks": len(sources), "cycles": len(trace), "context_window": budget.window, "reserved_output_tokens": budget.output, "token_estimate": "utf8_bytes/3+128"}
    master["source_policy"] = source_policy or {"default": "text", "images": "location_only"}
    master["pending_visual_sources"] = master["source_policy"].get("default") == "images" and not master["source_policy"].get("manual_image_review") and not any(s.get("kind") == "vision_reading" for s in sources)
    if master["pending_visual_sources"]:
        master["questions"].append({"id": "visual-source-required", "status": "unresolved", "question": "Elegiste las imágenes como referencia principal. Falta interpretarlas con visión o contrastar sus datos manualmente antes de construir."})
    await phase("review", completed=len(master["facts"]), total=len(master["facts"]))
    return {"proposals": master["facts"], "master": master, "warnings": errors, "source": "ia"}
