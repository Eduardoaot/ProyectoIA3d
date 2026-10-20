"""Versiones de lo que usó un análisis (criterios §1.5).

plant_version: SHA-256 del JSON canónico de la planta (claves ordenadas, sin campos
de vista ni de selección). El mismo plano da siempre la misma versión, aunque cambie
el orden de las claves o el acercamiento de la vista.
context_version: SHA-256 del contexto (texto o segmentado); sin contexto, el de "".
"""

from __future__ import annotations

import hashlib
import json

# Campos que solo describen cómo se ve el plano o qué está seleccionado.
VIEW_KEYS = frozenset({"view", "camera", "cam", "zoom", "selection", "selected", "ui", "collapsed", "expanded", "plant_revision", "revision"})


def _clean(v):
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items() if k not in VIEW_KEYS and not str(k).startswith("_")}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    if isinstance(v, float) and v.is_integer():
        return int(v)  # 12.0 y 12 son el mismo plano
    return v


def canonical(v) -> str:
    return json.dumps(_clean(v), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(v) -> str:
    return hashlib.sha256(canonical(v).encode("utf-8")).hexdigest()


def plant_version(plant: dict) -> str:
    return digest(plant)


def context_version(context) -> str:
    return digest(context if context is not None else "")
