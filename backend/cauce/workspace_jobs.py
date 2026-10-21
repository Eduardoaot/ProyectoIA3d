"""Trabajos recuperables por bloques. Las revisiones aceptadas nunca se pisan."""
from __future__ import annotations

import asyncio
from collections import Counter
import re
import uuid
from pathlib import Path

from .agents.context_workspace import TOPIC_GUIDANCE, organize_context
from .agent_input import chunk_limit, split_text, InputBudget
from .versions import digest
from .workspace import merge_result, normalize
from . import workspace_store as store

TASKS = {}
STUDY_TYPES = {"cursograma_analitico": None, "hoja_tiempos": "study-times.md", "mapa_proceso": "study-process.md"}
COORDINATOR_SCHEMA = {"type": "object", "properties": {"types": {"type": "array", "items": {"type": "string", "enum": [*STUDY_TYPES, "desconocido"]}}, "reason": {"type": "string"}}, "required": ["types", "reason"], "additionalProperties": False}
STUDY_SCHEMA = {"type": "object", "properties": {"activities": {"type": "array", "items": {
    "type": "object", "properties": {"description": {"type": "string"}, "excerpt": {"type": "string"},
        "type": {"type": "string", "enum": ["operacion", "transporte", "inspeccion", "espera", "almacenamiento"]},
        "externalId": {"type": "string"}, "time": {"type": ["number", "null"]}, "timeUnit": {"type": "string", "enum": ["s", "min", "h"]},
        "distance": {"type": ["number", "null"]}, "time_samples": {"type": "array", "items": {"type": "number"}}, "predecessors": {"type": "array", "items": {"type": "string"}}},
    "required": ["description", "excerpt", "type", "externalId", "time", "timeUnit", "distance", "predecessors", "time_samples"], "additionalProperties": False,
}}}, "required": ["activities"], "additionalProperties": False}


def blocks(text, limit=None):
    """No trunca: cada carácter pertenece a un bloque con desplazamiento original."""
    return [{"index": index, **part} for index, part in enumerate(split_text(text, limit))]


def selected_topics(text, topic=None):
    if topic in TOPIC_GUIDANCE:
        return (topic,)
    cues = {
        "negocio": "cliente|demanda|producto|fabric|pedido|objetivo",
        "tiempos": "minut|segundo|hora|ciclo|espera|tiempo",
        "maquinas": "maquina|equipo|horno|ancho|metro|espacio|ubic",
        "flujo": "flujo|material|ruta|transport|entrada|salida|regres",
        "personal": "persona|operador|operari|turno|personal",
        "calidad": "calidad|defecto|inspecc|rechazo|retrabajo",
        "restricciones": "fijo|no se puede|no mover|restric|presupuesto",
        "referencias": "foto|imagen|plano adjunto",
    }
    normalized = normalize(text)
    return tuple(["operaciones"] + [topic for topic, pattern in cues.items() if re.search(pattern, normalized)])


def supported_number(value, excerpt):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("Valor numérico inválido")
    number = float(value)
    if number < 0 or not number < float("inf"):
        raise ValueError("Valor numérico inválido")
    numbers = [float(n.replace(",", ".")) for n in re.findall(r"(?<!\w)\d+(?:[.,]\d+)?", excerpt)]
    if number not in numbers:
        raise ValueError("La magnitud no está respaldada por el fragmento original")
    return number


async def interpret_block(kind, block, provider, source_id=None, topic=None):
    text = block["text"]
    if kind == "context":
        result = await organize_context(text, provider, selected_topics(text, topic))
        if result["errors"] and not result["proposals"]:
            raise ValueError("; ".join(f"{k}: {v}" for k, v in result["errors"].items()))
        for proposal in result["proposals"]:
            proposal.update(source_id=source_id, offset=block["offset"] + text.index(proposal["excerpt"]))
        return {"proposals": result["proposals"], "warnings": result["errors"]}
    prompts = Path(__file__).with_name("agents")
    inventory = []
    try:
        coordinator = prompts.joinpath("study-coordinator.md").read_text(encoding="utf-8")
        InputBudget(provider).require(coordinator, text, COORDINATOR_SCHEMA)
        classification = await provider.json(coordinator, text, COORDINATOR_SCHEMA)
        inventory = [t for t in classification.get("types", []) if t in STUDY_TYPES]
    except Exception:
        pass  # La interpretación genérica sigue disponible; no se afirma haber identificado el formato.
    prompt = prompts.joinpath("study-reader.md").read_text(encoding="utf-8")
    for kind_name in inventory:
        if STUDY_TYPES[kind_name]:
            prompt += "\n" + prompts.joinpath(STUDY_TYPES[kind_name]).read_text(encoding="utf-8")
    InputBudget(provider).require(prompt, text, STUDY_SCHEMA)
    raw = await provider.json(prompt, text, STUDY_SCHEMA)
    if not isinstance(raw, dict) or not isinstance(raw.get("activities"), list):
        raise ValueError("El especialista no devolvió una lista de actividades")
    activities, warnings, cursors = [], [], {}
    for item in raw["activities"]:
        try:
            excerpt, description = str(item.get("excerpt") or "").strip(), str(item.get("description") or "").strip()
            if not excerpt or excerpt not in text or not description or item.get("type") not in ("operacion", "transporte", "inspeccion", "espera", "almacenamiento"):
                raise ValueError("Actividad sin evidencia literal, descripción o tipo válido")
            position = text.find(excerpt, cursors.get(excerpt, 0))
            if position < 0:
                raise ValueError("La respuesta repite un fragmento más veces que el original")
            cursors[excerpt] = position + len(excerpt)
            offset = block["offset"] + position
            fingerprint = digest([source_id, excerpt, offset])
            activity = {"id": f"actividad-{fingerprint[:24]}", "fingerprint": fingerprint, "description": description,
                "excerpt": excerpt, "offset": offset, "sourceId": source_id or "", "source_id": source_id,
                "type": item["type"], "time": supported_number(item.get("time"), excerpt), "timeUnit": item.get("timeUnit", "min"),
                "distance": supported_number(item.get("distance"), excerpt), "stationId": "", "routeId": "", "status": "pending",
                "externalId": str(item.get("externalId") or ""), "predecessors": [str(v) for v in item.get("predecessors", [])]}
            activity["time_samples"] = [supported_number(sample, excerpt) for sample in item.get("time_samples", [])]
            available = Counter(float(n.replace(",", ".")) for n in re.findall(r"(?<!\w)\d+(?:[.,]\d+)?", excerpt))
            if any(count > available[number] for number, count in Counter(activity["time_samples"]).items()):
                raise ValueError("La respuesta repite observaciones numéricas que el original no contiene")
            if activity["timeUnit"] not in ("s", "min", "h"):
                raise ValueError("Unidad de tiempo no soportada")
            activities.append(activity)
        except (ValueError, TypeError, AttributeError) as exc:
            warnings.append(str(exc))
    if raw["activities"] and not activities:
        raise ValueError("Ninguna actividad tenía evidencia válida: " + "; ".join(warnings))
    numbered = set(re.findall(r"^\s*(\d+)[.)]\s+", text, re.MULTILINE))
    returned = {a["externalId"] for a in activities}
    missing = numbered - returned
    if missing:
        warnings.append("Filas numeradas no identificadas en la respuesta: " + ", ".join(sorted(missing, key=int)))
    return {"activities": activities, "warnings": warnings, "inventory": [{"type": t, "status": "identified_unconfirmed", "source_id": source_id} for t in inventory or ["desconocido"]]}


async def run(workspace_id, job_id, provider):
    value = store.job(workspace_id, job_id)
    value.update(status="running")
    store.save_job(workspace_id, value)
    try:
        if value["kind"] == "context":
            from .agents.context_pipeline import organize
            from .context_master import accepted_master
            async def progress(stage, details):
                if store.job(workspace_id, job_id)["status"] == "cancelled":
                    raise asyncio.CancelledError()
                value.update(stage=stage, stage_progress=details)
                store.save_job(workspace_id, value)
            previous = accepted_master(store.read(workspace_id)["project"])
            project = store.read(workspace_id)["project"]
            from .context import current
            documents = [{"id": d["id"], "kind": "document", "name": d["name"], "text": d["text"]} for d in store.documents(workspace_id) if d.get("status") == "text_extracted" and not d.get("truncated")]
            documents.extend({"id": "entrada-" + e["id"], "entry_id": e["id"], "kind": "vision_reading" if e.get("interpreted") else "manual", "text": str(e.get("key", "")) + ": " + str(e.get("value", ""))} for e in current(project.get("context")) if e.get("segment") != "referencias" or e.get("interpreted"))
            if sum(len(d["text"]) for d in documents) + len(value["text"]) > 500000:
                raise ValueError("El conjunto de fuentes supera 500 000 caracteres; divide el expediente para conservar una lectura completa.")
            result = await organize(value["text"], provider, value.get("source_id"), progress, previous, documents, project.get("contextWorkspace", {}).get("source_policy"), value.setdefault("agent_cache", {}))
            value.update(result={**result, "activities": []}, processed=len(value["text"]))
            value["errors"] = result["warnings"]
            saved = store.mutate(workspace_id, value["base_revision"], lambda project: merge_result(project, value["result"]))
            value.update(status="partial" if result["warnings"] else "done", stage="review", applied_revision=saved["revision"])
            return
        for block in blocks(value["text"]):
            if block["index"] in value["completed_blocks"]:
                continue
            if store.job(workspace_id, job_id)["status"] == "cancelled":
                value["status"] = "cancelled"
                return
            try:
                part = await interpret_block(value["kind"], block, provider, value.get("source_id"), value.get("topic"))
                value["result"]["proposals"].extend(part.get("proposals", []))
                value["result"]["activities"].extend(part.get("activities", []))
                inventory = value["result"].setdefault("inventory", [])
                for study in part.get("inventory", []):
                    if study not in inventory:
                        inventory.append(study)
                if part.get("warnings"):
                    value["errors"].append({"block": block["index"], "detail": part["warnings"]})
                value["completed_blocks"].append(block["index"])
            except Exception as exc:
                value["errors"].append({"block": block["index"], "detail": str(exc)[:400]})
            value["processed"] = block["offset"] + len(block["text"])
            store.save_job(workspace_id, value)
        if not value["completed_blocks"]:
            value["status"] = "error"
        else:
            for index, item in enumerate(value["result"]["activities"]):
                item["sequence"] = index + 1
            value["result"].update(source="ia", warnings=value["errors"], blocks={"completed": value["completed_blocks"], "total": len(blocks(value["text"]))})
            try:
                saved = store.mutate(workspace_id, value["base_revision"], lambda project: merge_result(project, value["result"]))
                value.update(status="partial" if value["errors"] else "done", applied_revision=saved["revision"])
            except store.Conflict:
                value.update(status="conflict", error="El expediente cambió mientras se interpretaba. El resultado está conservado; repite con la versión actual.")
    except store.Conflict:
        value.update(status="conflict", error="El expediente cambió durante la interpretación. El maestro se conserva para revisión; no se aplicó sobre tus cambios.")
    except asyncio.CancelledError:
        value.update(status="cancelled")
    except Exception as exc:
        value.update(status="error", error=str(exc)[:400])
    finally:
        store.save_job(workspace_id, value)
        TASKS.pop(job_id, None)


def launch(workspace_id, body, provider):
    saved = store.read(workspace_id)
    if saved["revision"] != body.expected_revision:
        raise store.Conflict("El expediente cambió antes de iniciar la interpretación.")
    text = body.text
    if body.source_id:
        document, _ = store.document(workspace_id, body.source_id)
        if document.get("status") != "text_extracted":
            raise ValueError("El documento está pendiente de lectura")
        if document.get("truncated"):
            raise ValueError("El documento excede el límite de texto de esta lectura. Divídelo en partes; no se interpretará una vista incompleta como el documento entero.")
        text = document["text"]
    if not text.strip() or len(text) > 500000:
        raise ValueError("Proporciona entre 1 y 500 000 caracteres. Divide documentos mayores sin omitir su contenido.")
    value = {"id": uuid.uuid4().hex, "kind": body.kind, "topic": body.topic, "source_id": body.source_id,
        "text": text, "base_revision": saved["revision"], "status": "queued", "created": store.now(),
        "processed": 0, "total": len(text), "chunk_chars": chunk_limit(), "completed_blocks": [], "errors": [], "result": {"proposals": [], "activities": []}}
    if body.retry_job_id:
        previous = store.job(workspace_id, body.retry_job_id)
        if previous["text"] != text or previous["kind"] != body.kind:
            raise ValueError("El texto o el tipo cambió; inicia una interpretación nueva")
        if body.kind == "studies" and previous.get("chunk_chars", 1800) != chunk_limit():
            raise ValueError("Cambió el tamaño de bloque; inicia una interpretación nueva para conservar offsets correctos")
        if body.kind == "context":
            value["agent_cache"] = previous.get("agent_cache", {})
        failed = {error["block"] for error in previous["errors"] if "block" in error}
        complete = [b for b in previous["completed_blocks"] if b not in failed]
        ranges = [(b["offset"], b["offset"] + len(b["text"])) for b in blocks(text) if b["index"] in complete]
        value["completed_blocks"] = complete if body.kind == "studies" else []
        for key in ("proposals", "activities"):
            value["result"][key] = [row for row in previous["result"][key] if any(start <= row.get("offset", -1) < end for start, end in ranges)]
    store.save_job(workspace_id, value)
    TASKS[value["id"]] = asyncio.create_task(run(workspace_id, value["id"], provider))
    return value
