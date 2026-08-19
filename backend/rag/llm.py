from __future__ import annotations

from functools import lru_cache

import httpx

from backend.config import get_settings

settings = get_settings()


class LLMProvider:
    def generate(self, prompt: str) -> str:
        raise NotImplementedError


class OllamaLLM(LLMProvider):
    def __init__(self):
        self.base = settings.ollama_base_url.rstrip("/")

    def generate(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if settings.ollama_api_key:
            headers["Authorization"] = f"Bearer {settings.ollama_api_key}"
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(
                f"{self.base}/api/generate",
                headers=headers,
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": settings.llm_temperature},
                },
            )
            response.raise_for_status()
            return (response.json().get("response") or "").strip()


@lru_cache(maxsize=1)
def get_llm() -> LLMProvider:
    if settings.llm_provider == "ollama":
        return OllamaLLM()
    raise RuntimeError(f"Unsupported LLM_PROVIDER={settings.llm_provider}")
