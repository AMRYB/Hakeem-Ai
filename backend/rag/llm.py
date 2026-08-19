from __future__ import annotations

import os
from functools import lru_cache

import httpx

from backend.config import get_settings
from backend.request_context import get_vercel_oidc_token

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


class OpenAILLM(LLMProvider):
    def __init__(self):
        runtime_oidc = get_vercel_oidc_token() or os.getenv("VERCEL_OIDC_TOKEN", "")
        self.token = settings.openai_api_key or runtime_oidc
        self.using_vercel_gateway = bool(runtime_oidc and not settings.openai_api_key)

        if self.using_vercel_gateway:
            self.base = "https://ai-gateway.vercel.sh/v1"
            self.model = "inclusionai/ling-3.0-flash-free"
        else:
            self.base = settings.openai_api_base.rstrip("/")
            self.model = settings.openai_model

    @staticmethod
    def _responses_output_text(payload: dict) -> str:
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

    @staticmethod
    def _chat_output_text(payload: dict) -> str:
        choices = payload.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content")
        return content.strip() if isinstance(content, str) else ""

    @staticmethod
    def _raise_gateway_error(response: httpx.Response) -> None:
        if response.is_success:
            return
        body = (response.text or "").strip().replace("\n", " ")[:800]
        raise RuntimeError(f"AI provider HTTP {response.status_code}: {body}")

    def generate(self, prompt: str) -> str:
        if not self.token:
            raise RuntimeError("No OpenAI/Vercel AI Gateway authentication token is available")

        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            if self.using_vercel_gateway:
                response = client.post(
                    f"{self.base}/chat/completions",
                    headers=headers,
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": settings.llm_temperature,
                        "stream": False,
                    },
                )
                self._raise_gateway_error(response)
                text = self._chat_output_text(response.json())
            else:
                response = client.post(
                    f"{self.base}/responses",
                    headers=headers,
                    json={
                        "model": self.model,
                        "input": prompt,
                    },
                )
                self._raise_gateway_error(response)
                text = self._responses_output_text(response.json())

        if not text:
            raise RuntimeError("LLM response did not contain output text")
        return text


@lru_cache(maxsize=1)
def get_llm() -> LLMProvider:
    runtime_oidc = get_vercel_oidc_token() or os.getenv("VERCEL_OIDC_TOKEN", "")
    if settings.llm_provider == "openai":
        return OpenAILLM()
    if runtime_oidc and settings.llm_provider == "ollama" and settings.ollama_base_url.rstrip("/") == "http://localhost:11434":
        return OpenAILLM()
    if settings.llm_provider == "ollama":
        return OllamaLLM()
    raise RuntimeError(f"Unsupported LLM_PROVIDER={settings.llm_provider}")
