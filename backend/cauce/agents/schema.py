"""Validación mínima de JSON contra un esquema (el subconjunto que usan los agentes:
type, properties, required, items, enum). Sin dependencias."""

from __future__ import annotations

_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "integer": int,
    "number": (int, float),
}


def check(data, schema: dict, path: str = "$") -> list[str]:
    """Lista de errores en palabras; vacía si el JSON cumple el esquema."""
    errors = []
    t = schema.get("type")
    if t:
        py = _TYPES.get(t)
        ok = isinstance(data, py) and not (t in ("integer", "number") and isinstance(data, bool))
        if t == "integer" and isinstance(data, float) and data.is_integer():
            ok = True
        if not ok:
            return [f"{path}: se esperaba {t}"]
    if "enum" in schema and data not in schema["enum"]:
        errors.append(f"{path}: valor fuera de la lista ({data!r})")
    if isinstance(data, dict):
        for k in schema.get("required", []):
            if k not in data:
                errors.append(f"{path}.{k}: falta")
        for k, sub in (schema.get("properties") or {}).items():
            if k in data and data[k] is not None:
                errors += check(data[k], sub, f"{path}.{k}")
    if isinstance(data, list) and "items" in schema:
        for i, x in enumerate(data):
            errors += check(x, schema["items"], f"{path}[{i}]")
    return errors
