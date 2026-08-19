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


class GroqLLM(LLMProvider):
    def __init__(self):
        self.base = settings.groq_api_base.rstrip("/")
        self.model = settings.groq_model

    def generate(self, prompt: str) -> str:
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(
                f"{self.base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": settings.llm_temperature,
                    "stream": False,
                },
            )
            if not response.is_success:
                body = (response.text or "").strip().replace("\n", " ")[:800]
                raise RuntimeError(f"Groq HTTP {response.status_code}: {body}")
            payload = response.json()
            choices = payload.get("choices") or []
            if not choices:
                raise RuntimeError("Groq response did not contain choices")
            content = (choices[0].get("message") or {}).get("content")
            if not isinstance(content, str) or not content.strip():
                raise RuntimeError("Groq response did not contain output text")
            return content.strip()


class OpenAILLM(LLMProvider):
    def __init__(self):
        self.base = settings.openai_api_base.rstrip("/")
        self.model = settings.openai_model

    @staticmethod
    def _output_text(payload: dict) -> str:
        direct = payload.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        parts: list[str] = []
        for item in payload.get("output") or []:
            if not isinstance(item, dict):
                continue
            for content in item.get("content") or []:
                if not isinstance(content, dict):
                    continue
                if content.get("type") == "output_text" and content.get("text"):
                    parts.append(str(content["text"]))
        return "\n".join(parts).strip()

    def generate(self, prompt: str) -> str:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")

        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(
                f"{self.base}/responses",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "input": prompt,
                },
            )
            if not response.is_success:
                body = (response.text or "").strip().replace("\n", " ")[:800]
                raise RuntimeError(f"OpenAI HTTP {response.status_code}: {body}")
            text = self._output_text(response.json())
            if not text:
                raise RuntimeError("OpenAI response did not contain output text")
            return text


@lru_cache(maxsize=1)
def get_llm() -> LLMProvider:
    if settings.groq_api_key:
        return GroqLLM()
    if settings.llm_provider == "groq":
        return GroqLLM()
    if settings.llm_provider == "openai":
        return OpenAILLM()
    if settings.llm_provider == "ollama":
        return OllamaLLM()
    raise RuntimeError(f"Unsupported LLM_PROVIDER={settings.llm_provider}")
