"""Tres papeles de IA, configurables por separado.

- Extractor: lee la historia y devuelve únicamente el JSON que usa el programa.
  Temperatura 0, sin conversación. CAUCE_EXTRACT_MODEL.
- Ingeniero: conversa, escribe informes y responde preguntas. CAUCE_CHAT_MODEL.
- Espacial: los agentes que leen forma, zonas, acomodo y paredes, y el que
  sugiere el acomodo compacto. CAUCE_SPATIAL_MODEL.

Todos usan llama3.1:8b de Meta por defecto (`ollama pull llama3.1:8b`). Con un
solo modelo Ollama no tiene que cambiar de modelo en memoria entre un agente y
otro. CAUCE_MODEL cambia los tres a la vez; cada uno puede ir a un proveedor
distinto.
"""

import os

from .ollama import OllamaProvider

DEFAULT_MODEL = "llama3.1:8b"


def _make(kind: str, model: str, temperature: float, timeout: float = 180):
    if kind == "ollama":
        return OllamaProvider(model=model, host=os.getenv("OLLAMA_HOST", "http://localhost:11434"), temperature=temperature, timeout=timeout)
    raise ValueError(f"Proveedor de IA desconocido: {kind}")


def _model(var: str) -> str:
    return os.getenv(var, os.getenv("CAUCE_MODEL", DEFAULT_MODEL))


def get_extractor():
    return _make(
        os.getenv("CAUCE_EXTRACT_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        _model("CAUCE_EXTRACT_MODEL"),
        0.0,
        # El modelo de 8B tarda más que el de 3B en leer una historia larga.
        300,
    )


def get_engineer():
    return _make(
        os.getenv("CAUCE_CHAT_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        _model("CAUCE_CHAT_MODEL"),
        0.5,
    )


def get_spatial():
    return _make(
        os.getenv("CAUCE_SPATIAL_PROVIDER", os.getenv("CAUCE_PROVIDER", "ollama")),
        _model("CAUCE_SPATIAL_MODEL"),
        0.0,
        # Los agentes esperan su turno en Ollama: el tiempo cuenta desde que se pide.
        600,
    )
