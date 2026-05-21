from __future__ import annotations

import os
from typing import Any

import httpx


def vector_backend() -> str:
    return os.getenv("VECTOR_BACKEND", "sqlite").strip().lower() or "sqlite"


def qdrant_enabled() -> bool:
    return vector_backend() == "qdrant"


def _qdrant_url() -> str:
    return os.getenv("QDRANT_URL", "http://localhost:6333").rstrip("/")


def _qdrant_collection() -> str:
    return os.getenv("QDRANT_COLLECTION", "kortex_chunks").strip() or "kortex_chunks"


def _qdrant_headers() -> dict[str, str]:
    api_key = os.getenv("QDRANT_API_KEY", "").strip()
    return {"api-key": api_key} if api_key else {}


async def ensure_qdrant_collection(vector_size: int) -> None:
    if not qdrant_enabled() or vector_size <= 0:
        return
    collection = _qdrant_collection()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{_qdrant_url()}/collections/{collection}", headers=_qdrant_headers())
        if response.status_code == 200:
            return
        if response.status_code not in {404, 400}:
            response.raise_for_status()
        create = await client.put(
            f"{_qdrant_url()}/collections/{collection}",
            headers=_qdrant_headers(),
            json={"vectors": {"size": vector_size, "distance": "Cosine"}},
        )
        if create.status_code not in {200, 201, 409}:
            create.raise_for_status()


async def upsert_qdrant_points(points: list[dict[str, Any]]) -> None:
    if not qdrant_enabled() or not points:
        return
    first_vector = points[0].get("vector") or []
    await ensure_qdrant_collection(len(first_vector))
    payload = {
        "points": [
            {
                "id": int(point["id"]),
                "vector": point["vector"],
                "payload": point.get("payload") or {},
            }
            for point in points
            if point.get("vector")
        ]
    }
    if not payload["points"]:
        return
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.put(
            f"{_qdrant_url()}/collections/{_qdrant_collection()}/points",
            params={"wait": "true"},
            headers=_qdrant_headers(),
            json=payload,
        )
        response.raise_for_status()


async def delete_qdrant_points(point_ids: list[int]) -> None:
    if not qdrant_enabled() or not point_ids:
        return
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{_qdrant_url()}/collections/{_qdrant_collection()}/points/delete",
            params={"wait": "true"},
            headers=_qdrant_headers(),
            json={"points": [int(point_id) for point_id in point_ids]},
        )
        if response.status_code == 404:
            return
        response.raise_for_status()


def delete_qdrant_points_sync(point_ids: list[int]) -> None:
    if not qdrant_enabled() or not point_ids:
        return
    with httpx.Client(timeout=30) as client:
        response = client.post(
            f"{_qdrant_url()}/collections/{_qdrant_collection()}/points/delete",
            params={"wait": "true"},
            headers=_qdrant_headers(),
            json={"points": [int(point_id) for point_id in point_ids]},
        )
        if response.status_code == 404:
            return
        response.raise_for_status()


def search_qdrant(
    query_vector: list[float],
    project_id: int | None,
    limit: int,
    vector_size: int,
) -> list[dict[str, Any]]:
    if not qdrant_enabled() or not query_vector:
        return []
    headers = _qdrant_headers()
    collection = _qdrant_collection()
    with httpx.Client(timeout=25) as client:
        response = client.get(f"{_qdrant_url()}/collections/{collection}", headers=headers)
        if response.status_code == 404:
            return []
        response.raise_for_status()
        qdrant_filter = None
        if project_id:
            qdrant_filter = {"must": [{"key": "project_id", "match": {"value": int(project_id)}}]}
        payload: dict[str, Any] = {
            "vector": query_vector,
            "limit": max(1, min(limit, 200)),
            "with_payload": True,
        }
        if qdrant_filter:
            payload["filter"] = qdrant_filter
        search = client.post(f"{_qdrant_url()}/collections/{collection}/points/search", headers=headers, json=payload)
        search.raise_for_status()
        return search.json().get("result") or []


def qdrant_status() -> dict[str, Any]:
    if not qdrant_enabled():
        return {"backend": vector_backend(), "enabled": False}
    try:
        with httpx.Client(timeout=5) as client:
            response = client.get(f"{_qdrant_url()}/collections/{_qdrant_collection()}", headers=_qdrant_headers())
            return {
                "backend": "qdrant",
                "enabled": True,
                "url": _qdrant_url(),
                "collection": _qdrant_collection(),
                "reachable": response.status_code == 200,
                "status_code": response.status_code,
            }
    except Exception as exc:
        return {
            "backend": "qdrant",
            "enabled": True,
            "url": _qdrant_url(),
            "collection": _qdrant_collection(),
            "reachable": False,
            "error": str(exc)[:240],
        }
