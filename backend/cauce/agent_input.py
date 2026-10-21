"""Lectura por ciclos y presupuesto común de entrada; no requiere un tokenizador externo."""
from __future__ import annotations

import json
import math
import os
import re


def chunk_limit():
    return max(256, min(4000, int(os.getenv("CAUCE_AGENT_CHUNK_CHARS", "1000"))))


def split_text(text, limit=None):
    """Conserva todos los caracteres/offsets; prefiere párrafos y frases completas."""
    limit = chunk_limit() if limit is None else limit
    if limit < 1:
        raise ValueError("El tamaño de bloque debe ser positivo")
    start = 0
    while start < len(text):
        end = min(len(text), start + limit)
        if end < len(text):
            tail = text[start + limit // 2:end]
            boundaries = list(re.finditer(r"\n\n|\n", tail)) or list(re.finditer(r"[.!?]\s+", tail))
            if boundaries:
                end = start + limit // 2 + boundaries[-1].end()
        yield {"offset": start, "text": text[start:end]}
        start = end


def serialized(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class InputBudget:
    """Estimación explícita: bytes UTF-8 / 3 + margen; incluye esquema y reserva de salida."""

    def __init__(self, provider):
        self.window = getattr(provider, "capabilities", {}).get("max_context", 8192)
        self.output = min(getattr(provider, "max_output_tokens", 4096), self.window // 2)

    def measure(self, prompt, payload, schema):
        size = len((prompt + serialized(payload) + serialized(schema)).encode("utf-8"))
        estimate = math.ceil(size / 3) + 128
        return {"estimated_input_tokens": estimate, "reserved_output_tokens": self.output,
                "context_window": self.window, "input_chars": len(serialized(payload)),
                "estimator": "utf8_bytes/3+128"}

    def fits(self, prompt, payload, schema):
        return self.measure(prompt, payload, schema)["estimated_input_tokens"] + self.output <= self.window

    def require(self, prompt, payload, schema):
        if not self.fits(prompt, payload, schema):
            raise ValueError("Una entrega indivisible excede el presupuesto de entrada y salida. No se recortó: reduce CAUCE_AGENT_CHUNK_CHARS o amplía CAUCE_OLLAMA_CONTEXT.")
        return self.measure(prompt, payload, schema)

    def pages(self, rows, payload, prompt, schema, max_items=8):
        """Divide listas antes de consultar al modelo; una fila nunca se corta ni se pierde."""
        batch = []
        for row in rows:
            candidate = [*batch, row]
            if batch and (len(candidate) > max_items or not self.fits(prompt, payload(candidate), schema)):
                yield batch
                batch = []
            self.require(prompt, payload([row]), schema)
            batch.append(row)
        if batch:
            yield batch


def memory_slice(rows, limit=800):
    """Memoria auxiliar limitada; el registro completo permanece fuera del prompt."""
    selected, size = [], 0
    for row in rows:
        length = len(serialized(row))
        if size + length <= limit:
            selected.append(row)
            size += length
    return selected, len(rows) - len(selected)


def entity_memory(entities, text):
    relevant = [name for name in entities if name.casefold() in text.casefold()]
    ordered = list(dict.fromkeys([*relevant, *reversed(entities)]))
    return memory_slice(ordered)
