from __future__ import annotations

from typing import Any

import httpx

from .rag import local_answer


class ModelCallError(RuntimeError):
    """Raised when a configured model provider cannot return a usable answer."""


async def generate_with_model(
    model_config: dict[str, Any],
    messages: list[dict[str, str]],
    question: str,
    contexts: list[dict[str, Any]],
) -> str:
    provider = model_config["provider"]
    if provider == "local":
        return local_answer(question, contexts)

    if provider == "ollama":
        return await _call_ollama(model_config, messages)

    if provider == "openai_compatible":
        return await _call_openai_compatible(model_config, messages)

    raise ModelCallError(f"Unsupported provider: {provider}")


async def _call_ollama(model_config: dict[str, Any], messages: list[dict[str, str]]) -> str:
    base_url = (model_config.get("base_url") or "http://localhost:11434").rstrip("/")
    payload = {
        "model": model_config["model"],
        "messages": messages,
        "stream": False,
        "options": {"temperature": model_config.get("temperature", 0.2)},
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"{base_url}/api/chat", json=payload)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        return data.get("message", {}).get("content", "").strip()


async def _call_openai_compatible(model_config: dict[str, Any], messages: list[dict[str, str]]) -> str:
    base_url = (model_config.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    api_key = model_config.get("api_key") or ""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model_config["model"],
        "messages": messages,
        "temperature": model_config.get("temperature", 0.2),
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()
