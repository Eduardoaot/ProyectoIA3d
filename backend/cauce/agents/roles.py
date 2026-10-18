"""Roles de IA: prompt (archivo .md), esquema de salida y capacidades que piden.

| rol       | prompt        | salida                   | proveedor (variable)        |
|-----------|---------------|--------------------------|-----------------------------|
| extractor | extractor.md  | STORY_SCHEMA (story.py)  | CAUCE_EXTRACT_PROVIDER      |
| editor    | editor.md     | EDITOR_SCHEMA            | CAUCE_EDITOR_PROVIDER       |
| contexto  | contexto.md   | texto                    | CAUCE_CONTEXT_PROVIDER      |
| analista  | analista.md   | texto                    | CAUCE_ANALYST_PROVIDER      |
| informe   | informe.md    | texto                    | CAUCE_REPORT_PROVIDER       |
| misiones  | misiones.md   | MISSION_SCHEMA           | CAUCE_MISSIONS_PROVIDER     |
| chat      | chat.md       | texto                    | CAUCE_CHAT_PROVIDER         |
"""

from __future__ import annotations

import pathlib
from functools import lru_cache

HERE = pathlib.Path(__file__).resolve().parent

OPS = ["add", "delete", "move", "update", "connect", "disconnect", "lock", "unlock"]
FLOWS = ["material", "personas", "vehiculos", "carga"]

EDITOR_SCHEMA = {
    "type": "object",
    "properties": {
        "ops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": OPS},
                    "id": {"type": "string"},
                    "kind": {"type": "string"},
                    "name": {"type": "string"},
                    "near": {"type": "string"},
                    "count": {"type": "integer"},
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "frac": {"type": "number"},
                    "flow": {"type": "string", "enum": FLOWS},
                    "set": {"type": "object"},
                    "reason": {"type": "string"},
                },
                "required": ["op"],
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["ops"],
}

MISSION_SCHEMA = {
    "type": "object",
    "properties": {
        "misiones": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"titulo": {"type": "string"}, "detalle": {"type": "string"}, "puntos": {"type": "integer"}, "turno": {"type": "string"}},
                "required": ["titulo", "detalle", "puntos"],
            },
        }
    },
    "required": ["misiones"],
}


def _story_schema():
    from ..story import STORY_SCHEMA  # story.py importa este paquete: se resuelve al usarlo

    return STORY_SCHEMA


ROLES = {
    "extractor": {"prompt": "extractor.md", "schema": _story_schema, "needs": ["json_schema"], "env": "EXTRACT", "temperature": 0.0},
    "editor": {"prompt": "editor.md", "schema": lambda: EDITOR_SCHEMA, "needs": ["json_schema"], "env": "EDITOR", "temperature": 0.0},
    "contexto": {"prompt": "contexto.md", "schema": None, "needs": ["stream"], "env": "CONTEXT", "temperature": 0.2},
    "analista": {"prompt": "analista.md", "schema": None, "needs": ["stream"], "env": "ANALYST", "temperature": 0.4},
    "informe": {"prompt": "informe.md", "schema": None, "needs": ["stream"], "env": "REPORT", "temperature": 0.5},
    "misiones": {"prompt": "misiones.md", "schema": lambda: MISSION_SCHEMA, "needs": ["json_schema"], "env": "MISSIONS", "temperature": 0.3},
    "chat": {"prompt": "chat.md", "schema": None, "needs": ["stream"], "env": "CHAT", "temperature": 0.5},
}


@lru_cache(maxsize=None)
def prompt(role: str) -> str:
    return (HERE / ROLES[role]["prompt"]).read_text(encoding="utf-8").strip()


def schema(role: str):
    f = ROLES[role]["schema"]
    return f() if f else None
