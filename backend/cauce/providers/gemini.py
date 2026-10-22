"""Proveedor Gemini por la API Generative Language.

No depende de un SDK: usa la API HTTP oficial para mantener el proveedor
intercambiable y para que la clave nunca quede en el repositorio.
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx


class GeminiProvider:
    name = "gemini"
    api_base = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, model: str, api_key: str, temperature: float = 0.3, timeout: float = 180):
        if not api_key:
            raise ValueError("Falta GEMINI_API_KEY para usar el proveedor gemini.")
        self.model, self.api_key = model, api_key
        self.temperature, self.timeout = temperature, timeout
        self.capabilities = {"json_schema": True, "stream": True, "vision": True, "max_context": 1_000_000}

    @property
    def _headers(self):
        return {"x-goog-api-key": self.api_key}

    async def status(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{self.api_base}/models", headers=self._headers)
                response.raise_for_status()
            models = [item.get("name", "").removeprefix("models/") for item in response.json().get("models", [])]
            return {"online": True, "models": models, "ready": self.model in models}
        except Exception as exc:  # noqa: BLE001
            return {"online": False, "models": [], "ready": False, "error": str(exc)}

    def _body(self, system: str, prompt: str, images: list[str] | None = None, schema: dict | None = None) -> dict:
        parts = [{"text": prompt}]
        for image in images or []:
            mime_type, raw = "image/png", image
            if image.startswith("data:"):
                header, raw = image.split(",", 1)
                mime_type = header.split(";", 1)[0].removeprefix("data:")
            parts.append({"inline_data": {"mime_type": mime_type, "data": raw}})
        config = {"temperature": self.temperature}
        if schema:
            config.update({"response_mime_type": "application/json", "response_json_schema": schema})
        return {"system_instruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": parts}], "generationConfig": config}

    async def _generate(self, system: str, prompt: str, images: list[str] | None = None, schema: dict | None = None) -> str:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(f"{self.api_base}/models/{self.model}:generateContent", headers=self._headers, json=self._body(system, prompt, images, schema))
            response.raise_for_status()
        candidates = response.json().get("candidates", [])
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        text = "".join(part.get("text", "") for part in parts)
        if not text:
            raise ValueError("Gemini no devolvió contenido.")
        return text

    async def json(self, system: str, prompt: str, schema: dict | None = None) -> dict:
        try:
            return json.loads(await self._generate(system, prompt, schema=schema))
        except json.JSONDecodeError as exc:
            raise ValueError("Gemini no devolvió un JSON válido.") from exc

    async def vision(self, system: str, prompt: str, images: list[str]) -> str:
        return await self._generate(system, prompt, images=images)

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        system = "\n".join(m.get("content", "") for m in messages if m.get("role") == "system")
        prompt = "\n".join(m.get("content", "") for m in messages if m.get("role") != "system")
        text = await self._generate(system, prompt)
        for start in range(0, len(text), 128):
            yield text[start : start + 128]
