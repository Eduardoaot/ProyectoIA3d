"""Especialistas por tema y consolidación revisable del contexto de planta.

El JSON maestro es un borrador: nunca se incorpora a la planta sin revisión.
Cada dato publicado conserva un fragmento literal del texto original.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

TOPICS = (
    "negocio", "operaciones", "tiempos", "maquinas", "flujo", "personal",
    "calidad", "restricciones", "estudios", "referencias",
)
TOPIC_GUIDANCE = {
    "negocio": "productos, clientes, demanda, lotes y objetivos comerciales",
    "operaciones": "actividades, secuencias, variantes, entradas y salidas del proceso",
    "tiempos": "tiempos de ciclo, preparación, espera, turnos y unidades de tiempo",
    "maquinas": "equipos, cantidades, dimensiones y ubicación física observada",
    "flujo": "materiales, rutas, frecuencias, ramas, uniones y retornos",
    "personal": "personas, funciones, asignaciones, turnos y responsables",
    "calidad": "inspecciones, defectos, retrabajos y tasas con su período",
    "restricciones": "elementos fijos, seguridad, pasillos y límites de cambio",
    "estudios": "estudios recibidos, actividades observadas, método y toma de tiempos",
    "referencias": "fotos, planos, layouts y qué representan; no afirmes haber visto imágenes",
}

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "label": {"type": "string"},
        "value": {"type": "string"},
        "excerpt": {"type": "string"},
        "unit": {"type": "string"},
        "source": {"type": "string"},
        "confidence": {"type": "string"},
        "owner": {"type": "string"},
    },
    "required": ["label", "value", "excerpt", "unit", "source", "confidence", "owner"],
    "additionalProperties": False,
}
SPECIALIST_SCHEMA = {
    "type": "object", "properties": {"items": {"type": "array", "items": ITEM_SCHEMA}},
    "required": ["items"], "additionalProperties": False,
}
CONSOLIDATOR_SCHEMA = {
    "type": "object",
    "properties": {
        "sections": {"type": "array", "items": {
            "type": "object",
            "properties": {"topic": {"type": "string"}, "ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["topic", "ids"], "additionalProperties": False,
        }},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["sections", "questions"], "additionalProperties": False,
}


def _id(topic: str, excerpt: str, label: str) -> str:
    digest = hashlib.sha256(f"{topic}\0{excerpt}\0{label}".encode()).hexdigest()[:16]
    return f"{topic}-{digest}"


def _clean(raw: object, topic: str, text: str) -> list[dict]:
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        return []
    items = []
    seen = set()
    for item in raw["items"][:30]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()[:100]
        value = str(item.get("value") or "").strip()[:500]
        excerpt = str(item.get("excerpt") or "").strip()[:500]
        if not label or not value or not excerpt or excerpt not in text:
            continue
        item_id = _id(topic, excerpt, label)
        if item_id in seen:
            continue
        seen.add(item_id)
        items.append({
            "id": item_id, "topic": topic, "label": label, "value": value,
            "excerpt": excerpt, "unit": str(item.get("unit") or "").strip()[:40],
            "source": "usuario",  # La interpretación no certifica una medición.
            "confidence": "baja",  # Revisable hasta que el usuario lo confirme.
            "owner": str(item.get("owner") or "").strip()[:100],
            "status": "pending",
        })
    return items


async def organize_context(text: str, provider) -> dict:
    """Un agente por sección y uno que organiza el borrador maestro.

    Si un especialista falla, las demás secciones sobreviven y se informa el fallo.
    El consolidador solo puede referir IDs producidos por especialistas.
    """
    gate = asyncio.Semaphore(2)

    async def specialist(topic: str) -> tuple[str, list[dict], str | None]:
        system = (
            f"Eres el especialista del tema '{topic}' en contexto de planta. Lee todo el relato "
            f"y estructura únicamente {TOPIC_GUIDANCE[topic]}. "
            "y devuelve solo afirmaciones pertinentes a tu tema. Una frase puede pertenecer "
            "a varios temas. Cada item lleva un excerpt copiado literalmente del relato, "
            "label breve y value fiel. No inventes cifras, unidades, personas ni mediciones. "
            "Devuelve items=[] si no hay evidencia. unit, source, confidence y owner pueden "
            "ser cadenas vacías; no adivines procedencia ni certeza."
        )
        try:
            async with gate:
                raw = await provider.json(system, text, SPECIALIST_SCHEMA)
            return topic, _clean(raw, topic, text), None
        except Exception as exc:  # fallo parcial visible, sin perder otros temas
            return topic, [], str(exc)[:160]

    results = await asyncio.gather(*(specialist(topic) for topic in TOPICS))
    by_topic = {topic: items for topic, items, _ in results}
    errors = {topic: error for topic, _, error in results if error}
    proposals = [item for topic in TOPICS for item in by_topic[topic]]
    allowed = {item["id"]: item for item in proposals}
    sections = {topic: [item["id"] for item in by_topic[topic]] for topic in TOPICS}
    questions = []

    if proposals:
        system = (
            "Eres el agente consolidador del contexto. Organiza las propuestas recibidas "
            "en un JSON maestro por tema. Usa exclusivamente los IDs recibidos y no añadas "
            "hechos. Un ID puede aparecer en varios temas si es pertinente. "
            "Escribe preguntas breves sobre contradicciones o datos imprescindibles que "
            "faltan, sin presentar sus respuestas como hechos."
        )
        payload = json.dumps({"topics": list(TOPICS), "proposals": proposals}, ensure_ascii=False)
        try:
            raw = await provider.json(system, payload, CONSOLIDATOR_SCHEMA)
            if isinstance(raw, dict):
                suggested = {topic: [] for topic in TOPICS}
                for section in raw.get("sections", []):
                    if not isinstance(section, dict) or section.get("topic") not in suggested:
                        continue
                    topic = section["topic"]
                    for item_id in section.get("ids", []):
                        if item_id in allowed and item_id not in suggested[topic]:
                            suggested[topic].append(item_id)
                # Una omisión del modelo no hace desaparecer evidencia válida.
                for topic in TOPICS:
                    sections[topic] = list(dict.fromkeys(sections[topic] + suggested[topic]))
                questions = [str(q).strip()[:250] for q in raw.get("questions", [])[:10] if isinstance(q, str) and q.strip()]
        except Exception as exc:
            errors["consolidador"] = str(exc)[:160]

    return {
        "proposals": proposals,
        "master": {"schema_version": 1, "status": "draft", "sections": sections,
                   "items": allowed, "questions": questions},
        "errors": errors,
    }
