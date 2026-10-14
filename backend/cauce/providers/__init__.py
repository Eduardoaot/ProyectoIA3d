"""Dos IAs con papeles distintos, configurables por separado.

- Extractor: lee la historia y devuelve únicamente el JSON que usa el programa.
  Temperatura 0, sin conversación. CAUCE_EXTRACT_MODEL.
- Ingeniero: conversa, escribe informes y responde preguntas. CAUCE_CHAT_MODEL.
- Espacial: los agentes que leen forma, zonas, acomodo y paredes, y el que
  sugiere el acomodo compacto. Necesita un modelo más capaz: CAUCE_SPATIAL_MODEL
  (por defecto llama3.1:8b de Meta). Si no está instalado se usa el extractor.

Pueden ser el mismo modelo o modelos distintos (incluso de proveedores distintos).
"""

import os

from .ollama import OllamaProvider


def _make(kind: str, model: str, temperature: float, timeout: float = 180):
    if kind == "ollama":
        return OllamaProvider(model=model, host=os.getenv("OLLAMA_HOST", "http://localhost:11434"), temperature=temperature, timeout=timeout)
    raise ValueError(f"Proveedor de IA desconocido: {kind}")


def get_extractor():
    return _make(
        os.getenv("CAUCE_EXTRACT_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        os.getenv("CAUCE_EXTRACT_MODEL", os.getenv("CAUCE_MODEL", "llama3.2:3b")),
        0.0,
    )


def get_engineer():
    return _make(
        os.getenv("CAUCE_CHAT_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        os.getenv("CAUCE_CHAT_MODEL", os.getenv("CAUCE_MODEL", "llama3.2:3b")),
        0.5,
    )


def get_spatial():
    return _make(
        os.getenv("CAUCE_SPATIAL_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        os.getenv("CAUCE_SPATIAL_MODEL", "llama3.1:8b"),
        0.0,
        # Los agentes esperan su turno en Ollama: el tiempo cuenta desde que se pide.
        600,
    )
