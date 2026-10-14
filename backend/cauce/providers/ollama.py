from __future__ import annotations

import json
from typing import AsyncIterator

import httpx


class OllamaProvider:
    name = "ollama"

    def __init__(self, model: str, host: str = "http://localhost:11434", temperature: float = 0.3, timeout: float = 180):
        self.model = model
        self.timeout = timeout
        self.host = host.rstrip("/")
        self.temperature = temperature

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
            "options": {"temperature": self.temperature, "num_predict": 900},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }
        async with httpx.AsyncClient(timeout=self.timeout) as c:
            r = await c.post(f"{self.host}/api/chat", json=body)
            r.raise_for_status()
            return json.loads(r.json()["message"]["content"])

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        body = {"model": self.model, "stream": True, "options": {"temperature": self.temperature}, "messages": messages}
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
