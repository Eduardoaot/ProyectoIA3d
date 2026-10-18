from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

# Deja el modelo cargado entre llamadas: recargar uno de 8B tarda varios segundos.
KEEP_ALIVE = "30m"
# Modelos de Ollama que leen imágenes. llama3.1:8b (el de por defecto) no tiene visión.
VISION_HINTS = ("llava", "vision", "bakllava", "moondream", "minicpm-v", "qwen2.5vl", "qwen2-vl", "gemma3")


class OllamaProvider:
    name = "ollama"

    def __init__(self, model: str, host: str = "http://localhost:11434", temperature: float = 0.3, timeout: float = 180):
        self.model = model
        self.timeout = timeout
        self.host = host.rstrip("/")
        self.temperature = temperature
        self.capabilities = {
            "json_schema": True,  # Ollama acepta un esquema en `format`
            "stream": True,
            "vision": any(h in model.lower() for h in VISION_HINTS),
            "max_context": 8192,
        }

    async def status(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.host}/api/tags")
                r.raise_for_status()
                models = [m["name"] for m in r.json().get("models", [])]
            return {"online": True, "models": models, "ready": self.model in models}
        except Exception as e:  # noqa: BLE001
            return {"online": False, "models": [], "ready": False, "error": str(e)}

    async def json(self, system: str, prompt: str, schema: dict | None = None) -> dict:
        body = {
            "model": self.model,
            "stream": False,
            "format": schema or "json",
            "keep_alive": KEEP_ALIVE,
            "options": {"temperature": self.temperature, "num_predict": 900},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            r = await c.post(f"{self.host}/api/chat", json=body)
            r.raise_for_status()
            return json.loads(r.json()["message"]["content"])

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        body = {"model": self.model, "stream": True, "keep_alive": KEEP_ALIVE, "options": {"temperature": self.temperature}, "messages": messages}
        async with httpx.AsyncClient(timeout=None) as c:
            async with c.stream("POST", f"{self.host}/api/chat", json=body) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        break
