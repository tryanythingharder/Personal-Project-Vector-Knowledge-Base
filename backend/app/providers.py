from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
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
) -> dict[str, Any]:
    provider = model_config["provider"]
    if provider == "local":
        return {"text": local_answer(question, contexts), "usage": None}

    if provider == "ollama":
        return await _call_ollama(model_config, messages)

    if provider == "openai_compatible":
        return await _call_openai_compatible(model_config, messages)

    if provider == "anthropic":
        return await _call_anthropic(model_config, messages)

    if provider == "google":
        return await _call_google(model_config, messages)

    raise ModelCallError(f"Unsupported provider: {provider}")


async def stream_with_model(
    model_config: dict[str, Any],
    messages: list[dict[str, str]],
    question: str,
    contexts: list[dict[str, Any]],
) -> AsyncIterator[dict[str, Any]]:
    provider = model_config["provider"]
    if provider == "local":
        text = local_answer(question, contexts)
        for index in range(0, len(text), 24):
            yield {"type": "chunk", "text": text[index : index + 24]}
            await asyncio.sleep(0.035)
        return

    if provider == "ollama":
        async for event in _stream_ollama(model_config, messages):
            yield event
        return

    if provider == "openai_compatible":
        async for event in _stream_openai_compatible(model_config, messages):
            yield event
        return

    if provider == "anthropic":
        async for event in _stream_anthropic(model_config, messages):
            yield event
        return

    if provider == "google":
        async for event in _stream_google(model_config, messages):
            yield event
        return

    raise ModelCallError(f"Unsupported provider: {provider}")


async def embed_with_model(model_config: dict[str, Any], texts: list[str]) -> list[list[float]]:
    provider = model_config["provider"]
    if provider == "ollama":
        return await _embed_ollama(model_config, texts)
    if provider == "openai_compatible":
        return await _embed_openai_compatible(model_config, texts)
    raise ModelCallError(f"Embedding is not supported for provider: {provider}")


async def rerank_with_model(model_config: dict[str, Any], query: str, documents: list[str]) -> list[float]:
    provider = model_config["provider"]
    if provider == "openai_compatible":
        return await _rerank_openai_compatible(model_config, query, documents)
    return _local_rerank_scores(query, documents)


def _openai_base_url(base_url: str) -> str:
    normalized = (base_url or "https://api.openai.com/v1").rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized[: -len("/chat/completions")]
    if normalized.endswith("/models"):
        return normalized[: -len("/models")]
    return normalized


def _trust_env_for_base_url(base_url: str) -> bool:
    normalized = (base_url or "").lower()
    return "deepseek.com" not in normalized


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

    async with httpx.AsyncClient(timeout=25, trust_env=_trust_env_for_base_url(normalized)) as client:
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


async def _call_ollama(model_config: dict[str, Any], messages: list[dict[str, str]]) -> dict[str, Any]:
    base_url = (model_config.get("base_url") or "http://localhost:11434").rstrip("/")
    payload = {
        "model": model_config["model"],
        "messages": messages,
        "stream": False,
        "options": {"temperature": model_config.get("temperature", 0.2)},
    }
    async with httpx.AsyncClient(timeout=90, trust_env=_trust_env_for_base_url(base_url)) as client:
        response = await client.post(f"{base_url}/api/chat", json=payload)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        return {
            "text": data.get("message", {}).get("content", "").strip(),
            "usage": {
                "input_tokens": int(data.get("prompt_eval_count") or 0),
                "output_tokens": int(data.get("eval_count") or 0),
                "total_tokens": int(data.get("prompt_eval_count") or 0) + int(data.get("eval_count") or 0),
            },
        }


async def _stream_ollama(model_config: dict[str, Any], messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
    base_url = (model_config.get("base_url") or "http://localhost:11434").rstrip("/")
    payload = {
        "model": model_config["model"],
        "messages": messages,
        "stream": True,
        "options": {"temperature": model_config.get("temperature", 0.2)},
    }
    async with httpx.AsyncClient(timeout=None, trust_env=_trust_env_for_base_url(base_url)) as client:
        async with client.stream("POST", f"{base_url}/api/chat", json=payload) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise ModelCallError(body.decode("utf-8", errors="ignore"))
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                data = json.loads(line)
                text = data.get("message", {}).get("content", "")
                if text:
                    yield {"type": "chunk", "text": text}
                if data.get("done"):
                    yield {
                        "type": "usage",
                        "usage": {
                            "input_tokens": int(data.get("prompt_eval_count") or 0),
                            "output_tokens": int(data.get("eval_count") or 0),
                            "total_tokens": int(data.get("prompt_eval_count") or 0) + int(data.get("eval_count") or 0),
                        },
                    }


async def _embed_ollama(model_config: dict[str, Any], texts: list[str]) -> list[list[float]]:
    base_url = (model_config.get("base_url") or "http://localhost:11434").rstrip("/")
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=90, trust_env=_trust_env_for_base_url(base_url)) as client:
        for text in texts:
            response = await client.post(f"{base_url}/api/embeddings", json={"model": model_config["model"], "prompt": text})
            if response.status_code >= 400:
                raise ModelCallError(response.text)
            vector = response.json().get("embedding") or []
            vectors.append([float(value) for value in vector])
    return vectors


async def _call_openai_compatible(model_config: dict[str, Any], messages: list[dict[str, str]]) -> dict[str, Any]:
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
    async with httpx.AsyncClient(timeout=90, trust_env=_trust_env_for_base_url(base_url)) as client:
        response = await client.post(f"{base_url}/chat/completions", json=payload, headers=headers)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
        usage = data.get("usage") or {}
        return {
            "text": data["choices"][0]["message"]["content"].strip(),
            "usage": {
                "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
                "total_tokens": int(usage.get("total_tokens") or 0),
                "cached_input_tokens": int(
                    usage.get("prompt_cache_hit_tokens")
                    or (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
                    or 0
                ),
            },
        }


async def _embed_openai_compatible(model_config: dict[str, Any], texts: list[str]) -> list[list[float]]:
    base_url = _openai_base_url(model_config.get("base_url") or "https://api.openai.com/v1")
    api_key = model_config.get("api_key") or ""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"model": model_config["model"], "input": texts}
    async with httpx.AsyncClient(timeout=90, trust_env=_trust_env_for_base_url(base_url)) as client:
        response = await client.post(f"{base_url}/embeddings", json=payload, headers=headers)
        if response.status_code >= 400:
            raise ModelCallError(response.text)
        data = response.json()
    items = sorted(data.get("data", []), key=lambda item: item.get("index", 0))
    return [[float(value) for value in item.get("embedding", [])] for item in items]


async def _rerank_openai_compatible(model_config: dict[str, Any], query: str, documents: list[str]) -> list[float]:
    base_url = (model_config.get("base_url") or "").rstrip("/")
    if not base_url:
        return _local_rerank_scores(query, documents)
    api_key = model_config.get("api_key") or ""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"model": model_config["model"], "query": query, "documents": documents}
    async with httpx.AsyncClient(timeout=60, trust_env=_trust_env_for_base_url(base_url)) as client:
        response = await client.post(f"{base_url}/rerank", json=payload, headers=headers)
        if response.status_code >= 400:
            return _local_rerank_scores(query, documents)
        data = response.json()
    scores = [0.0] * len(documents)
    for item in data.get("results", []):
        index = int(item.get("index", 0))
        if 0 <= index < len(scores):
            scores[index] = float(item.get("relevance_score") or item.get("score") or 0)
    return scores


def _local_rerank_scores(query: str, documents: list[str]) -> list[float]:
    query_tokens = {token for token in query.lower().replace("/", " ").replace("_", " ").split() if len(token) > 1}
    scores: list[float] = []
    for document in documents:
        lowered = document.lower()
        if not query_tokens:
            scores.append(0.0)
            continue
        hits = sum(1 for token in query_tokens if token in lowered)
        scores.append(round(hits / max(len(query_tokens), 1), 4))
    return scores


async def _stream_openai_compatible(model_config: dict[str, Any], messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
    base_url = _openai_base_url(model_config.get("base_url") or "https://api.openai.com/v1")
    api_key = model_config.get("api_key") or ""
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload: dict[str, Any] = {
        "model": model_config["model"],
        "messages": messages,
        "temperature": model_config.get("temperature", 0.2),
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    fallback_payload = {key: value for key, value in payload.items() if key != "stream_options"}
    attempts = [payload, fallback_payload]
    last_error = ""
    async with httpx.AsyncClient(timeout=None, trust_env=_trust_env_for_base_url(base_url)) as client:
        for index, request_payload in enumerate(attempts):
            async with client.stream("POST", f"{base_url}/chat/completions", json=request_payload, headers=headers) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    last_error = body.decode("utf-8", errors="ignore")
                    if index == 0 and response.status_code in {400, 422}:
                        continue
                    raise ModelCallError(last_error)
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or line.startswith(":") or not line.startswith("data:"):
                        continue
                    raw = line.removeprefix("data:").strip()
                    if raw == "[DONE]":
                        break
                    data = json.loads(raw)
                    usage = data.get("usage")
                    if usage:
                        yield {
                            "type": "usage",
                            "usage": {
                                "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
                                "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
                                "total_tokens": int(usage.get("total_tokens") or 0),
                                "cached_input_tokens": int(
                                    usage.get("prompt_cache_hit_tokens")
                                    or (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
                                    or 0
                                ),
                            },
                        }
                    for choice in data.get("choices") or []:
                        delta = choice.get("delta") or {}
                        reasoning = delta.get("reasoning_content") or ""
                        if reasoning:
                            yield {"type": "reasoning", "text": reasoning}
                        text = delta.get("content") or ""
                        if text:
                            yield {"type": "chunk", "text": text}
                return
    if last_error:
        raise ModelCallError(last_error)


async def _call_anthropic(model_config: dict[str, Any], messages: list[dict[str, str]]) -> dict[str, Any]:
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
        usage = data.get("usage") or {}
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        return {
            "text": "".join(part.get("text", "") for part in data.get("content", [])).strip(),
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
            },
        }


async def _stream_anthropic(model_config: dict[str, Any], messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
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
        "stream": True,
    }
    if system:
        payload["system"] = system

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    input_tokens = 0
    output_tokens = 0
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", f"{base_url}/messages", json=payload, headers=headers) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise ModelCallError(body.decode("utf-8", errors="ignore"))
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                raw = line.removeprefix("data:").strip()
                if not raw or raw == "[DONE]":
                    continue
                data = json.loads(raw)
                event_type = data.get("type")
                if event_type == "message_start":
                    usage = data.get("message", {}).get("usage") or {}
                    input_tokens = int(usage.get("input_tokens") or input_tokens)
                    continue
                if event_type == "content_block_delta":
                    text = (data.get("delta") or {}).get("text") or ""
                    if text:
                        yield {"type": "chunk", "text": text}
                    continue
                if event_type == "message_delta":
                    usage = data.get("usage") or {}
                    output_tokens = int(usage.get("output_tokens") or output_tokens)
                    continue
                if event_type == "message_stop":
                    yield {
                        "type": "usage",
                        "usage": {
                            "input_tokens": input_tokens,
                            "output_tokens": output_tokens,
                            "total_tokens": input_tokens + output_tokens,
                        },
                    }


async def _call_google(model_config: dict[str, Any], messages: list[dict[str, str]]) -> dict[str, Any]:
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
            return {"text": "", "usage": None}
        parts = candidates[0].get("content", {}).get("parts", [])
        usage = data.get("usageMetadata") or {}
        return {
            "text": "".join(part.get("text", "") for part in parts).strip(),
            "usage": {
                "input_tokens": int(usage.get("promptTokenCount") or 0),
                "output_tokens": int(usage.get("candidatesTokenCount") or 0),
                "total_tokens": int(usage.get("totalTokenCount") or 0),
            },
        }


async def _stream_google(model_config: dict[str, Any], messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
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

    params = {"alt": "sse"}
    if api_key:
        params["key"] = api_key

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{base_url}/models/{model_config['model']}:streamGenerateContent",
            json=payload,
            params=params,
            headers={"Accept": "text/event-stream"},
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise ModelCallError(body.decode("utf-8", errors="ignore"))
            async for line in response.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                raw = line.removeprefix("data:").strip()
                if not raw:
                    continue
                data = json.loads(raw)
                for candidate in data.get("candidates") or []:
                    parts = candidate.get("content", {}).get("parts", [])
                    text = "".join(part.get("text", "") for part in parts)
                    if text:
                        yield {"type": "chunk", "text": text}
                usage = data.get("usageMetadata") or {}
                if usage:
                    yield {
                        "type": "usage",
                        "usage": {
                            "input_tokens": int(usage.get("promptTokenCount") or 0),
                            "output_tokens": int(usage.get("candidatesTokenCount") or 0),
                            "total_tokens": int(usage.get("totalTokenCount") or 0),
                        },
                    }
