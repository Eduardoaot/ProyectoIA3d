"""Proveedor y modelo por rol de IA (criterios §7.3).

Roles: extractor, editor, contexto, analista, informe, misiones, chat y espacial.
Cada uno se configura con CAUCE_<ROL>_PROVIDER y CAUCE_<ROL>_MODEL:

| rol       | variables                    | si no están, usa          |
|-----------|------------------------------|---------------------------|
| extractor | CAUCE_EXTRACT_*              | CAUCE_PROVIDER / MODEL    |
| editor    | CAUCE_EDITOR_*               | las del extractor         |
| contexto  | CAUCE_CONTEXT_*              | las del chat              |
| analista  | CAUCE_ANALYST_*              | las del chat              |
| informe   | CAUCE_REPORT_*               | las del chat              |
| misiones  | CAUCE_MISSIONS_*             | las del extractor         |
| chat      | CAUCE_CHAT_*                 | CAUCE_PROVIDER / MODEL    |
| espacial  | CAUCE_SPATIAL_*              | CAUCE_PROVIDER / MODEL    |
| vision    | CAUCE_VISION_*               | las del chat              |

Todos usan llama3.1:8b de Meta por defecto (`ollama pull llama3.1:8b`). Con un
solo modelo Ollama no tiene que cambiar de modelo en memoria entre un agente y
otro. CAUCE_MODEL cambia todos a la vez.
"""

import os

from .base import caps, missing  # noqa: F401
from .ollama import OllamaProvider

DEFAULT_MODEL = "llama3.1:8b"

# rol: (prefijo de variables, rol del que hereda, temperatura, tiempo máximo en s)
ROLE_CONFIG = {
    "extractor": ("EXTRACT", None, 0.0, 300),  # el de 8B tarda en leer una historia larga
    "chat": ("CHAT", None, 0.5, 180),
    "espacial": ("SPATIAL", None, 0.0, 600),  # los agentes esperan su turno en Ollama
    "editor": ("EDITOR", "extractor", 0.0, 300),
    "misiones": ("MISSIONS", "extractor", 0.3, 300),
    "contexto": ("CONTEXT", "chat", 0.2, 180),
    "analista": ("ANALYST", "chat", 0.4, 180),
    "informe": ("REPORT", "chat", 0.5, 180),
    "vision": ("VISION", "chat", 0.2, 300),  # imágenes de referencia: necesita un modelo con visión
}


def _make(kind: str, model: str, temperature: float, timeout: float = 180):
    if kind == "ollama":
        return OllamaProvider(model=model, host=os.getenv("OLLAMA_HOST", "http://localhost:11434"), temperature=temperature, timeout=timeout)
    raise ValueError(f"Proveedor de IA desconocido: {kind}")


def _setting(role: str, what: str, default: str) -> str:
    prefix, parent, *_ = ROLE_CONFIG[role]
    v = os.getenv(f"CAUCE_{prefix}_{what}")
    if v:
        return v
    if parent:
        return _setting(parent, what, default)
    return os.getenv(f"CAUCE_{what}", default)


def get_provider(role: str):
    _, _, temperature, timeout = ROLE_CONFIG[role]
    return _make(_setting(role, "PROVIDER", "ollama"), _setting(role, "MODEL", DEFAULT_MODEL), temperature, timeout)


# Nombres de antes, para no romper a quien los use.
def get_extractor():
    return get_provider("extractor")


def get_engineer():
    return get_provider("chat")


def get_spatial():
    return get_provider("espacial")
