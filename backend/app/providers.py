from __future__ import annotations

from typing import Any

import httpx

from .rag import local_answer


class ModelCallError(RuntimeError):
    """Raised when a configured model provider cannot return a usable answer."""


class ModelDiscoveryError(RuntimeError):
    """Raised when a provider cannot list available models."""


async def discover_models(provider: str, base_url: str = "", api_key: str = "") -> list[dict[str, str]]:
    if provider == "local":
        return [{"id": "extractive-rag", "name": "Local retrieval answer"}]

    if provider == "ollama":
        return await _discover_ollama(base_url)

    if provider == "openai_compatible":
        return await _discover_openai_compatible(base_url, api_key)

    if provider == "anthropic":
        return await _discover_anthropic(base_url, api_key)

    if provider == "google":
        return await _discover_google(base_url, api_key)

    raise ModelDiscoveryError(f"Unsupported provider: {provider}")


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

    if provider == "anthropic":
        return await _call_anthropic(model_config, messages)

    if provider == "google":
        return await _call_google(model_config, messages)

    raise ModelCallError(f"Unsupported provider: {provider}")


def _openai_base_url(base_url: str) -> str:
    normalized = (base_url or "https://api.openai.com/v1").rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized[: -len("/chat/completions")]
    if normalized.endswith("/models"):
        return normalized[: -len("/models")]
    return normalized


def _provider_error(response: httpx.Response, provider: str) -> ModelDiscoveryError:
    detail = response.text
    try:
        data = response.json()
        if isinstance(data, dict):
            error = data.get("error") or data.get("detail") or data
            if isinstance(error, dict):
                detail = error.get("message") or error.get("detail") or response.text
            elif isinstance(error, str):
                detail = error
    except ValueError:
        pass

    lowered = detail.lower()
    if response.status_code in {401, 403} or "bearer" in lowered or "api key" in lowered or "authentication" in lowered:
        return ModelDiscoveryError(
            f"{provider} rejected the model-list request because authentication is missing or invalid. "
            "Fill in an API key first, or add a model id manually and set the key later."
        )

    return ModelDiscoveryError(f"{provider} model discovery failed: {detail[:500]}")


async def _discover_ollama(base_url: str) -> list[dict[str, str]]:
    normalized = (base_url or "http://localhost:11434").rstrip("/")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{normalized}/api/tags")
        if response.status_code >= 400:
            raise _provider_error(response, "Ollama")
        data = response.json()
    models = []
    for item in data.get("models", []):
        model_id = item.get("name") or item.get("model")
        if model_id:
            models.append({"id": model_id, "name": model_id})
    return models


async def _discover_openai_compatible(base_url: str, api_key: str) -> list[dict[str, str]]:
    normalized = _openai_base_url(base_url)
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(f"{normalized}/models", headers=headers)
        if response.status_code >= 400:
            raise _provider_error(response, "OpenAI-compatible")
        data = response.json()

    items = data.get("data", []) if isinstance(data, dict) else data
    models = []
    for item in items:
        model_id = item.get("id") if isinstance(item, dict) else str(item)
        if model_id:
            models.append({"id": model_id, "name": str(item.get("name") or model_id) if isinstance(item, dict) else model_id})
    return models


async def _discover_anthropic(base_url: str, api_key: str) -> list[dict[str, str]]:
    normalized = (base_url or "https://api.anthropic.com/v1").rstrip("/")
    headers = {
        "Accept": "application/json",
        "anthropic-version": "2023-06-01",
    }
    if api_key:
        headers["x-api-key"] = api_key

    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(f"{normalized}/models", headers=headers)
        if response.status_code >= 400:
            raise _provider_error(response, "Anthropic")
        data = response.json()

    models = []
    for item in data.get("data", []):
        model_id = item.get("id")
        if model_id:
            models.append({"id": model_id, "name": item.get("display_name") or model_id})
    return models


async def _discover_google(base_url: str, api_key: str) -> list[dict[str, str]]:
    normalized = (base_url or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    params = {"key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.get(f"{normalized}/models", params=params)
        if response.status_code >= 400:
            raise _provider_error(response, "Google Gemini")
        data = response.json()

    models = []
    for item in data.get("models", []):
        supported = item.get("supportedGenerationMethods", [])
        if supported and "generateContent" not in supported:
            continue
        model_id = (item.get("name") or "").removeprefix("models/")
        if model_id:
            models.append({"id": model_id, "name": item.get("displayName") or model_id})
    return models


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
    base_url = _openai_base_url(model_config.get("base_url") or "https://api.openai.com/v1")
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


async def _call_anthropic(model_config: dict[str, Any], messages: list[dict[str, str]]) -> str:
    base_url = (model_config.get("base_url") or "https://api.anthropic.com/v1").rstrip("/")
    api_key = model_config.get("api_key") or ""
    system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
    user_messages = [
        {"role": "assistant" if message["role"] == "assistant" else "user", "content": message["content"]}
        for message in messages
        if message["role"] != "system"
    ]
    payload: dict[str, Any] = {
        "model": model_config["model"],
        "max_tokens": 2000,
        "temperature": model_config.get("temperature", 0.2),
        "messages": user_messages,
    }
    if system:
        payload["system"] = system

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"{base_url}/messages", json=payload, headers=headers)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        return "".join(part.get("text", "") for part in data.get("content", [])).strip()


async def _call_google(model_config: dict[str, Any], messages: list[dict[str, str]]) -> str:
    base_url = (model_config.get("base_url") or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    api_key = model_config.get("api_key") or ""
    system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
    contents = []
    for message in messages:
        if message["role"] == "system":
            continue
        role = "model" if message["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": message["content"]}]})

    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"temperature": model_config.get("temperature", 0.2)},
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}

    params = {"key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{base_url}/models/{model_config['model']}:generateContent",
            json=payload,
            params=params,
        )
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(part.get("text", "") for part in parts).strip()
