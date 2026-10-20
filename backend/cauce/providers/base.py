"""Interfaz común de proveedores de IA.

Cualquier proveedor (Ollama, una API en la nube, un servidor MCP que exponga
un modelo) implementa estos métodos, declara sus capacidades y se elige por
configuración. El código de negocio nunca importa un cliente concreto.

Agregar un proveedor = una clase que cumpla esta interfaz + una rama en
`providers/__init__.py::_make`.
"""

from __future__ import annotations

from typing import AsyncIterator, Protocol

# Capacidades que puede pedir un rol (criterios §7.3).
DEFAULT_CAPABILITIES = {"json_schema": False, "stream": True, "vision": False, "max_context": 4096}


class Provider(Protocol):
    name: str
    model: str
    capabilities: dict  # {"json_schema": bool, "stream": bool, "vision": bool, "max_context": int}

    async def status(self) -> dict: ...

    async def json(self, system: str, prompt: str, schema: dict | None = None) -> dict: ...

    def stream(self, messages: list[dict]) -> AsyncIterator[str]: ...


def caps(provider) -> dict:
    return {**DEFAULT_CAPABILITIES, **(getattr(provider, "capabilities", None) or {})}


def missing(provider, needs: list[str]) -> list[str]:
    """Capacidades que el rol pide y el proveedor no tiene."""
    c = caps(provider)
    return [n for n in needs if not c.get(n)]
