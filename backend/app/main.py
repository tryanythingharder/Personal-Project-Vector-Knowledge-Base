from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import os
import re
import secrets
import shutil
import json
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .database import DATA_DIR, DB_PATH, UPLOAD_DIR, get_conn, init_db, now_iso, row_to_dict, rows_to_dicts
from .document_loader import extract_text, infer_metadata, split_text, split_text_detailed
from .providers import ModelCallError, ModelDiscoveryError, discover_models, embed_with_model, generate_with_model, rerank_with_model, stream_with_model
from .rag import build_citations, build_llm_messages, citations_to_json, local_answer, retrieve_context
from .security import (
    create_session_token,
    decrypt_secret,
    encrypt_secret,
    hash_password,
    hash_session_token,
    verify_password,
)
from .vectorizer import dumps_vector, embed
from .vector_store import delete_qdrant_points, delete_qdrant_points_sync, qdrant_status, upsert_qdrant_points


app = FastAPI(title="Kortex Knowledge Backend", version="0.1.0")
SYNC_LOOP_INTERVAL_SECONDS = 15
sync_worker_task: asyncio.Task | None = None
sync_worker_stop = asyncio.Event()
active_sync_source_ids: set[int] = set()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AUTH_PUBLIC_PATHS = {
    "/api/health",
    "/api/auth/session",
    "/api/auth/bootstrap",
    "/api/auth/login",
    "/api/team/invitations/preview",
    "/api/team/invitations/accept",
}
AUTH_ADMIN_ONLY_PREFIXES = ("/api/admin", "/api/team")


def _env_tokens() -> tuple[str, str]:
    return os.getenv("KORTEX_ADMIN_TOKEN", "").strip(), os.getenv("KORTEX_USER_TOKEN", "").strip()


def _session_ttl_days() -> int:
    raw = os.getenv("KORTEX_SESSION_DAYS", "").strip()
    try:
        parsed = int(raw)
    except ValueError:
        parsed = 30
    return max(1, min(parsed, 365))


def _password_auth_user_count(conn: Any) -> int:
    return int(conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"])


def _permissions_for_role(role: str) -> list[str]:
    if role in {"open", "admin"}:
        return ["admin", "chat", "settings", "sessions"]
    if role == "user":
        return ["chat", "settings", "sessions"]
    return []


def _serialize_auth_user(row: dict[str, Any] | None, auth_source: str = "password") -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": int(row.get("id") or 0),
        "email": str(row.get("email") or ""),
        "display_name": str(row.get("display_name") or ""),
        "role": str(row.get("role") or "user"),
        "workspace_role": str(row.get("workspace_role") or "member"),
        "disabled": bool(row.get("disabled")),
        "last_login_at": row.get("last_login_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "auth_source": auth_source,
    }


def _serialize_auth_session(row: dict[str, Any] | None, current_session_id: int | None = None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": int(row.get("id") or 0),
        "user_id": int(row.get("user_id") or 0),
        "device_name": str(row.get("device_name") or ""),
        "user_agent": str(row.get("user_agent") or ""),
        "ip_address": str(row.get("ip_address") or ""),
        "created_at": row.get("created_at"),
        "expires_at": row.get("expires_at"),
        "last_seen_at": row.get("last_seen_at"),
        "revoked_at": row.get("revoked_at"),
        "is_current": bool(current_session_id and int(row.get("id") or 0) == current_session_id),
    }


def _env_user_payload(role: str) -> dict[str, Any] | None:
    if role not in {"admin", "user"}:
        return None
    return {
        "id": 0,
        "email": "",
        "display_name": "Environment Admin" if role == "admin" else "Environment User",
        "role": role,
        "workspace_role": "owner" if role == "admin" else "member",
        "disabled": False,
        "last_login_at": None,
        "created_at": None,
        "updated_at": None,
        "auth_source": "env_token",
    }


def _get_request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()[:120]
    return (request.client.host if request.client else "")[:120]


def _build_auth_session_payload(
    role: str,
    auth_required: bool,
    setup_required: bool,
    user: dict[str, Any] | None = None,
    session: dict[str, Any] | None = None,
    auth_mode: str = "open",
    can_bootstrap: bool = False,
) -> dict[str, Any]:
    return {
        "auth_required": auth_required,
        "setup_required": setup_required,
        "role": role,
        "permissions": _permissions_for_role(role),
        "user": user,
        "session": session,
        "auth_mode": auth_mode,
        "can_bootstrap": can_bootstrap,
    }


WORKSPACE_ROLE_ORDER = {"viewer": 10, "member": 20, "admin": 30, "owner": 40}
PROJECT_ROLE_ORDER = {"viewer": 10, "editor": 20, "owner": 30}


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _workspace_role_value(role: str | None) -> int:
    return WORKSPACE_ROLE_ORDER.get(str(role or "member"), 0)


def _project_role_value(role: str | None) -> int:
    return PROJECT_ROLE_ORDER.get(str(role or "viewer"), 0)


def _is_password_workspace_admin(user: dict[str, Any] | None) -> bool:
    if not user or int(user.get("id") or 0) <= 0:
        return False
    return _workspace_role_value(user.get("workspace_role")) >= WORKSPACE_ROLE_ORDER["admin"]


def _can_write_projects(request: Request) -> bool:
    role = getattr(request.state, "kortex_role", "")
    if role in {"open", "admin"}:
        return True
    user = getattr(request.state, "kortex_user", None)
    return _workspace_role_value((user or {}).get("workspace_role")) >= WORKSPACE_ROLE_ORDER["member"]


def _can_manage_workspace(request: Request) -> bool:
    role = getattr(request.state, "kortex_role", "")
    if role in {"open", "admin"}:
        return True
    return _is_password_workspace_admin(getattr(request.state, "kortex_user", None))


def _serialize_project_member(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "user_id": int(row.get("user_id") or row.get("id") or 0),
        "project_id": int(row.get("project_id") or 0),
        "role": str(row.get("project_role") or row.get("role") or "viewer"),
        "display_name": str(row.get("display_name") or ""),
        "email": str(row.get("email") or ""),
        "workspace_role": str(row.get("workspace_role") or "member"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _serialize_team_member(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "user_id": int(row.get("id") or row.get("user_id") or 0),
        "email": str(row.get("email") or ""),
        "display_name": str(row.get("display_name") or ""),
        "role": str(row.get("role") or "user"),
        "workspace_role": str(row.get("workspace_role") or "member"),
        "disabled": bool(row.get("disabled")),
        "project_count": int(row.get("project_count") or 0),
        "last_login_at": row.get("last_login_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _parse_project_ids_json(value: Any) -> list[int]:
    try:
        raw_items = json.loads(value or "[]")
    except (TypeError, ValueError):
        raw_items = []
    project_ids: list[int] = []
    for item in raw_items:
        try:
            project_id = int(item)
        except (TypeError, ValueError):
            continue
        if project_id > 0:
            project_ids.append(project_id)
    return project_ids


def _project_names_for_ids(conn: Any, project_ids: list[int]) -> list[str]:
    normalized_ids = sorted({int(item) for item in project_ids if int(item) > 0})
    if not normalized_ids:
        return []
    placeholders = ", ".join("?" for _ in normalized_ids)
    rows = conn.execute(
        f"SELECT id, name FROM projects WHERE id IN ({placeholders})",
        tuple(normalized_ids),
    ).fetchall()
    names_by_id = {int(row["id"]): str(row["name"] or "") for row in rows}
    return [names_by_id[project_id] for project_id in normalized_ids if names_by_id.get(project_id)]


def _serialize_team_invitation(
    row: dict[str, Any] | None,
    project_names: list[str] | None = None,
) -> dict[str, Any] | None:
    if not row:
        return None
    project_ids = _parse_project_ids_json(row.get("project_ids_json"))
    return {
        "id": int(row.get("id") or 0),
        "email": str(row.get("email") or ""),
        "workspace_role": str(row.get("workspace_role") or "member"),
        "project_role": str(row.get("project_role") or "viewer"),
        "project_ids": project_ids,
        "project_names": project_names or [],
        "invite_token": str(row.get("invite_token") or ""),
        "message": str(row.get("message") or ""),
        "status": str(row.get("status") or "pending"),
        "expires_at": row.get("expires_at"),
        "accepted_at": row.get("accepted_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "invited_by_user_id": row.get("invited_by_user_id"),
        "invited_by_name": row.get("invited_by_name"),
    }


def _user_project_role(conn: Any, user: dict[str, Any] | None, project_id: int) -> str | None:
    if project_id <= 0:
        return None
    if not user:
        return None
    if int(user.get("id") or 0) <= 0:
        return "owner"
    if _workspace_role_value(user.get("workspace_role")) >= WORKSPACE_ROLE_ORDER["admin"]:
        return "owner"
    row = conn.execute(
        "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
        (project_id, int(user["id"])),
    ).fetchone()
    return str(row["role"]) if row else None


def _assert_project_access(conn: Any, request: Request, project_id: int, minimum_role: str = "viewer") -> dict[str, Any]:
    project = row_to_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone())
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = getattr(request.state, "kortex_role", "")
    if role == "open":
        project["access_role"] = "owner"
        return project
    project_role = _user_project_role(conn, getattr(request.state, "kortex_user", None), project_id)
    if project_role is None or _project_role_value(project_role) < _project_role_value(minimum_role):
        raise HTTPException(status_code=403, detail="You do not have access to this project")
    project["access_role"] = project_role
    return project


def _accessible_project_ids(conn: Any, request: Request) -> list[int] | None:
    role = getattr(request.state, "kortex_role", "")
    if role in {"open", "admin"}:
        return None
    user = getattr(request.state, "kortex_user", None)
    if not user or int(user.get("id") or 0) <= 0:
        return []
    if _workspace_role_value(user.get("workspace_role")) >= WORKSPACE_ROLE_ORDER["admin"]:
        return None
    rows = conn.execute("SELECT project_id FROM project_members WHERE user_id = ?", (int(user["id"]),)).fetchall()
    return [int(row["project_id"]) for row in rows]


def _project_filter_sql(project_ids: list[int] | None, column: str) -> tuple[str, list[Any]]:
    if project_ids is None:
        return "", []
    if not project_ids:
        return "WHERE 1 = 0", []
    placeholders = ",".join("?" for _ in project_ids)
    return f"WHERE {column} IN ({placeholders})", [*project_ids]


def _resolve_auth_context(request: Request) -> dict[str, Any]:
    if not request.url.path.startswith("/api/"):
        return {"auth_required": False, "setup_required": False, "role": "open", "permissions": _permissions_for_role("open")}

    admin_token, user_token = _env_tokens()
    provided = request.headers.get("x-kortex-token", "").strip()
    if admin_token and provided == admin_token:
        user = _env_user_payload("admin")
        return _build_auth_session_payload("admin", True, False, user=user, auth_mode="env_token", can_bootstrap=False)
    if user_token and provided == user_token:
        user = _env_user_payload("user")
        return _build_auth_session_payload("user", True, False, user=user, auth_mode="env_token", can_bootstrap=False)

    with get_conn() as conn:
        user_count = _password_auth_user_count(conn)
        auth_required = bool(admin_token) or user_count > 0
        setup_required = user_count == 0 and not admin_token
        can_bootstrap = user_count == 0
        if not provided:
            role = "anonymous" if auth_required else "open"
            return _build_auth_session_payload(role, auth_required, setup_required, auth_mode="password" if user_count > 0 else "open", can_bootstrap=can_bootstrap)

        session_row = conn.execute(
            """
            SELECT auth_sessions.*, users.email, users.display_name, users.role, users.workspace_role, users.disabled, users.last_login_at, users.created_at AS user_created_at, users.updated_at AS user_updated_at
            FROM auth_sessions
            JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ?
              AND auth_sessions.revoked_at IS NULL
              AND users.disabled = 0
            """,
            (hash_session_token(provided),),
        ).fetchone()
        if session_row is None:
            role = "anonymous" if auth_required else "open"
            return _build_auth_session_payload(role, auth_required, setup_required, auth_mode="password" if user_count > 0 else "open", can_bootstrap=can_bootstrap)

        session = row_to_dict(session_row) or {}
        expires_at = session.get("expires_at")
        if expires_at:
            try:
                if datetime.fromisoformat(str(expires_at)) <= datetime.now(timezone.utc):
                    now = now_iso()
                    conn.execute("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?", (now, now, session["id"]))
                    role = "anonymous" if auth_required else "open"
                    return _build_auth_session_payload(role, auth_required, setup_required, auth_mode="password", can_bootstrap=can_bootstrap)
            except ValueError:
                pass

        now = now_iso()
        last_seen_at = session.get("last_seen_at")
        should_update_last_seen = True
        if last_seen_at:
            try:
                delta = datetime.now(timezone.utc) - datetime.fromisoformat(str(last_seen_at))
                should_update_last_seen = delta.total_seconds() >= 60
            except ValueError:
                should_update_last_seen = True
        if should_update_last_seen:
            conn.execute("UPDATE auth_sessions SET last_seen_at = ?, updated_at = ? WHERE id = ?", (now, now, session["id"]))
            session["last_seen_at"] = now
            session["updated_at"] = now

        user = {
            "id": session["user_id"],
            "email": session.get("email") or "",
            "display_name": session.get("display_name") or "",
            "role": session.get("role") or "user",
            "workspace_role": session.get("workspace_role") or "member",
            "disabled": bool(session.get("disabled")),
            "last_login_at": session.get("last_login_at"),
            "created_at": session.get("user_created_at"),
            "updated_at": session.get("user_updated_at"),
        }
        return _build_auth_session_payload(
            str(user["role"]),
            auth_required,
            setup_required,
            user=_serialize_auth_user(user, "password"),
            session=_serialize_auth_session(session, current_session_id=int(session["id"])),
            auth_mode="password",
            can_bootstrap=can_bootstrap,
        )


@app.middleware("http")
async def optional_token_auth(request: Request, call_next):
    auth = _resolve_auth_context(request)
    request.state.kortex_role = auth["role"]
    request.state.kortex_permissions = auth["permissions"]
    request.state.kortex_user = auth.get("user")
    request.state.kortex_session = auth.get("session")
    request.state.kortex_auth_mode = auth.get("auth_mode")
    if request.url.path.startswith("/api/") and request.url.path not in AUTH_PUBLIC_PATHS:
        if auth["auth_required"] and auth["role"] in {"anonymous"}:
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        if auth["role"] not in {"open", "admin"} and request.url.path.startswith(AUTH_ADMIN_ONLY_PREFIXES):
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""


class ProjectSettingsPatch(BaseModel):
    chunk_size: int | None = Field(default=None, ge=300, le=6000)
    chunk_overlap: int | None = Field(default=None, ge=0, le=1200)
    retrieval_top_k: int | None = Field(default=None, ge=1, le=24)
    retrieval_mode: str | None = Field(default=None, pattern="^(vector|keyword|hybrid)$")
    retrieval_scope: str | None = Field(default=None, pattern="^(focused|full_context)$")
    similarity_threshold: float | None = Field(default=None, ge=0, le=1)
    query_rewrite_enabled: bool | None = None
    rerank_enabled: bool | None = None
    agent_tools_enabled: bool | None = None
    full_context_limit: int | None = Field(default=None, ge=5, le=80)
    metadata_filter_json: str | None = None
    embedding_model_id: int | None = None
    rerank_model_id: int | None = None


PROVIDER_PATTERN = "^(local|ollama|openai_compatible|anthropic|google)$"
MODEL_TYPE_PATTERN = "^(chat|embedding|rerank)$"


class ModelConfigIn(BaseModel):
    name: str
    provider: str = Field(pattern=PROVIDER_PATTERN)
    model: str
    base_url: str = ""
    api_key: str = ""
    temperature: float = 0.2
    model_type: str = Field(default="chat", pattern=MODEL_TYPE_PATTERN)
    context_window: int = 0
    supports_tools: bool = False
    supports_vision: bool = False
    enabled: bool = True
    is_default: bool = False


class ModelConfigPatch(BaseModel):
    name: str | None = None
    provider: str | None = Field(default=None, pattern=PROVIDER_PATTERN)
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
    model_type: str | None = Field(default=None, pattern=MODEL_TYPE_PATTERN)
    context_window: int | None = None
    supports_tools: bool | None = None
    supports_vision: bool | None = None
    enabled: bool | None = None
    is_default: bool | None = None


class ModelDiscoveryRequest(BaseModel):
    provider: str = Field(pattern=PROVIDER_PATTERN)
    base_url: str = ""
    api_key: str = ""


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    project_id: int | None = None
    model_id: int | None = None
    preset_id: int | None = None
    conversation_id: int | None = None
    top_k: int | None = Field(default=None, ge=1, le=24)
    retrieval_mode: str | None = Field(default=None, pattern="^(vector|keyword|hybrid)$")
    retrieval_scope: str | None = Field(default=None, pattern="^(focused|full_context)$")
    similarity_threshold: float | None = Field(default=None, ge=0, le=1)
    use_query_rewrite: bool | None = None
    use_rerank: bool | None = None
    metadata_filter: dict[str, Any] | None = None


class RagDebugRequest(BaseModel):
    query: str = Field(min_length=1)
    project_id: int | None = None
    top_k: int | None = Field(default=None, ge=1, le=24)
    retrieval_mode: str | None = Field(default=None, pattern="^(vector|keyword|hybrid)$")
    retrieval_scope: str | None = Field(default=None, pattern="^(focused|full_context)$")
    similarity_threshold: float | None = Field(default=None, ge=0, le=1)
    use_query_rewrite: bool | None = None
    use_rerank: bool | None = None
    metadata_filter: dict[str, Any] | None = None


class DocumentMetadataPatch(BaseModel):
    title: str | None = None
    metadata: dict[str, Any] | None = None


class BatchDeleteRequest(BaseModel):
    document_ids: list[int] = Field(default_factory=list)


class FeedbackRequest(BaseModel):
    conversation_id: int
    message_id: int
    rating: int = Field(ge=-1, le=1)
    note: str = ""


class EvalCaseIn(BaseModel):
    project_id: int | None = None
    question: str = Field(min_length=1)
    expected_answer: str = ""
    expected_document: str = ""
    tags: str = ""


class EvalRunRequest(BaseModel):
    case_ids: list[int] = Field(default_factory=list)
    project_id: int | None = None
    model_id: int | None = None
    preset_id: int | None = None


class GlobalSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    project_id: int | None = None
    top_k: int = Field(default=8, ge=1, le=24)
    retrieval_mode: str = Field(default="hybrid", pattern="^(vector|keyword|hybrid)$")
    retrieval_scope: str = Field(default="focused", pattern="^(focused|full_context)$")
    similarity_threshold: float = Field(default=0, ge=0, le=1)
    metadata_filter: dict[str, Any] | None = None


class SyncSourceIn(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=120)
    source_path: str = Field(min_length=1)
    enabled: bool = True
    poll_interval_seconds: int = Field(default=60, ge=15, le=3600)
    include_globs: str = ""
    exclude_globs: str = ""
    delete_missing: bool = False


class SyncSourcePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    source_path: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None
    poll_interval_seconds: int | None = Field(default=None, ge=15, le=3600)
    include_globs: str | None = None
    exclude_globs: str | None = None
    delete_missing: bool | None = None


class BootstrapRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=256)
    device_name: str = Field(default="Current device", min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    password: str = Field(min_length=8, max_length=256)
    device_name: str = Field(default="Current device", min_length=1, max_length=120)


class TeamInviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=160)
    workspace_role: str = Field(default="member", pattern="^(admin|member|viewer)$")
    project_role: str = Field(default="viewer", pattern="^(editor|viewer)$")
    project_ids: list[int] = Field(default_factory=list)
    message: str = Field(default="", max_length=240)
    expires_in_days: int = Field(default=7, ge=1, le=30)


class TeamInviteAcceptRequest(BaseModel):
    invite_token: str = Field(min_length=8, max_length=240)
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=256)
    device_name: str = Field(default="Current device", min_length=1, max_length=120)


class TeamMemberWorkspacePatch(BaseModel):
    workspace_role: str = Field(pattern="^(owner|admin|member|viewer)$")


class ProjectShareIn(BaseModel):
    user_id: int
    role: str = Field(pattern="^(owner|editor|viewer)$")


class ProjectSharePatch(BaseModel):
    role: str = Field(pattern="^(owner|editor|viewer)$")


class ModelPresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    project_id: int | None = None
    model_id: int | None = None
    system_prompt: str = ""
    temperature: float = Field(default=0.2, ge=0, le=2)
    retrieval_scope: str = Field(default="focused", pattern="^(focused|full_context)$")
    retrieval_mode: str = Field(default="hybrid", pattern="^(vector|keyword|hybrid)$")
    top_k: int = Field(default=5, ge=1, le=24)
    similarity_threshold: float = Field(default=0, ge=0, le=1)
    use_query_rewrite: bool = False
    use_rerank: bool = False
    metadata_filter_json: str = "{}"
    tools_json: str = "[]"
    is_default: bool = False


class ModelPresetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    project_id: int | None = None
    model_id: int | None = None
    system_prompt: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    retrieval_scope: str | None = Field(default=None, pattern="^(focused|full_context)$")
    retrieval_mode: str | None = Field(default=None, pattern="^(vector|keyword|hybrid)$")
    top_k: int | None = Field(default=None, ge=1, le=24)
    similarity_threshold: float | None = Field(default=None, ge=0, le=1)
    use_query_rewrite: bool | None = None
    use_rerank: bool | None = None
    metadata_filter_json: str | None = None
    tools_json: str | None = None
    is_default: bool | None = None


SKIPPED_PATH_PARTS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".next",
    ".nuxt",
    ".turbo",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    "vendor",
    ".venv",
    "venv",
}

BINARY_EXTENSIONS = {
    ".7z",
    ".avi",
    ".bmp",
    ".dll",
    ".dmg",
    ".exe",
    ".gif",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp3",
    ".mp4",
    ".o",
    ".obj",
    ".pkl",
    ".png",
    ".rar",
    ".so",
    ".tar",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
}

MAX_INDEXABLE_FILE_BYTES = 8 * 1024 * 1024

PRICE_HINTS_USD_PER_1M: dict[str, tuple[float, float]] = {
    "local": (0.0, 0.0),
    "ollama": (0.0, 0.0),
}

MODEL_PRICE_PROFILES_USD_PER_1M: dict[str, dict[str, Any]] = {
    "deepseek-v4-flash": {
        "input_miss": 0.14,
        "input_hit": 0.0028,
        "output": 0.28,
    },
    "deepseek-chat": {
        "input_miss": 0.14,
        "input_hit": 0.0028,
        "output": 0.28,
    },
    "deepseek-reasoner": {
        "input_miss": 0.14,
        "input_hit": 0.0028,
        "output": 0.28,
    },
    "deepseek-v4-pro": {
        "input_miss": 0.435,
        "input_hit": 0.003625,
        "output": 0.87,
        "discount_until": datetime(2026, 5, 31, 15, 59, 0, tzinfo=timezone.utc),
        "fallback_input_miss": 1.74,
        "fallback_input_hit": 0.0145,
        "fallback_output": 3.48,
    },
}


def _safe_relative_name(name: str | None) -> str:
    raw = (name or "document.txt").replace("\\", "/")
    parts: list[str] = []
    for part in raw.split("/"):
        clean = part.strip()
        if not clean or clean in {".", ".."}:
            continue
        clean = re.sub(r"[^A-Za-z0-9._() -]+", "_", clean)[:120]
        if clean:
            parts.append(clean)
    return "/".join(parts) or "document.txt"


def _storage_name(relative_name: str) -> str:
    return (re.sub(r"[^A-Za-z0-9._-]+", "__", relative_name.replace("\\", "/")).strip("._") or "document")[:180]


def _should_skip_upload_name(relative_name: str, size: int = 0) -> bool:
    return _skip_upload_reason(relative_name, size) is not None


def _skip_upload_reason(relative_name: str, size: int = 0) -> str | None:
    parts = [part.lower() for part in relative_name.replace("\\", "/").split("/") if part]
    skipped_part = next((part for part in parts if part in SKIPPED_PATH_PARTS), "")
    if skipped_part:
        return f"skipped because path contains dependency or build folder: {skipped_part}"
    if size > MAX_INDEXABLE_FILE_BYTES:
        return f"skipped because file is too large: {size} bytes > {MAX_INDEXABLE_FILE_BYTES} bytes"
    extension = Path(relative_name).suffix.lower()
    if extension in BINARY_EXTENSIONS:
        return f"skipped because {extension or 'this'} files are treated as binary assets"
    return None


def _estimate_tokens(text: str) -> int:
    compact = re.sub(r"\s+", " ", text or "").strip()
    if not compact:
        return 0
    return max(1, round(len(compact) / 4))


def _normalize_model_id(model_id: str | None) -> str:
    return (model_id or "").strip().lower()


def _model_price_profile(provider: str, model_id: str) -> dict[str, float] | None:
    normalized_model = _normalize_model_id(model_id)
    if normalized_model in MODEL_PRICE_PROFILES_USD_PER_1M:
        profile = MODEL_PRICE_PROFILES_USD_PER_1M[normalized_model]
        discount_until = profile.get("discount_until")
        if discount_until and datetime.now(timezone.utc) > discount_until:
            return {
                "input_miss": float(profile.get("fallback_input_miss") or profile.get("input_miss") or 0),
                "input_hit": float(profile.get("fallback_input_hit") or profile.get("input_hit") or 0),
                "output": float(profile.get("fallback_output") or profile.get("output") or 0),
            }
        return {
            "input_miss": float(profile.get("input_miss") or 0),
            "input_hit": float(profile.get("input_hit") or 0),
            "output": float(profile.get("output") or 0),
        }
    input_rate, output_rate = PRICE_HINTS_USD_PER_1M.get(normalized_model, PRICE_HINTS_USD_PER_1M.get(provider, (0.0, 0.0)))
    if not input_rate and not output_rate:
        return None
    return {"input_miss": float(input_rate), "input_hit": float(input_rate), "output": float(output_rate)}


def _estimate_usage_cost(
    provider: str,
    model_id: str,
    input_tokens: int,
    output_tokens: int,
    cached_input_tokens: int = 0,
) -> float:
    profile = _model_price_profile(provider, model_id)
    if not profile:
        return 0.0
    cache_hits = max(0, int(cached_input_tokens or 0))
    cache_miss = max(0, int(input_tokens or 0) - cache_hits)
    total = (
        cache_hits / 1_000_000 * profile["input_hit"]
        + cache_miss / 1_000_000 * profile["input_miss"]
        + max(0, int(output_tokens or 0)) / 1_000_000 * profile["output"]
    )
    return round(total, 8)


def _repair_usage_cost(provider: str, model_id: str, input_tokens: int, output_tokens: int, estimated_cost: float, cached_input_tokens: int = 0) -> float:
    if float(estimated_cost or 0) > 0:
        return float(estimated_cost)
    return _estimate_usage_cost(provider, model_id, input_tokens, output_tokens, cached_input_tokens)


def _project_rag_settings(project: dict[str, Any] | None, override_top_k: int | None = None) -> dict[str, Any]:
    metadata_filter: dict[str, Any] = {}
    try:
        metadata_filter = json.loads((project or {}).get("metadata_filter_json") or "{}")
    except (TypeError, ValueError):
        metadata_filter = {}
    return {
        "chunk_size": int((project or {}).get("chunk_size") or 1200),
        "chunk_overlap": int((project or {}).get("chunk_overlap") or 160),
        "top_k": int(override_top_k or (project or {}).get("retrieval_top_k") or 5),
        "retrieval_mode": (project or {}).get("retrieval_mode") or "hybrid",
        "retrieval_scope": (project or {}).get("retrieval_scope") or "focused",
        "similarity_threshold": float((project or {}).get("similarity_threshold") or 0),
        "query_rewrite_enabled": bool((project or {}).get("query_rewrite_enabled")),
        "rerank_enabled": bool((project or {}).get("rerank_enabled")),
        "agent_tools_enabled": bool((project or {}).get("agent_tools_enabled")),
        "full_context_limit": int((project or {}).get("full_context_limit") or 20),
        "metadata_filter": metadata_filter,
        "embedding_model_id": (project or {}).get("embedding_model_id"),
        "rerank_model_id": (project or {}).get("rerank_model_id"),
    }


def _checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _checksum_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_dict(value: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _merge_metadata(base: dict[str, Any], patch: dict[str, Any] | None = None) -> str:
    merged = {**base, **(patch or {})}
    return json.dumps(merged, ensure_ascii=False, sort_keys=True)


MOJIBAKE_HINTS = set("ÃÂâæçèéêëîïðñåäöüœ")


def _text_repair_score(value: str) -> int:
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", value or ""))
    mojibake_count = sum(1 for char in value or "" if char in MOJIBAKE_HINTS)
    replacement_count = (value or "").count("\ufffd")
    return cjk_count * 4 - mojibake_count * 3 - replacement_count * 2


def _repair_text(value: str) -> str:
    if not isinstance(value, str) or not value:
        return value
    if not any(char in value for char in MOJIBAKE_HINTS):
        return value
    try:
        repaired = value.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value
    return repaired if _text_repair_score(repaired) > _text_repair_score(value) else value


def _repair_payload(value: Any) -> Any:
    if isinstance(value, str):
        return _repair_text(value)
    if isinstance(value, list):
        return [_repair_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: _repair_payload(item) for key, item in value.items()}
    return value


def _classify_import_reason(reason: str | None) -> str:
    lowered = (reason or "").lower()
    if "duplicate" in lowered:
        return "duplicate"
    if any(token in lowered for token in ("dependency", "binary", "too large", "folder")):
        return "skipped"
    return "failed"


def _normalize_import_item(item: dict[str, Any], fallback_status: str) -> dict[str, Any]:
    normalized = _repair_payload(dict(item or {}))
    normalized["filename"] = str(normalized.get("filename") or "")
    normalized["status"] = str(normalized.get("status") or fallback_status)
    normalized["reason"] = str(normalized.get("reason") or "")
    normalized["chunks"] = int(normalized.get("chunks") or 0)
    if normalized.get("duplicate_document_id") is not None:
        normalized["duplicate_document_id"] = int(normalized["duplicate_document_id"])
    if normalized.get("document_id") is not None:
        normalized["document_id"] = int(normalized["document_id"])
    return normalized


def _build_import_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    indexed = [item for item in results if item.get("status") == "indexed"]
    duplicates = [item for item in results if item.get("status") == "duplicate"]
    skipped = [item for item in results if item.get("status") == "skipped"]
    failed = [item for item in results if item.get("status") == "failed"]
    return {
        "total_files": len(results),
        "indexed_files": len(indexed),
        "duplicate_files": len(duplicates),
        "skipped_files": len(skipped),
        "failed_files": len(failed),
        "indexed_chunks": sum(int(item.get("chunks") or 0) for item in indexed),
        "new_files": [item.get("filename") for item in indexed if item.get("filename")],
        "duplicate_names": [item.get("filename") for item in duplicates if item.get("filename")],
        "failed_names": [item.get("filename") for item in failed if item.get("filename")],
    }


def _log_event(level: str, area: str, message: str, detail: dict[str, Any] | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO system_events (level, area, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (level, area, message, json.dumps(detail or {}, ensure_ascii=False), now_iso()),
        )


async def _vectors_for_chunks(chunks: list[str], embedding_model_id: int | None = None) -> tuple[list[list[float]], int | None]:
    if not embedding_model_id:
        return [embed(chunk) for chunk in chunks], None
    with get_conn() as conn:
        model = row_to_dict(
            conn.execute(
                "SELECT * FROM model_configs WHERE id = ? AND enabled = 1 AND model_type = 'embedding'",
                (embedding_model_id,),
            ).fetchone()
        )
    if model is None:
        return [embed(chunk) for chunk in chunks], None
    model = _private_model(model)
    try:
        vectors = await embed_with_model(model, chunks)
        if len(vectors) != len(chunks) or any(not vector for vector in vectors):
            raise ModelCallError("Embedding provider returned an incomplete vector set")
        return vectors, model["id"]
    except Exception as exc:
        _log_event("warning", "embedding", "Embedding model failed; used local hashing fallback", {"error": str(exc)[:300], "model_id": embedding_model_id})
        return [embed(chunk) for chunk in chunks], None


def _rewrite_query(question: str, recent_messages: list[dict[str, Any]]) -> str:
    if not recent_messages:
        return question
    tail = " ".join(message.get("content", "")[:240] for message in recent_messages[-4:])
    return f"{tail}\n{question}"[:2400]


async def _apply_rerank(query: str, contexts: list[dict[str, Any]], rerank_model_id: int | None) -> list[dict[str, Any]]:
    if not contexts:
        return contexts
    model = None
    if rerank_model_id:
        with get_conn() as conn:
            model = row_to_dict(
                conn.execute(
                    "SELECT * FROM model_configs WHERE id = ? AND enabled = 1 AND model_type = 'rerank'",
                    (rerank_model_id,),
                ).fetchone()
            )
    if model is None:
        scores = [item.get("keyword_score", 0) for item in contexts]
    else:
        model = _private_model(model)
        try:
            scores = await rerank_with_model(model, query, [item["content"] for item in contexts])
        except Exception as exc:
            _log_event("warning", "rerank", "Rerank model failed; used keyword fallback", {"error": str(exc)[:300], "model_id": rerank_model_id})
            scores = [item.get("keyword_score", 0) for item in contexts]
    reranked = []
    for item, rerank_score in zip(contexts, scores):
        copy = dict(item)
        copy["rerank_score"] = round(float(rerank_score or 0), 4)
        copy["score"] = round(copy.get("score", 0) * 0.65 + copy["rerank_score"] * 0.35, 4)
        reranked.append(copy)
    reranked.sort(key=lambda item: item["score"], reverse=True)
    return reranked


async def _prepare_retrieval(
    payload: ChatRequest | RagDebugRequest,
    project: dict[str, Any] | None,
    request: Request | None = None,
    conversation_id: int | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], str, int]:
    settings = _project_rag_settings(project, payload.top_k)
    if getattr(payload, "retrieval_scope", None):
        settings["retrieval_scope"] = payload.retrieval_scope
    if getattr(payload, "use_query_rewrite", None) is not None:
        settings["query_rewrite_enabled"] = bool(payload.use_query_rewrite)
    if getattr(payload, "use_rerank", None) is not None:
        settings["rerank_enabled"] = bool(payload.use_rerank)
    if getattr(payload, "metadata_filter", None):
        settings["metadata_filter"] = payload.metadata_filter or {}
    if getattr(payload, "retrieval_mode", None):
        settings["retrieval_mode"] = payload.retrieval_mode
    if getattr(payload, "similarity_threshold", None) is not None:
        settings["similarity_threshold"] = payload.similarity_threshold

    recent_messages: list[dict[str, Any]] = []
    if conversation_id and settings["query_rewrite_enabled"]:
        with get_conn() as conn:
            recent_messages = rows_to_dicts(
                conn.execute(
                    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 6",
                    (conversation_id,),
                ).fetchall()
            )
        recent_messages.reverse()
    effective_query = _rewrite_query(payload.message if isinstance(payload, ChatRequest) else payload.query, recent_messages) if settings["query_rewrite_enabled"] else (payload.message if isinstance(payload, ChatRequest) else payload.query)
    vectors, _ = await _vectors_for_chunks([effective_query], settings["embedding_model_id"])
    retrieval_start = time.perf_counter()
    allowed_project_ids: list[int] | None = None
    if request is not None and not payload.project_id:
        with get_conn() as conn:
            allowed_project_ids = _accessible_project_ids(conn, request)
    contexts = retrieve_context(
        query=effective_query,
        project_id=payload.project_id,
        allowed_project_ids=allowed_project_ids,
        top_k=settings["top_k"],
        mode=settings["retrieval_mode"],
        similarity_threshold=settings["similarity_threshold"],
        query_vector=vectors[0] if vectors else None,
        metadata_filter=settings["metadata_filter"],
        scope=settings["retrieval_scope"],
        full_context_limit=settings["full_context_limit"],
    )
    if settings["rerank_enabled"]:
        contexts = await _apply_rerank(effective_query, contexts, settings["rerank_model_id"])
    retrieval_ms = int((time.perf_counter() - retrieval_start) * 1000)
    return settings, contexts, effective_query, retrieval_ms


def _row_bool(row: dict[str, Any], key: str) -> bool:
    return bool(row.get(key))


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _split_globs(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in re.split(r"[\n,;]+", value) if part.strip()]


def _matches_sync_filters(relative_name: str, include_globs: str = "", exclude_globs: str = "") -> bool:
    normalized = relative_name.replace("\\", "/")
    includes = _split_globs(include_globs)
    excludes = _split_globs(exclude_globs)
    if includes and not any(fnmatch.fnmatch(normalized, pattern) for pattern in includes):
        return False
    if excludes and any(fnmatch.fnmatch(normalized, pattern) for pattern in excludes):
        return False
    return True


def _serialize_sync_source(row: dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["enabled"] = bool(item.get("enabled"))
    item["delete_missing"] = bool(item.get("delete_missing"))
    item["poll_interval_seconds"] = int(item.get("poll_interval_seconds") or 60)
    item["document_count"] = int(item.get("document_count") or 0)
    item["healthy_count"] = int(item.get("healthy_count") or 0)
    item["pending_count"] = max(0, item["document_count"] - item["healthy_count"])
    item["last_summary"] = _json_dict(item.pop("last_summary_json", "{}"))
    return item


def list_sync_sources(project_id: int | None = None) -> list[dict[str, Any]]:
    where = "WHERE sync_sources.project_id = ?" if project_id else ""
    params: tuple[Any, ...] = (project_id,) if project_id else ()
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT sync_sources.*,
                       projects.name AS project_name,
                       COUNT(DISTINCT sync_source_documents.id) AS document_count,
                       SUM(CASE WHEN sync_source_documents.status = 'ready' THEN 1 ELSE 0 END) AS healthy_count
                FROM sync_sources
                JOIN projects ON projects.id = sync_sources.project_id
                LEFT JOIN sync_source_documents ON sync_source_documents.sync_source_id = sync_sources.id
                {where}
                GROUP BY sync_sources.id
                ORDER BY sync_sources.updated_at DESC, sync_sources.id DESC
                """,
                params,
            ).fetchall()
        )
    return [_serialize_sync_source(row) for row in rows]


def _update_sync_source_state(source_id: int, *, error: str = "", summary: dict[str, Any] | None = None) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE sync_sources
            SET last_scan_at = ?, last_error = ?, last_summary_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                now_iso(),
                error[:400],
                json.dumps(summary or {}, ensure_ascii=False),
                now_iso(),
                source_id,
            ),
        )


def _sync_upload_target(source_id: int, relative_name: str) -> Path:
    target = UPLOAD_DIR / "sync" / str(source_id) / _storage_name(relative_name)
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def _delete_document_record(document_id: int) -> dict[str, bool]:
    file_removed = True
    chunk_ids: list[int] = []
    with get_conn() as conn:
        row = conn.execute("SELECT path FROM documents WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        chunk_ids = [item["id"] for item in conn.execute("SELECT id FROM chunks WHERE document_id = ?", (document_id,)).fetchall()]
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        try:
            Path(row["path"]).unlink(missing_ok=True)
        except OSError:
            file_removed = False
    try:
        delete_qdrant_points_sync(chunk_ids)
    except Exception as exc:
        _log_event("warning", "qdrant", "Qdrant delete failed after document deletion", {"error": str(exc)[:300], "document_id": document_id})
    return {"ok": True, "file_removed": file_removed}


async def _scan_sync_source(source_id: int) -> dict[str, Any]:
    if source_id in active_sync_source_ids:
        return {"status": "busy", "source_id": source_id}
    active_sync_source_ids.add(source_id)
    try:
        with get_conn() as conn:
            source = row_to_dict(conn.execute("SELECT * FROM sync_sources WHERE id = ?", (source_id,)).fetchone())
            if source is None:
                raise HTTPException(status_code=404, detail="Sync source not found")
            project = row_to_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (source["project_id"],)).fetchone())
            tracked_rows = rows_to_dicts(conn.execute("SELECT * FROM sync_source_documents WHERE sync_source_id = ?", (source_id,)).fetchall())
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        root = Path(source["source_path"]).expanduser()
        if not root.exists() or not root.is_dir():
            summary = {"indexed_files": 0, "updated_files": 0, "deleted_files": 0, "missing_files": 0, "unchanged_files": 0, "failed_files": 1}
            _update_sync_source_state(source_id, error="source path does not exist or is not a folder", summary=summary)
            _log_event("warning", "sync", "Folder sync source is unavailable", {"source_id": source_id, "source_path": str(root)})
            return {"source_id": source_id, "summary": summary}

        tracked_by_path = {str(row.get("relative_path") or ""): row for row in tracked_rows}
        seen_paths: set[str] = set()
        indexed_files = 0
        updated_files = 0
        unchanged_files = 0
        missing_files = 0
        deleted_files = 0
        failed_files = 0
        for file_path in root.rglob("*"):
            if not file_path.is_file():
                continue
            relative_name = file_path.relative_to(root).as_posix()
            if not _matches_sync_filters(relative_name, source.get("include_globs") or "", source.get("exclude_globs") or ""):
                continue
            stat = file_path.stat()
            skip_reason = _skip_upload_reason(relative_name, stat.st_size)
            if skip_reason:
                continue
            seen_paths.add(relative_name)
            tracked = tracked_by_path.get(relative_name)
            if tracked and abs(float(tracked.get("source_mtime") or 0) - float(stat.st_mtime)) < 0.001 and int(tracked.get("source_size") or 0) == int(stat.st_size) and tracked.get("status") == "ready":
                unchanged_files += 1
                with get_conn() as conn:
                    conn.execute(
                        "UPDATE sync_source_documents SET last_seen_at = ?, updated_at = ?, error = '' WHERE id = ?",
                        (now_iso(), now_iso(), tracked["id"]),
                    )
                continue

            target_path = _sync_upload_target(source_id, relative_name)
            shutil.copy2(file_path, target_path)
            file_checksum = _checksum_file(target_path)
            try:
                result = await _index_saved_file(
                    target_path,
                    relative_name,
                    project["id"],
                    project,
                    metadata_patch={
                        "sync_source_id": source_id,
                        "sync_relative_path": relative_name,
                        "sync_root": str(root),
                        "sync_mtime": stat.st_mtime,
                    },
                    replace_document_id=tracked.get("document_id") if tracked and tracked.get("document_id") else None,
                    force_new=not bool(tracked and tracked.get("document_id")),
                )
                if tracked and tracked.get("document_id"):
                    updated_files += 1
                else:
                    indexed_files += 1
                with get_conn() as conn:
                    conn.execute(
                        """
                        INSERT INTO sync_source_documents
                        (sync_source_id, document_id, relative_path, source_mtime, source_size, checksum, status, error, last_seen_at, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'ready', '', ?, ?, ?)
                        ON CONFLICT(sync_source_id, relative_path) DO UPDATE SET
                            document_id = excluded.document_id,
                            source_mtime = excluded.source_mtime,
                            source_size = excluded.source_size,
                            checksum = excluded.checksum,
                            status = 'ready',
                            error = '',
                            last_seen_at = excluded.last_seen_at,
                            updated_at = excluded.updated_at
                        """,
                        (
                            source_id,
                            result["document_id"],
                            relative_name,
                            float(stat.st_mtime),
                            int(stat.st_size),
                            file_checksum,
                            now_iso(),
                            now_iso(),
                            now_iso(),
                        ),
                    )
            except Exception as exc:
                failed_files += 1
                with get_conn() as conn:
                    conn.execute(
                        """
                        INSERT INTO sync_source_documents
                        (sync_source_id, document_id, relative_path, source_mtime, source_size, checksum, status, error, last_seen_at, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?, ?)
                        ON CONFLICT(sync_source_id, relative_path) DO UPDATE SET
                            source_mtime = excluded.source_mtime,
                            source_size = excluded.source_size,
                            checksum = excluded.checksum,
                            status = 'failed',
                            error = excluded.error,
                            last_seen_at = excluded.last_seen_at,
                            updated_at = excluded.updated_at
                        """,
                        (
                            source_id,
                            tracked.get("document_id") if tracked else None,
                            relative_name,
                            float(stat.st_mtime),
                            int(stat.st_size),
                            file_checksum,
                            str(exc)[:300],
                            now_iso(),
                            now_iso(),
                            now_iso(),
                        ),
                    )

        for relative_name, tracked in tracked_by_path.items():
            if relative_name in seen_paths:
                continue
            missing_files += 1
            if source.get("delete_missing") and tracked.get("document_id"):
                try:
                    _delete_document_record(int(tracked["document_id"]))
                    with get_conn() as conn:
                        conn.execute("DELETE FROM sync_source_documents WHERE id = ?", (tracked["id"],))
                    deleted_files += 1
                    continue
                except Exception as exc:
                    failed_files += 1
                    with get_conn() as conn:
                        conn.execute("UPDATE sync_source_documents SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", (str(exc)[:300], now_iso(), tracked["id"]))
                    continue
            with get_conn() as conn:
                conn.execute("UPDATE sync_source_documents SET status = 'missing', error = 'source file missing', updated_at = ? WHERE id = ?", (now_iso(), tracked["id"]))
                if tracked.get("document_id"):
                    conn.execute("UPDATE documents SET status = 'missing', updated_at = ? WHERE id = ?", (now_iso(), tracked["document_id"]))

        summary = {
            "indexed_files": indexed_files,
            "updated_files": updated_files,
            "deleted_files": deleted_files,
            "missing_files": missing_files,
            "unchanged_files": unchanged_files,
            "failed_files": failed_files,
        }
        _update_sync_source_state(source_id, error="", summary=summary)
        _log_event("info", "sync", "Folder sync scan finished", {"source_id": source_id, **summary})
        return {"source_id": source_id, "summary": summary}
    finally:
        active_sync_source_ids.discard(source_id)


async def _sync_worker_loop() -> None:
    while not sync_worker_stop.is_set():
        try:
            due_sources: list[int] = []
            with get_conn() as conn:
                rows = rows_to_dicts(conn.execute("SELECT id, enabled, poll_interval_seconds, last_scan_at FROM sync_sources WHERE enabled = 1").fetchall())
            now_ts = datetime.now(timezone.utc).timestamp()
            for row in rows:
                last_scan_at = row.get("last_scan_at")
                if not last_scan_at:
                    due_sources.append(int(row["id"]))
                    continue
                try:
                    last_ts = datetime.fromisoformat(str(last_scan_at)).timestamp()
                except ValueError:
                    due_sources.append(int(row["id"]))
                    continue
                if now_ts - last_ts >= int(row.get("poll_interval_seconds") or 60):
                    due_sources.append(int(row["id"]))
            for source_id in due_sources:
                if source_id in active_sync_source_ids:
                    continue
                await _scan_sync_source(source_id)
        except Exception as exc:
            _log_event("warning", "sync", "Background sync loop failed", {"error": str(exc)[:300]})
        try:
            await asyncio.wait_for(sync_worker_stop.wait(), timeout=SYNC_LOOP_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue


@app.on_event("startup")
async def on_startup() -> None:
    init_db()
    sync_worker_stop.clear()
    global sync_worker_task
    sync_worker_task = asyncio.create_task(_sync_worker_loop())


@app.on_event("shutdown")
async def on_shutdown() -> None:
    sync_worker_stop.set()
    global sync_worker_task
    if sync_worker_task is not None:
        sync_worker_task.cancel()
        try:
            await sync_worker_task
        except asyncio.CancelledError:
            pass
        sync_worker_task = None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/auth/session")
def auth_session(request: Request) -> dict[str, Any]:
    return _resolve_auth_context(request)


@app.post("/api/auth/bootstrap")
def auth_bootstrap(payload: BootstrapRequest, request: Request) -> dict[str, Any]:
    admin_token, _ = _env_tokens()
    provided = request.headers.get("x-kortex-token", "").strip()
    now = now_iso()
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    device_name = payload.device_name.strip() or "Current device"
    if admin_token and provided != admin_token:
        raise HTTPException(status_code=401, detail="Admin token required to bootstrap while env auth is enabled")
    with get_conn() as conn:
        if _password_auth_user_count(conn) > 0:
            raise HTTPException(status_code=409, detail="Bootstrap has already been completed")
        cursor = conn.execute(
            """
            INSERT INTO users (email, display_name, password_hash, role, workspace_role, disabled, created_at, updated_at)
            VALUES (?, ?, ?, 'admin', 'owner', 0, ?, ?)
            """,
            (email, display_name, hash_password(payload.password), now, now),
        )
        user_id = int(cursor.lastrowid)
        project_rows = rows_to_dicts(conn.execute("SELECT id FROM projects").fetchall())
        for project_row in project_rows:
            conn.execute(
                """
                INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at, updated_at)
                VALUES (?, ?, 'owner', ?, ?)
                """,
                (int(project_row["id"]), user_id, now, now),
            )
        session_token = create_session_token()
        session_hash = hash_session_token(session_token)
        expires_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=_session_ttl_days())
        session_cursor = conn.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, device_name, user_agent, ip_address, created_at, expires_at, last_seen_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                session_hash,
                device_name,
                request.headers.get("user-agent", "")[:255],
                _get_request_ip(request),
                now,
                expires_at.isoformat(),
                now,
                now,
            ),
        )
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now, now, user_id))
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()) or {}
        session_row = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (int(session_cursor.lastrowid),)).fetchone()) or {}
    _log_event("info", "auth", "Bootstrap completed", {"email": email})
    auth_payload = _build_auth_session_payload(
        "admin",
        True,
        False,
        user=_serialize_auth_user(user_row, "password"),
        session=_serialize_auth_session(session_row, current_session_id=int(session_row["id"])),
        auth_mode="password",
        can_bootstrap=False,
    )
    return {"token": session_token, "auth": auth_payload}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    now = now_iso()
    email = payload.email.strip().lower()
    device_name = payload.device_name.strip() or "Current device"
    with get_conn() as conn:
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone())
        if not user_row or not verify_password(payload.password, user_row.get("password_hash")):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if user_row.get("disabled"):
            raise HTTPException(status_code=403, detail="This account has been disabled")
        session_token = create_session_token()
        session_hash = hash_session_token(session_token)
        expires_at = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=_session_ttl_days())
        session_cursor = conn.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, device_name, user_agent, ip_address, created_at, expires_at, last_seen_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(user_row["id"]),
                session_hash,
                device_name,
                request.headers.get("user-agent", "")[:255],
                _get_request_ip(request),
                now,
                expires_at.isoformat(),
                now,
                now,
            ),
        )
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now, now, int(user_row["id"])))
        user_row["last_login_at"] = now
        user_row["updated_at"] = now
        session_row = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (int(session_cursor.lastrowid),)).fetchone()) or {}
    _log_event("info", "auth", "User login", {"email": email, "device_name": device_name})
    auth_payload = _build_auth_session_payload(
        str(user_row.get("role") or "user"),
        True,
        False,
        user=_serialize_auth_user(user_row, "password"),
        session=_serialize_auth_session(session_row, current_session_id=int(session_row["id"])),
        auth_mode="password",
        can_bootstrap=False,
    )
    return {"token": session_token, "auth": auth_payload}


@app.post("/api/auth/logout")
def auth_logout(request: Request) -> dict[str, bool]:
    current_session = getattr(request.state, "kortex_session", None)
    if current_session:
        now = now_iso()
        with get_conn() as conn:
            conn.execute("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?", (now, now, int(current_session["id"])))
    return {"ok": True}


@app.get("/api/auth/sessions")
def list_auth_sessions(request: Request) -> list[dict[str, Any]]:
    current_user = getattr(request.state, "kortex_user", None)
    current_session = getattr(request.state, "kortex_session", None)
    if not current_user or int(current_user.get("id") or 0) <= 0:
        return []
    current_session_id = int(current_session["id"]) if current_session else None
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT *
                FROM auth_sessions
                WHERE user_id = ?
                ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, created_at DESC, id DESC
                """,
                (int(current_user["id"]),),
            ).fetchall()
        )
    return [_serialize_auth_session(row, current_session_id=current_session_id) or {} for row in rows]


@app.delete("/api/auth/sessions/{session_id}")
def revoke_auth_session(session_id: int, request: Request) -> dict[str, bool]:
    current_user = getattr(request.state, "kortex_user", None)
    if not current_user or int(current_user.get("id") or 0) <= 0:
        raise HTTPException(status_code=403, detail="Password auth session required")
    with get_conn() as conn:
        target = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (session_id,)).fetchone())
        if target is None:
            raise HTTPException(status_code=404, detail="Session not found")
        if int(target.get("user_id") or 0) != int(current_user["id"]):
            raise HTTPException(status_code=403, detail="You can only revoke your own sessions")
        now = now_iso()
        conn.execute("UPDATE auth_sessions SET revoked_at = ?, updated_at = ? WHERE id = ?", (now, now, session_id))
    return {"ok": True}


@app.get("/api/team/members")
def list_team_members(request: Request) -> list[dict[str, Any]]:
    if not _can_manage_workspace(request):
        raise HTTPException(status_code=403, detail="Workspace admin access required")
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT users.*,
                       COUNT(DISTINCT project_members.project_id) AS project_count
                FROM users
                LEFT JOIN project_members ON project_members.user_id = users.id
                GROUP BY users.id
                ORDER BY CASE users.workspace_role
                    WHEN 'owner' THEN 4
                    WHEN 'admin' THEN 3
                    WHEN 'member' THEN 2
                    ELSE 1
                END DESC, users.created_at ASC
                """
            ).fetchall()
        )
    return [_serialize_team_member(row) or {} for row in rows]


@app.patch("/api/team/members/{user_id}")
def patch_team_member(user_id: int, payload: TeamMemberWorkspacePatch, request: Request) -> dict[str, Any]:
    if not _can_manage_workspace(request):
        raise HTTPException(status_code=403, detail="Workspace admin access required")
    current_user = getattr(request.state, "kortex_user", None)
    if current_user and int(current_user.get("id") or 0) == user_id and payload.workspace_role != "owner":
        raise HTTPException(status_code=400, detail="You cannot downgrade your own owner account here")
    with get_conn() as conn:
        target = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        if target is None:
            raise HTTPException(status_code=404, detail="Member not found")
        now = now_iso()
        system_role = "admin" if payload.workspace_role in {"owner", "admin"} else "user"
        conn.execute(
            "UPDATE users SET workspace_role = ?, role = ?, updated_at = ? WHERE id = ?",
            (payload.workspace_role, system_role, now, user_id),
        )
        row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()) or {}
    return _serialize_team_member(row) or {}


@app.get("/api/team/invitations")
def list_team_invitations(request: Request) -> list[dict[str, Any]]:
    if not _can_manage_workspace(request):
        raise HTTPException(status_code=403, detail="Workspace admin access required")
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT team_invitations.*,
                       users.display_name AS invited_by_name
                FROM team_invitations
                LEFT JOIN users ON users.id = team_invitations.invited_by_user_id
                ORDER BY team_invitations.created_at DESC, team_invitations.id DESC
                """
            ).fetchall()
        )
        return [
            _serialize_team_invitation(row, _project_names_for_ids(conn, _parse_project_ids_json(row.get("project_ids_json")))) or {}
            for row in rows
        ]


@app.post("/api/team/invitations")
def create_team_invitation(payload: TeamInviteIn, request: Request) -> dict[str, Any]:
    if not _can_manage_workspace(request):
        raise HTTPException(status_code=403, detail="Workspace admin access required")
    now = now_iso()
    email = _normalize_email(payload.email)
    project_ids = sorted({int(item) for item in payload.project_ids if int(item) > 0})
    with get_conn() as conn:
        for project_id in project_ids:
            _assert_project_access(conn, request, project_id, "owner")
        invite_token = secrets.token_urlsafe(24)
        expires_at = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=payload.expires_in_days)).isoformat()
        cursor = conn.execute(
            """
            INSERT INTO team_invitations
            (email, workspace_role, project_role, project_ids_json, invite_token, message, invited_by_user_id, status, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
            """,
            (
                email,
                payload.workspace_role,
                payload.project_role,
                json.dumps(project_ids),
                invite_token,
                payload.message.strip(),
                int((getattr(request.state, "kortex_user", {}) or {}).get("id") or 0) or None,
                expires_at,
                now,
                now,
            ),
        )
        row = row_to_dict(
            conn.execute(
                """
                SELECT team_invitations.*, users.display_name AS invited_by_name
                FROM team_invitations
                LEFT JOIN users ON users.id = team_invitations.invited_by_user_id
                WHERE team_invitations.id = ?
                """,
                (int(cursor.lastrowid),),
            ).fetchone()
        ) or {}
        return _serialize_team_invitation(row, _project_names_for_ids(conn, project_ids)) or {}


@app.get("/api/team/invitations/preview")
def preview_team_invitation(token: str) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        invite = row_to_dict(conn.execute("SELECT * FROM team_invitations WHERE invite_token = ?", (token.strip(),)).fetchone())
        if invite is None:
            raise HTTPException(status_code=404, detail="Invitation not found")
        if invite.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Invitation is no longer active")
        expires_at = invite.get("expires_at")
        if expires_at:
            try:
                if datetime.fromisoformat(str(expires_at)) <= datetime.now(timezone.utc):
                    conn.execute("UPDATE team_invitations SET status = 'expired', updated_at = ? WHERE id = ?", (now, int(invite["id"])))
                    raise HTTPException(status_code=400, detail="Invitation has expired")
            except ValueError:
                pass
        project_ids = _parse_project_ids_json(invite.get("project_ids_json"))
        project_names = _project_names_for_ids(conn, project_ids)
    return {
        "email": str(invite.get("email") or ""),
        "workspace_role": str(invite.get("workspace_role") or "member"),
        "project_role": str(invite.get("project_role") or "viewer"),
        "project_ids": project_ids,
        "project_names": project_names,
        "message": str(invite.get("message") or ""),
        "expires_at": invite.get("expires_at"),
        "status": str(invite.get("status") or "pending"),
    }


@app.delete("/api/team/invitations/{invite_id}")
def revoke_team_invitation(invite_id: int, request: Request) -> dict[str, bool]:
    if not _can_manage_workspace(request):
        raise HTTPException(status_code=403, detail="Workspace admin access required")
    now = now_iso()
    with get_conn() as conn:
        target = row_to_dict(conn.execute("SELECT * FROM team_invitations WHERE id = ?", (invite_id,)).fetchone())
        if target is None:
            raise HTTPException(status_code=404, detail="Invitation not found")
        conn.execute("UPDATE team_invitations SET status = 'revoked', updated_at = ? WHERE id = ?", (now, invite_id))
    return {"ok": True}


@app.post("/api/team/invitations/accept")
def accept_team_invitation(payload: TeamInviteAcceptRequest) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        invite = row_to_dict(conn.execute("SELECT * FROM team_invitations WHERE invite_token = ?", (payload.invite_token.strip(),)).fetchone())
        if invite is None:
            raise HTTPException(status_code=404, detail="Invitation not found")
        if invite.get("status") != "pending":
            raise HTTPException(status_code=400, detail="Invitation is no longer active")
        expires_at = invite.get("expires_at")
        if expires_at:
            try:
                if datetime.fromisoformat(str(expires_at)) <= datetime.now(timezone.utc):
                    conn.execute("UPDATE team_invitations SET status = 'expired', updated_at = ? WHERE id = ?", (now, int(invite["id"])))
                    raise HTTPException(status_code=400, detail="Invitation has expired")
            except ValueError:
                pass
        email = _normalize_email(str(invite.get("email") or ""))
        existing = row_to_dict(conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone())
        if existing is not None:
            raise HTTPException(status_code=409, detail="This email already has an account. Ask an admin to share the project directly.")
        workspace_role = str(invite.get("workspace_role") or "member")
        system_role = "admin" if workspace_role in {"owner", "admin"} else "user"
        cursor = conn.execute(
            """
            INSERT INTO users (email, display_name, password_hash, role, workspace_role, disabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (email, payload.display_name.strip(), hash_password(payload.password), system_role, workspace_role, now, now),
        )
        user_id = int(cursor.lastrowid)
        project_ids = [int(item) for item in json.loads(invite.get("project_ids_json") or "[]") if str(item).isdigit() or isinstance(item, int)]
        for project_id in project_ids:
            conn.execute(
                """
                INSERT OR REPLACE INTO project_members (project_id, user_id, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (project_id, user_id, invite.get("project_role") or "viewer", now, now),
            )
        conn.execute(
            "UPDATE team_invitations SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ?",
            (now, now, int(invite["id"])),
        )
        session_token = create_session_token()
        session_hash = hash_session_token(session_token)
        expires_at = (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=_session_ttl_days())).isoformat()
        session_cursor = conn.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, device_name, user_agent, ip_address, created_at, expires_at, last_seen_at, updated_at)
            VALUES (?, ?, ?, '', '', ?, ?, ?, ?)
            """,
            (user_id, session_hash, payload.device_name.strip() or "Current device", now, expires_at, now, now),
        )
        conn.execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (now, now, user_id))
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()) or {}
        session_row = row_to_dict(conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (int(session_cursor.lastrowid),)).fetchone()) or {}
    auth_payload = _build_auth_session_payload(
        str(user_row.get("role") or "user"),
        True,
        False,
        user=_serialize_auth_user(user_row, "password"),
        session=_serialize_auth_session(session_row, current_session_id=int(session_row["id"])),
        auth_mode="password",
        can_bootstrap=False,
    )
    return {"token": session_token, "auth": auth_payload}


@app.get("/api/projects/{project_id}/members")
def list_project_members(project_id: int, request: Request) -> list[dict[str, Any]]:
    with get_conn() as conn:
        _assert_project_access(conn, request, project_id, "viewer")
        rows = rows_to_dicts(
            conn.execute(
                """
                SELECT project_members.project_id, project_members.role AS project_role, project_members.created_at, project_members.updated_at,
                       users.id AS user_id, users.email, users.display_name, users.workspace_role
                FROM project_members
                JOIN users ON users.id = project_members.user_id
                WHERE project_members.project_id = ?
                ORDER BY CASE project_members.role
                    WHEN 'owner' THEN 3
                    WHEN 'editor' THEN 2
                    ELSE 1
                END DESC, users.created_at ASC
                """,
                (project_id,),
            ).fetchall()
        )
    return [_serialize_project_member(row) or {} for row in rows]


@app.post("/api/projects/{project_id}/members")
def add_project_member(project_id: int, payload: ProjectShareIn, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        _assert_project_access(conn, request, project_id, "owner")
        user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (payload.user_id,)).fetchone())
        if user is None:
            raise HTTPException(status_code=404, detail="Member not found")
        now = now_iso()
        conn.execute(
            """
            INSERT OR REPLACE INTO project_members (project_id, user_id, role, created_at, updated_at)
            VALUES (?, ?, ?, COALESCE((SELECT created_at FROM project_members WHERE project_id = ? AND user_id = ?), ?), ?)
            """,
            (project_id, payload.user_id, payload.role, project_id, payload.user_id, now, now),
        )
        row = rows_to_dicts(
            conn.execute(
                """
                SELECT project_members.project_id, project_members.role AS project_role, project_members.created_at, project_members.updated_at,
                       users.id AS user_id, users.email, users.display_name, users.workspace_role
                FROM project_members
                JOIN users ON users.id = project_members.user_id
                WHERE project_members.project_id = ? AND project_members.user_id = ?
                """,
                (project_id, payload.user_id),
            ).fetchall()
        )[0]
    return _serialize_project_member(row) or {}


@app.patch("/api/projects/{project_id}/members/{user_id}")
def patch_project_member(project_id: int, user_id: int, payload: ProjectSharePatch, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        _assert_project_access(conn, request, project_id, "owner")
        current = row_to_dict(conn.execute("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?", (project_id, user_id)).fetchone())
        if current is None:
            raise HTTPException(status_code=404, detail="Project member not found")
        now = now_iso()
        conn.execute("UPDATE project_members SET role = ?, updated_at = ? WHERE project_id = ? AND user_id = ?", (payload.role, now, project_id, user_id))
        row = rows_to_dicts(
            conn.execute(
                """
                SELECT project_members.project_id, project_members.role AS project_role, project_members.created_at, project_members.updated_at,
                       users.id AS user_id, users.email, users.display_name, users.workspace_role
                FROM project_members
                JOIN users ON users.id = project_members.user_id
                WHERE project_members.project_id = ? AND project_members.user_id = ?
                """,
                (project_id, user_id),
            ).fetchall()
        )[0]
    return _serialize_project_member(row) or {}


@app.delete("/api/projects/{project_id}/members/{user_id}")
def remove_project_member(project_id: int, user_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        _assert_project_access(conn, request, project_id, "owner")
        target = row_to_dict(conn.execute("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?", (project_id, user_id)).fetchone())
        if target is None:
            raise HTTPException(status_code=404, detail="Project member not found")
        if str(target.get("role") or "") == "owner":
            owner_count = int(
                conn.execute("SELECT COUNT(*) AS count FROM project_members WHERE project_id = ? AND role = 'owner'", (project_id,)).fetchone()["count"]
            )
            if owner_count <= 1:
                raise HTTPException(status_code=400, detail="This project must keep at least one owner")
        conn.execute("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", (project_id, user_id))
    return {"ok": True}


@app.get("/api/projects")
def list_projects(request: Request) -> list[dict[str, Any]]:
    with get_conn() as conn:
        accessible_ids = _accessible_project_ids(conn, request)
        where_sql, params = _project_filter_sql(accessible_ids, "projects.id")
        rows = conn.execute(
            f"""
            SELECT projects.*,
                   COUNT(DISTINCT documents.id) AS document_count,
                   COUNT(chunks.id) AS chunk_count,
                   COUNT(DISTINCT project_members.user_id) AS member_count
            FROM projects
            LEFT JOIN documents ON documents.project_id = projects.id
            LEFT JOIN chunks ON chunks.project_id = projects.id
            LEFT JOIN project_members ON project_members.project_id = projects.id
            {where_sql}
            GROUP BY projects.id
            ORDER BY projects.updated_at DESC
            """,
            tuple(params),
        ).fetchall()
        items = rows_to_dicts(rows)
        user = getattr(request.state, "kortex_user", None)
        for item in items:
            item["access_role"] = _user_project_role(conn, user, int(item["id"])) or ("owner" if getattr(request.state, "kortex_role", "") in {"open", "admin"} else "viewer")
        return items


@app.post("/api/search")
async def global_search(payload: GlobalSearchRequest, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        project = _assert_project_access(conn, request, payload.project_id, "viewer") if payload.project_id else None
        allowed_project_ids = _accessible_project_ids(conn, request) if not payload.project_id else None
    settings = _project_rag_settings(project, payload.top_k)
    settings["retrieval_mode"] = payload.retrieval_mode
    settings["retrieval_scope"] = payload.retrieval_scope
    settings["similarity_threshold"] = payload.similarity_threshold
    if payload.metadata_filter:
        settings["metadata_filter"] = payload.metadata_filter
    vectors, _ = await _vectors_for_chunks([payload.query], settings["embedding_model_id"])
    retrieval_start = time.perf_counter()
    contexts = retrieve_context(
        query=payload.query,
        project_id=payload.project_id,
        allowed_project_ids=allowed_project_ids,
        top_k=settings["top_k"],
        mode=settings["retrieval_mode"],
        similarity_threshold=settings["similarity_threshold"],
        query_vector=vectors[0] if vectors else None,
        metadata_filter=settings["metadata_filter"],
        scope=settings["retrieval_scope"],
        full_context_limit=settings["full_context_limit"],
    )
    retrieval_ms = int((time.perf_counter() - retrieval_start) * 1000)
    return {
        "query": payload.query,
        "project_id": payload.project_id,
        "retrieval_ms": retrieval_ms,
        "items": build_citations(contexts),
    }


@app.post("/api/projects")
def create_project(payload: ProjectCreate, request: Request) -> dict[str, Any]:
    if not _can_write_projects(request):
        raise HTTPException(status_code=403, detail="You do not have permission to create projects")
    now = now_iso()
    try:
        with get_conn() as conn:
            cursor = conn.execute(
                "INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (payload.name.strip(), payload.description.strip(), now, now),
            )
            user = getattr(request.state, "kortex_user", None)
            if user and int(user.get("id") or 0) > 0:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at, updated_at)
                    VALUES (?, ?, 'owner', ?, ?)
                    """,
                    (int(cursor.lastrowid), int(user["id"]), now, now),
                )
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return row_to_dict(row) or {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/projects/{project_id}/settings")
def update_project_settings(project_id: int, payload: ProjectSettingsPatch, request: Request) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    if "chunk_overlap" in updates and "chunk_size" in updates and updates["chunk_overlap"] >= updates["chunk_size"]:
        raise HTTPException(status_code=400, detail="Chunk overlap must be smaller than chunk size")
    if "metadata_filter_json" in updates:
        try:
            parsed = json.loads(updates["metadata_filter_json"] or "{}")
            if not isinstance(parsed, dict):
                raise ValueError("metadata filter must be an object")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid metadata filter JSON: {exc}") from exc

    updates["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = [int(value) if isinstance(value, bool) else value for value in updates.values()]
    with get_conn() as conn:
        project = _assert_project_access(conn, request, project_id, "editor")
        if "chunk_overlap" in updates and "chunk_size" not in updates and updates["chunk_overlap"] >= project["chunk_size"]:
            raise HTTPException(status_code=400, detail="Chunk overlap must be smaller than chunk size")
        conn.execute(f"UPDATE projects SET {assignments} WHERE id = ?", [*values, project_id])
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return row_to_dict(row) or {}


@app.get("/api/documents")
def list_documents(request: Request, project_id: int | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if project_id:
            _assert_project_access(conn, request, project_id, "viewer")
        if project_id:
            rows = conn.execute(
                """
                SELECT documents.*, projects.name AS project_name
                FROM documents
                JOIN projects ON projects.id = documents.project_id
                WHERE project_id = ?
                ORDER BY documents.created_at DESC
                """,
                (project_id,),
            ).fetchall()
        else:
            filter_sql = ""
            params: list[Any] = []
            accessible_ids = _accessible_project_ids(conn, request)
            filter_sql, params = _project_filter_sql(accessible_ids, "documents.project_id")
            rows = conn.execute(
                f"""
                SELECT documents.*, projects.name AS project_name
                FROM documents
                JOIN projects ON projects.id = documents.project_id
                {filter_sql}
                ORDER BY documents.created_at DESC
                """,
                tuple(params),
            ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/documents/tree")
def document_tree(request: Request, project_id: int = 1) -> dict[str, Any]:
    with get_conn() as conn:
        _assert_project_access(conn, request, project_id, "viewer")
        documents = rows_to_dicts(
            conn.execute(
                """
                SELECT id, title, filename, chunk_count, size, status, created_at
                FROM documents
                WHERE project_id = ?
                ORDER BY filename ASC
                """,
                (project_id,),
            ).fetchall()
        )

    root: dict[str, Any] = {"name": "/", "path": "", "type": "folder", "children": []}
    folder_index: dict[str, dict[str, Any]] = {"": root}
    for document in documents:
        parts = [part for part in document["filename"].replace("\\", "/").split("/") if part]
        current_path = ""
        parent = root
        for folder in parts[:-1]:
            current_path = f"{current_path}/{folder}".strip("/")
            if current_path not in folder_index:
                node = {"name": folder, "path": current_path, "type": "folder", "children": []}
                folder_index[current_path] = node
                parent["children"].append(node)
            parent = folder_index[current_path]
        parent["children"].append(
            {
                "name": parts[-1] if parts else document["filename"],
                "path": document["filename"],
                "type": "file",
                "document": document,
            }
        )
    return root


@app.get("/api/documents/{document_id}")
def get_document(document_id: int, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        document = row_to_dict(
            conn.execute(
                """
                SELECT documents.*, projects.name AS project_name
                FROM documents
                JOIN projects ON projects.id = documents.project_id
                WHERE documents.id = ?
                """,
                (document_id,),
            ).fetchone()
        )
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        _assert_project_access(conn, request, int(document["project_id"]), "viewer")
        chunks = rows_to_dicts(
            conn.execute(
                """
                SELECT id, chunk_index, content, char_count, section_path, start_char, end_char, vector_model_id, metadata_json, created_at
                FROM chunks
                WHERE document_id = ?
                ORDER BY chunk_index ASC
                """,
                (document_id,),
            ).fetchall()
        )
    document["metadata"] = _json_dict(document.get("metadata_json"))
    for chunk in chunks:
        chunk["metadata"] = _json_dict(chunk.pop("metadata_json", "{}"))
    document["chunks"] = chunks
    document["preview"] = "\n\n".join(chunk["content"] for chunk in chunks[:3])[:3000]
    return document


@app.get("/api/import-jobs")
def list_import_jobs(request: Request, project_id: int | None = None, limit: int = 20) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 100))
    params: tuple[Any, ...]
    where = ""
    if project_id:
        with get_conn() as conn:
            _assert_project_access(conn, request, project_id, "viewer")
        where = "WHERE import_jobs.project_id = ?"
        params = (project_id, limit)
    else:
        with get_conn() as conn:
            accessible_ids = _accessible_project_ids(conn, request)
        where, project_params = _project_filter_sql(accessible_ids, "import_jobs.project_id")
        params = (*project_params, limit)
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT import_jobs.*, projects.name AS project_name
                FROM import_jobs
                JOIN projects ON projects.id = import_jobs.project_id
                {where}
                ORDER BY import_jobs.started_at DESC, import_jobs.id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        )
    for row in rows:
        row["uploaded"] = [_normalize_import_item(item, "indexed") for item in json.loads(row.pop("uploaded_json") or "[]")]
        row["skipped"] = [
            _normalize_import_item(item, _classify_import_reason(item.get("reason")))
            for item in json.loads(row.pop("skipped_json") or "[]")
        ]
        row["results"] = [*row["uploaded"], *row["skipped"]]
        row["summary"] = _build_import_summary(row["results"])
        row.update(_repair_payload(row))
    return rows


@app.get("/api/sync-sources")
def get_sync_sources(request: Request, project_id: int | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
        if project_id:
            _assert_project_access(conn, request, project_id, "viewer")
        accessible_ids = _accessible_project_ids(conn, request) if not project_id else None
    items = list_sync_sources(project_id)
    if accessible_ids is None or project_id:
        return items
    allowed = set(accessible_ids)
    return [item for item in items if int(item.get("project_id") or 0) in allowed]


@app.post("/api/sync-sources")
def create_sync_source(payload: SyncSourceIn, request: Request) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        _assert_project_access(conn, request, payload.project_id, "editor")
        cursor = conn.execute(
            """
            INSERT INTO sync_sources
            (project_id, name, source_path, enabled, poll_interval_seconds, include_globs, exclude_globs, delete_missing, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.project_id,
                payload.name.strip(),
                str(Path(payload.source_path).expanduser()),
                int(payload.enabled),
                payload.poll_interval_seconds,
                payload.include_globs.strip(),
                payload.exclude_globs.strip(),
                int(payload.delete_missing),
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM sync_sources WHERE id = ?", (cursor.lastrowid,)).fetchone()
    _log_event("info", "sync", "Folder sync source created", {"sync_source_id": cursor.lastrowid, "project_id": payload.project_id})
    return _serialize_sync_source(row_to_dict(row) or {})


@app.patch("/api/sync-sources/{source_id}")
def patch_sync_source(source_id: int, payload: SyncSourcePatch, request: Request) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    if "source_path" in updates and updates["source_path"] is not None:
        updates["source_path"] = str(Path(updates["source_path"]).expanduser())
    updates["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = [int(value) if isinstance(value, bool) else value for value in updates.values()]
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sync_sources WHERE id = ?", (source_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Sync source not found")
        _assert_project_access(conn, request, int(row["project_id"]), "editor")
        conn.execute(f"UPDATE sync_sources SET {assignments} WHERE id = ?", [*values, source_id])
        updated = row_to_dict(conn.execute("SELECT * FROM sync_sources WHERE id = ?", (source_id,)).fetchone())
    _log_event("info", "sync", "Folder sync source updated", {"sync_source_id": source_id})
    return _serialize_sync_source(updated or {})


@app.delete("/api/sync-sources/{source_id}")
def delete_sync_source(source_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        row = row_to_dict(conn.execute("SELECT * FROM sync_sources WHERE id = ?", (source_id,)).fetchone())
        if row is None:
            raise HTTPException(status_code=404, detail="Sync source not found")
        _assert_project_access(conn, request, int(row["project_id"]), "editor")
        conn.execute("DELETE FROM sync_sources WHERE id = ?", (source_id,))
    _log_event("warning", "sync", "Folder sync source deleted", {"sync_source_id": source_id, "source_path": row.get("source_path")})
    return {"ok": True}


@app.post("/api/sync-sources/{source_id}/scan")
async def run_sync_source_scan(source_id: int, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        row = row_to_dict(conn.execute("SELECT * FROM sync_sources WHERE id = ?", (source_id,)).fetchone())
        if row is None:
            raise HTTPException(status_code=404, detail="Sync source not found")
        _assert_project_access(conn, request, int(row["project_id"]), "editor")
    return await _scan_sync_source(source_id)


async def _index_saved_file(
    target_path: Path,
    display_name: str,
    project_id: int,
    project: dict[str, Any],
    content_type: str = "",
    metadata_patch: dict[str, Any] | None = None,
    replace_document_id: int | None = None,
    force_new: bool = False,
) -> dict[str, Any]:
    rag_settings = _project_rag_settings(project)
    try:
        text = extract_text(target_path, display_name)
    except Exception as exc:
        raise ValueError(f"could not be parsed: {str(exc)[:160]}") from exc

    detailed_chunks = split_text_detailed(text, max_chars=rag_settings["chunk_size"], overlap=rag_settings["chunk_overlap"])
    if not detailed_chunks:
        raise ValueError("no readable text")

    checksum = _checksum_file(target_path)
    metadata = infer_metadata(display_name, content_type)
    metadata["checksum"] = checksum
    metadata["parser"] = "basic"
    metadata_json = _merge_metadata(metadata, metadata_patch)
    vectors, vector_model_id = await _vectors_for_chunks([chunk["content"] for chunk in detailed_chunks], rag_settings["embedding_model_id"])
    now = now_iso()
    qdrant_delete_ids: list[int] = []

    with get_conn() as conn:
        duplicate = conn.execute(
            "SELECT id, version FROM documents WHERE project_id = ? AND checksum = ? ORDER BY version DESC, id DESC LIMIT 1",
            (project_id, checksum),
        ).fetchone()
        if duplicate is not None and replace_document_id is None and not force_new:
            return {
                "document_id": duplicate["id"],
                "filename": display_name,
                "chunks": 0,
                "duplicate": True,
                "reason": "duplicate content already indexed",
            }

        if replace_document_id:
            existing = conn.execute("SELECT * FROM documents WHERE id = ?", (replace_document_id,)).fetchone()
            if existing is None:
                raise ValueError("document not found")
            version = int(existing["version"] or 1) + 1
            qdrant_delete_ids = [row["id"] for row in conn.execute("SELECT id FROM chunks WHERE document_id = ?", (replace_document_id,)).fetchall()]
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (replace_document_id,))
            conn.execute(
                """
                UPDATE documents
                SET title = ?, filename = ?, content_type = ?, size = ?, path = ?, status = 'ready',
                    chunk_count = ?, checksum = ?, version = ?, metadata_json = ?, updated_at = ?, last_indexed_at = ?
                WHERE id = ?
                """,
                (
                    Path(display_name).stem,
                    display_name,
                    content_type,
                    target_path.stat().st_size,
                    str(target_path),
                    len(detailed_chunks),
                    checksum,
                    version,
                    metadata_json,
                    now,
                    now,
                    replace_document_id,
                ),
            )
            document_id = replace_document_id
        else:
            parent_document_id = duplicate["id"] if duplicate is not None else None
            version = int(duplicate["version"] or 1) + 1 if duplicate is not None else 1
            cursor = conn.execute(
                """
                INSERT INTO documents
                (project_id, title, filename, content_type, size, path, status, chunk_count,
                 checksum, version, parent_document_id, metadata_json, created_at, updated_at, last_indexed_at)
                VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    Path(display_name).stem,
                    display_name,
                    content_type,
                    target_path.stat().st_size,
                    str(target_path),
                    len(detailed_chunks),
                    checksum,
                    version,
                    parent_document_id,
                    metadata_json,
                    now,
                    now,
                    now,
                ),
            )
            document_id = cursor.lastrowid

        qdrant_points: list[dict[str, Any]] = []
        for index, chunk in enumerate(detailed_chunks):
            cursor = conn.execute(
                """
                INSERT INTO chunks
                (document_id, project_id, chunk_index, content, vector_json, char_count,
                 parent_chunk_id, section_path, start_char, end_char, vector_model_id, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    project_id,
                    chunk["chunk_index"],
                    chunk["content"],
                    dumps_vector(vectors[index]),
                    chunk["char_count"],
                    None,
                    chunk["section_path"],
                    chunk["start_char"],
                    chunk["end_char"],
                    vector_model_id,
                    metadata_json,
                    now,
                ),
            )
            qdrant_points.append(
                {
                    "id": cursor.lastrowid,
                    "vector": vectors[index],
                    "payload": {
                        "document_id": document_id,
                        "project_id": project_id,
                        "filename": display_name,
                        "title": Path(display_name).stem,
                        "chunk_index": chunk["chunk_index"],
                        "section_path": chunk["section_path"],
                        "checksum": checksum,
                        "vector_model_id": vector_model_id,
                    },
                }
            )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    try:
        await delete_qdrant_points(qdrant_delete_ids)
    except Exception as exc:
        _log_event("warning", "qdrant", "Qdrant delete before reindex failed", {"error": str(exc)[:300], "document_id": document_id})
    try:
        await upsert_qdrant_points(qdrant_points)
    except Exception as exc:
        _log_event("warning", "qdrant", "Qdrant upsert failed; SQLite vector fallback remains available", {"error": str(exc)[:300], "document_id": document_id})
    return {"document_id": document_id, "filename": display_name, "chunks": len(detailed_chunks), "duplicate": False}


def _preview_saved_file(target_path: Path, display_name: str, project: dict[str, Any], content_type: str = "") -> dict[str, Any]:
    rag_settings = _project_rag_settings(project)
    text = extract_text(target_path, display_name)
    chunks = split_text_detailed(text, max_chars=rag_settings["chunk_size"], overlap=rag_settings["chunk_overlap"])
    checksum = _checksum_file(target_path)
    duplicate_id = None
    duplicate_filename = ""
    last_indexed_at = ""
    with get_conn() as conn:
        duplicate = conn.execute(
            "SELECT id, filename, last_indexed_at FROM documents WHERE project_id = ? AND checksum = ? ORDER BY id DESC LIMIT 1",
            (project["id"], checksum),
        ).fetchone()
        duplicate_id = duplicate["id"] if duplicate else None
        duplicate_filename = duplicate["filename"] if duplicate else ""
        last_indexed_at = duplicate["last_indexed_at"] if duplicate else ""
    return {
        "filename": display_name,
        "checksum": checksum,
        "duplicate_document_id": duplicate_id,
        "duplicate_filename": duplicate_filename,
        "last_indexed_at": last_indexed_at,
        "chunk_count": len(chunks),
        "metadata": infer_metadata(display_name, content_type),
        "chunks": [
            {
                "chunk_index": chunk["chunk_index"],
                "section_path": chunk["section_path"],
                "char_count": chunk["char_count"],
                "content": chunk["content"][:1000],
            }
            for chunk in chunks[:8]
        ],
    }


@app.post("/api/documents/preview")
async def preview_documents(
    request: Request,
    files: list[UploadFile] = File(...),
    project_id: int = Form(1),
) -> dict[str, Any]:
    with get_conn() as conn:
        project = _assert_project_access(conn, request, project_id, "editor")
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    previews = []
    skipped: list[dict[str, Any]] = []
    timestamp = now_iso().replace(":", "-").replace(".", "-")
    for upload in files[:10]:
        relative_name = _safe_relative_name(upload.filename)
        target_path = UPLOAD_DIR / f"preview_{timestamp}_{_storage_name(relative_name)}"
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)
        try:
            if target_path.suffix.lower() == ".zip":
                with zipfile.ZipFile(target_path) as archive:
                    for member in archive.infolist()[:20]:
                        member_name = _safe_relative_name(member.filename)
                        skip_reason = "skipped because it is a folder" if member.is_dir() else _skip_upload_reason(member_name, member.file_size)
                        if skip_reason:
                            skipped.append({"filename": member_name, "reason": skip_reason, "status": _classify_import_reason(skip_reason)})
                            continue
                        extracted_name = _safe_relative_name(f"{Path(relative_name).stem}/{member_name}")
                        extracted_path = UPLOAD_DIR / f"preview_{timestamp}_{_storage_name(extracted_name)}"
                        extracted_path.write_bytes(archive.read(member))
                        try:
                            previews.append(_preview_saved_file(extracted_path, extracted_name, project, upload.content_type or ""))
                        except Exception as exc:
                            reason = str(exc)[:180]
                            skipped.append({"filename": extracted_name, "reason": reason, "status": _classify_import_reason(reason)})
                        finally:
                            extracted_path.unlink(missing_ok=True)
                continue
            skip_reason = _skip_upload_reason(relative_name, target_path.stat().st_size)
            if skip_reason:
                skipped.append({"filename": relative_name, "reason": skip_reason, "status": _classify_import_reason(skip_reason)})
                continue
            previews.append(_preview_saved_file(target_path, relative_name, project, upload.content_type or ""))
        except Exception as exc:
            reason = str(exc)[:180]
            skipped.append({"filename": relative_name, "reason": reason, "status": _classify_import_reason(reason)})
        finally:
            target_path.unlink(missing_ok=True)
    preview_results = [
        {
            "filename": item["filename"],
            "status": "duplicate" if item.get("duplicate_document_id") else "indexed",
            "chunks": item.get("chunk_count", 0),
            "duplicate_document_id": item.get("duplicate_document_id"),
            "duplicate_filename": item.get("duplicate_filename", ""),
            "last_indexed_at": item.get("last_indexed_at", ""),
        }
        for item in previews
    ]
    preview_results.extend(skipped)
    return {"items": previews, "skipped": skipped, "summary": _build_import_summary(preview_results)}


@app.post("/api/documents/upload")
async def upload_documents(
    request: Request,
    files: list[UploadFile] = File(...),
    project_id: int = Form(1),
) -> dict[str, Any]:
    uploaded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    source_names: list[str] = []
    handled_files = 0
    with get_conn() as conn:
        project = _assert_project_access(conn, request, project_id, "editor")
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    started_at = now_iso()

    for upload in files:
        relative_name = _safe_relative_name(upload.filename)
        source_names.append(relative_name)
        timestamp = now_iso().replace(":", "-").replace(".", "-")
        target_path = UPLOAD_DIR / f"{timestamp}_{_storage_name(relative_name)}"
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        if target_path.suffix.lower() == ".zip":
            try:
                with zipfile.ZipFile(target_path) as archive:
                    for member in archive.infolist():
                        member_name = _safe_relative_name(member.filename)
                        skip_reason = "skipped because it is a folder" if member.is_dir() else _skip_upload_reason(member_name, member.file_size)
                        if skip_reason:
                            item = {"filename": member_name, "reason": skip_reason, "status": _classify_import_reason(skip_reason)}
                            skipped.append(item)
                            results.append(item)
                            handled_files += 1
                            continue
                        extracted_name = _safe_relative_name(f"{Path(relative_name).stem}/{member_name}")
                        extracted_path = UPLOAD_DIR / f"{timestamp}_{_storage_name(extracted_name)}"
                        try:
                            extracted_path.write_bytes(archive.read(member))
                        except Exception as exc:
                            reason = f"could not be extracted: {str(exc)[:160]}"
                            item = {"filename": extracted_name, "reason": reason, "status": "failed"}
                            skipped.append(item)
                            results.append(item)
                            handled_files += 1
                            continue
                        try:
                            result = await _index_saved_file(extracted_path, extracted_name, project_id, project, upload.content_type or "")
                            if result.get("duplicate"):
                                item = {
                                    "filename": extracted_name,
                                    "reason": result.get("reason", "duplicate"),
                                    "status": "duplicate",
                                    "duplicate_document_id": result.get("document_id"),
                                }
                                skipped.append(item)
                                results.append(item)
                            else:
                                item = {**result, "status": "indexed"}
                                uploaded.append(item)
                                results.append(item)
                            handled_files += 1
                        except ValueError as exc:
                            reason = str(exc)[:180]
                            item = {"filename": extracted_name, "reason": reason, "status": "failed"}
                            skipped.append(item)
                            results.append(item)
                            handled_files += 1
            except zipfile.BadZipFile as exc:
                item = {"filename": relative_name, "reason": "bad zip file", "status": "failed"}
                skipped.append(item)
                results.append(item)
                handled_files += 1
                target_path.unlink(missing_ok=True)
                if not uploaded:
                    raise HTTPException(status_code=400, detail=f"{relative_name} is not a valid zip file") from exc
            target_path.unlink(missing_ok=True)
            continue

        skip_reason = _skip_upload_reason(relative_name, target_path.stat().st_size)
        if skip_reason:
            item = {"filename": relative_name, "reason": skip_reason, "status": _classify_import_reason(skip_reason)}
            skipped.append(item)
            results.append(item)
            handled_files += 1
            target_path.unlink(missing_ok=True)
            continue

        try:
            result = await _index_saved_file(target_path, relative_name, project_id, project, upload.content_type or "")
            if result.get("duplicate"):
                item = {
                    "filename": relative_name,
                    "reason": result.get("reason", "duplicate"),
                    "status": "duplicate",
                    "duplicate_document_id": result.get("document_id"),
                }
                skipped.append(item)
                results.append(item)
                target_path.unlink(missing_ok=True)
            else:
                item = {**result, "status": "indexed"}
                uploaded.append(item)
                results.append(item)
            handled_files += 1
        except ValueError as exc:
            reason = str(exc)[:180]
            item = {"filename": relative_name, "reason": reason, "status": "failed"}
            skipped.append(item)
            results.append(item)
            handled_files += 1

    finished_at = now_iso()
    source_name = ", ".join(source_names[:3]) + ("..." if len(source_names) > 3 else "")
    summary = _build_import_summary(results)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO import_jobs
            (project_id, status, source_name, total_files, indexed_files, skipped_files, failed_files,
             uploaded_json, skipped_json, error, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                "failed" if not uploaded and skipped else "completed",
                source_name,
                handled_files or len(source_names),
                summary["indexed_files"],
                summary["duplicate_files"] + summary["skipped_files"],
                summary["failed_files"],
                json.dumps(uploaded, ensure_ascii=False),
                json.dumps(skipped, ensure_ascii=False),
                "" if uploaded else (skipped[0]["reason"] if skipped else ""),
                started_at,
                finished_at,
            ),
        )

    if not uploaded and skipped:
        raise HTTPException(status_code=400, detail=f"No readable documents were indexed. First skipped item: {skipped[0]['filename']} ({skipped[0]['reason']})")

    return {"uploaded": uploaded, "skipped": skipped, "results": results, "summary": summary}


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        document = row_to_dict(conn.execute("SELECT id, project_id FROM documents WHERE id = ?", (document_id,)).fetchone())
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        _assert_project_access(conn, request, int(document["project_id"]), "editor")
    return _delete_document_record(document_id)


@app.post("/api/documents/batch-delete")
def batch_delete_documents(payload: BatchDeleteRequest, request: Request) -> dict[str, Any]:
    deleted = 0
    failed: list[dict[str, Any]] = []
    for document_id in payload.document_ids:
        try:
            delete_document(document_id, request)
            deleted += 1
        except Exception as exc:
            failed.append({"document_id": document_id, "reason": str(exc)[:180]})
    return {"deleted": deleted, "failed": failed}


@app.patch("/api/documents/{document_id}/metadata")
def patch_document_metadata(document_id: int, payload: DocumentMetadataPatch, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        document = row_to_dict(conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone())
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        _assert_project_access(conn, request, int(document["project_id"]), "editor")
        metadata = _json_dict(document.get("metadata_json"))
        if payload.metadata is not None:
            metadata.update(payload.metadata)
        updates: dict[str, Any] = {
            "metadata_json": json.dumps(metadata, ensure_ascii=False, sort_keys=True),
            "updated_at": now_iso(),
        }
        if payload.title is not None and payload.title.strip():
            updates["title"] = payload.title.strip()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        conn.execute(f"UPDATE documents SET {assignments} WHERE id = ?", [*updates.values(), document_id])
    return get_document(document_id, request)


@app.post("/api/documents/{document_id}/reindex")
async def reindex_document(document_id: int, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        document = row_to_dict(conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone())
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        _assert_project_access(conn, request, int(document["project_id"]), "editor")
        project = row_to_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (document["project_id"],)).fetchone())
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    path = Path(document["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Original file is missing; upload it again to rebuild this document")
    try:
        result = await _index_saved_file(
            path,
            document["filename"],
            document["project_id"],
            project,
            document.get("content_type") or "",
            _json_dict(document.get("metadata_json")),
            replace_document_id=document_id,
        )
        with get_conn() as conn:
            conn.execute(
                """
                INSERT INTO import_jobs
                (project_id, status, source_name, total_files, indexed_files, skipped_files, failed_files,
                 uploaded_json, skipped_json, error, started_at, finished_at)
                VALUES (?, 'completed', ?, 1, 1, 0, 0, ?, '[]', '', ?, ?)
                """,
                (document["project_id"], document["filename"], json.dumps([result], ensure_ascii=False), now_iso(), now_iso()),
            )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/import-jobs/{job_id}/retry")
async def retry_import_job(job_id: int, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        job = row_to_dict(conn.execute("SELECT * FROM import_jobs WHERE id = ?", (job_id,)).fetchone())
        if job is None:
            raise HTTPException(status_code=404, detail="Import job not found")
        _assert_project_access(conn, request, int(job["project_id"]), "editor")
        uploaded = json.loads(job.get("uploaded_json") or "[]")
    if not uploaded:
        raise HTTPException(status_code=400, detail="This job has no retained source documents to retry. Upload the original files again.")
    results = []
    for item in uploaded:
        results.append(await reindex_document(int(item["document_id"]), request))
    return {"retried": len(results), "items": results, "summary": _build_import_summary([{**item, "status": "indexed"} for item in results])}


def _public_model(row: dict[str, Any]) -> dict[str, Any]:
    public = dict(row)
    public["enabled"] = bool(public["enabled"])
    public["is_default"] = bool(public["is_default"])
    public["supports_tools"] = _row_bool(public, "supports_tools")
    public["supports_vision"] = _row_bool(public, "supports_vision")
    public["api_key_set"] = bool(public.get("api_key"))
    public["api_key"] = ""
    return public


def _private_model(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    private = dict(row)
    private["api_key"] = decrypt_secret(private.get("api_key") or "")
    return private


def _validate_json_text(value: str, expected_type: type, label: str) -> str:
    try:
        parsed = json.loads(value or ("[]" if expected_type is list else "{}"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {label}: {exc}") from exc
    if not isinstance(parsed, expected_type):
        raise HTTPException(status_code=400, detail=f"Invalid {label}: expected {expected_type.__name__}")
    return json.dumps(parsed, ensure_ascii=False, sort_keys=True)


def _public_preset(row: dict[str, Any]) -> dict[str, Any]:
    preset = dict(row)
    preset["use_query_rewrite"] = bool(preset.get("use_query_rewrite"))
    preset["use_rerank"] = bool(preset.get("use_rerank"))
    preset["is_default"] = bool(preset.get("is_default"))
    preset["metadata_filter"] = _json_dict(preset.get("metadata_filter_json"))
    try:
        preset["tools"] = json.loads(preset.get("tools_json") or "[]")
    except (TypeError, ValueError):
        preset["tools"] = []
    return preset


def _load_model_preset(preset_id: int | None) -> dict[str, Any] | None:
    with get_conn() as conn:
        if preset_id:
            return row_to_dict(conn.execute("SELECT * FROM model_presets WHERE id = ?", (preset_id,)).fetchone())
        return row_to_dict(conn.execute("SELECT * FROM model_presets WHERE is_default = 1 ORDER BY id ASC LIMIT 1").fetchone())


def _apply_preset_to_chat(payload: ChatRequest, preset: dict[str, Any] | None) -> ChatRequest:
    if preset is None:
        return payload
    preset_filter = _json_dict(preset.get("metadata_filter_json"))
    merged_filter = {**preset_filter, **(payload.metadata_filter or {})}
    return ChatRequest(
        message=payload.message,
        project_id=preset.get("project_id") or payload.project_id,
        model_id=preset.get("model_id") or payload.model_id,
        preset_id=preset.get("id"),
        conversation_id=payload.conversation_id,
        top_k=payload.top_k or int(preset.get("top_k") or 5),
        retrieval_mode=payload.retrieval_mode or preset.get("retrieval_mode") or "hybrid",
        retrieval_scope=payload.retrieval_scope or preset.get("retrieval_scope") or "focused",
        similarity_threshold=payload.similarity_threshold if payload.similarity_threshold is not None else float(preset.get("similarity_threshold") or 0),
        use_query_rewrite=payload.use_query_rewrite if payload.use_query_rewrite is not None else bool(preset.get("use_query_rewrite")),
        use_rerank=payload.use_rerank if payload.use_rerank is not None else bool(preset.get("use_rerank")),
        metadata_filter=merged_filter or None,
    )


def _messages_with_preset(messages: list[dict[str, str]], preset: dict[str, Any] | None) -> list[dict[str, str]]:
    system_prompt = (preset or {}).get("system_prompt") or ""
    if not system_prompt.strip():
        return messages
    merged = [dict(message) for message in messages]
    for message in merged:
        if message["role"] == "system":
            message["content"] = f"{system_prompt.strip()}\n\n{message['content']}"
            return merged
    return [{"role": "system", "content": system_prompt.strip()}, *merged]


def _model_snapshot(model: dict[str, Any], preset: dict[str, Any] | None = None) -> str:
    return json.dumps(
        {
            "model_id": model.get("id"),
            "name": model.get("name"),
            "provider": model.get("provider"),
            "model": model.get("model"),
            "base_url": model.get("base_url"),
            "temperature": model.get("temperature"),
            "preset_id": (preset or {}).get("id"),
            "preset_name": (preset or {}).get("name"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


@app.get("/api/models")
def list_models() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = rows_to_dicts(conn.execute("SELECT * FROM model_configs ORDER BY is_default DESC, id ASC").fetchall())
    return [_public_model(row) for row in rows]


@app.get("/api/model-presets")
def list_model_presets(request: Request) -> list[dict[str, Any]]:
    with get_conn() as conn:
        where_sql = ""
        params: list[Any] = []
        accessible_ids = _accessible_project_ids(conn, request)
        if accessible_ids is not None:
            if accessible_ids:
                placeholders = ",".join("?" for _ in accessible_ids)
                where_sql = f"WHERE model_presets.project_id IS NULL OR model_presets.project_id IN ({placeholders})"
                params = [*accessible_ids]
            else:
                where_sql = "WHERE model_presets.project_id IS NULL"
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT model_presets.*,
                       projects.name AS project_name,
                       model_configs.name AS model_name,
                       model_configs.provider AS model_provider,
                       model_configs.model AS model_model
                FROM model_presets
                LEFT JOIN projects ON projects.id = model_presets.project_id
                LEFT JOIN model_configs ON model_configs.id = model_presets.model_id
                {where_sql}
                ORDER BY model_presets.is_default DESC, model_presets.updated_at DESC, model_presets.id DESC
                """,
                tuple(params),
            ).fetchall()
        )
    return [_public_preset(row) for row in rows]


@app.post("/api/model-presets")
def create_model_preset(payload: ModelPresetIn, request: Request) -> dict[str, Any]:
    metadata_filter_json = _validate_json_text(payload.metadata_filter_json, dict, "metadata filter JSON")
    tools_json = _validate_json_text(payload.tools_json, list, "tools JSON")
    now = now_iso()
    with get_conn() as conn:
        if payload.project_id:
            _assert_project_access(conn, request, payload.project_id, "viewer")
        if payload.is_default:
            conn.execute("UPDATE model_presets SET is_default = 0")
        cursor = conn.execute(
            """
            INSERT INTO model_presets
            (name, description, project_id, model_id, system_prompt, temperature, retrieval_scope,
             retrieval_mode, top_k, similarity_threshold, use_query_rewrite, use_rerank,
             metadata_filter_json, tools_json, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name.strip(),
                payload.description.strip(),
                payload.project_id,
                payload.model_id,
                payload.system_prompt.strip(),
                payload.temperature,
                payload.retrieval_scope,
                payload.retrieval_mode,
                payload.top_k,
                payload.similarity_threshold,
                int(payload.use_query_rewrite),
                int(payload.use_rerank),
                metadata_filter_json,
                tools_json,
                int(payload.is_default),
                now,
                now,
            ),
        )
        row = row_to_dict(conn.execute("SELECT * FROM model_presets WHERE id = ?", (cursor.lastrowid,)).fetchone()) or {}
    return _public_preset(row)


@app.patch("/api/model-presets/{preset_id}")
def patch_model_preset(preset_id: int, payload: ModelPresetPatch, request: Request) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    if "metadata_filter_json" in updates:
        updates["metadata_filter_json"] = _validate_json_text(str(updates["metadata_filter_json"]), dict, "metadata filter JSON")
    if "tools_json" in updates:
        updates["tools_json"] = _validate_json_text(str(updates["tools_json"]), list, "tools JSON")
    updates["updated_at"] = now_iso()
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM model_presets WHERE id = ?", (preset_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Preset not found")
        if existing["project_id"]:
            _assert_project_access(conn, request, int(existing["project_id"]), "viewer")
        if updates.get("project_id"):
            _assert_project_access(conn, request, int(updates["project_id"]), "viewer")
        if updates.get("is_default"):
            conn.execute("UPDATE model_presets SET is_default = 0")
        assignments = ", ".join(f"{key} = ?" for key in updates)
        values = [int(value) if isinstance(value, bool) else value for value in updates.values()]
        conn.execute(f"UPDATE model_presets SET {assignments} WHERE id = ?", [*values, preset_id])
        row = row_to_dict(conn.execute("SELECT * FROM model_presets WHERE id = ?", (preset_id,)).fetchone()) or {}
    return _public_preset(row)


@app.delete("/api/model-presets/{preset_id}")
def delete_model_preset(preset_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        existing = row_to_dict(conn.execute("SELECT * FROM model_presets WHERE id = ?", (preset_id,)).fetchone())
        if existing is None:
            raise HTTPException(status_code=404, detail="Preset not found")
        if existing.get("project_id"):
            _assert_project_access(conn, request, int(existing["project_id"]), "viewer")
        conn.execute("DELETE FROM model_presets WHERE id = ?", (preset_id,))
    return {"ok": True}


@app.post("/api/models/discover")
async def discover_model_options(payload: ModelDiscoveryRequest) -> dict[str, Any]:
    try:
        models = await discover_models(payload.provider, payload.base_url, payload.api_key)
    except ModelDiscoveryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:600]) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Model discovery failed: {str(exc)[:600]}") from exc
    return {"models": models}


@app.post("/api/models")
def create_model(payload: ModelConfigIn) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        existing = conn.execute(
            """
            SELECT * FROM model_configs
            WHERE provider = ? AND base_url = ? AND model = ?
            ORDER BY id ASC
            LIMIT 1
            """,
            (payload.provider, payload.base_url, payload.model),
        ).fetchone()
        if payload.is_default:
            conn.execute("UPDATE model_configs SET is_default = 0")
        if existing is not None:
            updates = {
                "name": payload.name,
                "temperature": payload.temperature,
                "model_type": payload.model_type,
                "context_window": payload.context_window,
                "supports_tools": int(payload.supports_tools),
                "supports_vision": int(payload.supports_vision),
                "enabled": int(payload.enabled),
                "is_default": int(payload.is_default),
                "updated_at": now,
            }
            if payload.api_key:
                updates["api_key"] = encrypt_secret(payload.api_key)
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(f"UPDATE model_configs SET {assignments} WHERE id = ?", [*updates.values(), existing["id"]])
            row = row_to_dict(conn.execute("SELECT * FROM model_configs WHERE id = ?", (existing["id"],)).fetchone()) or {}
            return _public_model(row)
        cursor = conn.execute(
            """
            INSERT INTO model_configs
            (name, provider, model, base_url, api_key, temperature, model_type, context_window,
             supports_tools, supports_vision, enabled, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.provider,
                payload.model,
                payload.base_url,
                encrypt_secret(payload.api_key),
                payload.temperature,
                payload.model_type,
                payload.context_window,
                int(payload.supports_tools),
                int(payload.supports_vision),
                int(payload.enabled),
                int(payload.is_default),
                now,
                now,
            ),
        )
        row = row_to_dict(conn.execute("SELECT * FROM model_configs WHERE id = ?", (cursor.lastrowid,)).fetchone()) or {}
        return _public_model(row)


@app.patch("/api/models/{model_id}")
def patch_model(model_id: int, payload: ModelConfigPatch) -> dict[str, Any]:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM model_configs WHERE id = ?", (model_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Model not found")
        if updates.get("is_default"):
            conn.execute("UPDATE model_configs SET is_default = 0")
        if updates.get("api_key") == "":
            updates.pop("api_key")
        elif updates.get("api_key"):
            updates["api_key"] = encrypt_secret(str(updates["api_key"]))
        updates["updated_at"] = now_iso()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        values = [int(value) if isinstance(value, bool) else value for value in updates.values()]
        conn.execute(f"UPDATE model_configs SET {assignments} WHERE id = ?", [*values, model_id])
        row = row_to_dict(conn.execute("SELECT * FROM model_configs WHERE id = ?", (model_id,)).fetchone()) or {}
        return _public_model(row)


@app.delete("/api/models/{model_id}")
def delete_model(model_id: int) -> dict[str, bool]:
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM model_configs WHERE id = ?", (model_id,)).fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="Model not found")
        was_default = bool(existing["is_default"])
        conn.execute("DELETE FROM model_configs WHERE id = ?", (model_id,))
        if was_default:
            replacement = conn.execute(
                "SELECT id FROM model_configs WHERE enabled = 1 ORDER BY id ASC LIMIT 1"
            ).fetchone()
            if replacement is not None:
                conn.execute("UPDATE model_configs SET is_default = 1 WHERE id = ?", (replacement["id"],))
    return {"ok": True}


@app.post("/api/models/{model_id}/test")
async def test_model(model_id: int) -> dict[str, Any]:
    started = time.perf_counter()
    now = now_iso()
    with get_conn() as conn:
        model = row_to_dict(conn.execute("SELECT * FROM model_configs WHERE id = ?", (model_id,)).fetchone())
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found")
    model = _private_model(model) or model

    ok = True
    error = ""
    try:
        if model["provider"] == "local":
            models = [{"id": model["model"], "name": model["name"]}]
        else:
            models = await discover_models(model["provider"], model.get("base_url") or "", model.get("api_key") or "")
    except Exception as exc:
        ok = False
        error = str(exc)[:500]
        models = []

    latency_ms = int((time.perf_counter() - started) * 1000)
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE model_configs
            SET last_test_status = ?, last_test_latency_ms = ?, last_test_error = ?, last_test_at = ?, updated_at = ?
            WHERE id = ?
            """,
            ("ok" if ok else "failed", latency_ms, error, now, now, model_id),
        )
        row = row_to_dict(conn.execute("SELECT * FROM model_configs WHERE id = ?", (model_id,)).fetchone()) or {}
    return {"ok": ok, "latency_ms": latency_ms, "error": error, "models_seen": len(models), "model": _public_model(row)}


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    preset = _load_model_preset(payload.preset_id)
    if payload.preset_id and preset is None:
        raise HTTPException(status_code=404, detail="Preset not found")
    payload = _apply_preset_to_chat(payload, preset)
    with get_conn() as conn:
        if payload.project_id:
            _assert_project_access(conn, request, payload.project_id, "viewer")
        if payload.model_id:
            model = row_to_dict(
                conn.execute("SELECT * FROM model_configs WHERE id = ? AND enabled = 1 AND model_type = 'chat'", (payload.model_id,)).fetchone()
            )
        else:
            model = row_to_dict(
                conn.execute(
                    "SELECT * FROM model_configs WHERE enabled = 1 AND model_type = 'chat' ORDER BY is_default DESC, id ASC LIMIT 1"
                ).fetchone()
            )
        if model is None:
            raise HTTPException(status_code=400, detail="No enabled model configured")
        model = _private_model(model) or model
        if preset is not None:
            model["temperature"] = float(preset.get("temperature") or model.get("temperature") or 0.2)

        now = now_iso()
        conversation_id = payload.conversation_id
        if conversation_id is None:
            title = payload.message.strip().replace("\n", " ")[:36] or "New thread"
            cursor = conn.execute(
                """
                INSERT INTO conversations (title, project_id, model_id, model_preset_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (title, payload.project_id, model["id"], payload.preset_id, now, now),
            )
            conversation_id = cursor.lastrowid
        else:
            conversation = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
            if conversation is None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            if conversation["project_id"]:
                _assert_project_access(conn, request, int(conversation["project_id"]), "viewer")

        user_cursor = conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content, model_id, created_at)
            VALUES (?, 'user', ?, ?, ?)
            """,
            (conversation_id, payload.message, model["id"], now),
        )
        user_message_id = user_cursor.lastrowid

    with get_conn() as conn:
        project = row_to_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (payload.project_id,)).fetchone()) if payload.project_id else None
    rag_settings, contexts, effective_query, retrieval_ms = await _prepare_retrieval(payload, project, request, conversation_id)
    citations = build_citations(contexts)
    messages = _messages_with_preset(build_llm_messages(payload.message, contexts), preset)

    provider_usage: dict[str, Any] | None = None
    generation_start = time.perf_counter()
    try:
        model_result = await generate_with_model(model, messages, payload.message, contexts)
        answer = str(model_result.get("text") or "")
        provider_usage = model_result.get("usage")
    except ModelCallError as exc:
        fallback = local_answer(payload.message, contexts)
        answer = f"{fallback}\n\nCurrent model call failed, so Kortex used the local retrieval answer. Error: {str(exc)[:300]}"
    generation_ms = int((time.perf_counter() - generation_start) * 1000)

    now = now_iso()
    usage_is_estimated = not (provider_usage and any(int(provider_usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "total_tokens")))
    if not usage_is_estimated:
        input_tokens = int(provider_usage.get("input_tokens") or 0)
        output_tokens = int(provider_usage.get("output_tokens") or 0)
        total_tokens = int(provider_usage.get("total_tokens") or input_tokens + output_tokens)
    else:
        input_tokens = sum(_estimate_tokens(message["content"]) for message in messages)
        output_tokens = _estimate_tokens(answer)
        total_tokens = input_tokens + output_tokens
    estimated_cost = _estimate_usage_cost(
        model["provider"],
        model["model"],
        input_tokens,
        output_tokens,
        int(provider_usage.get("cached_input_tokens") or 0) if provider_usage else 0,
    )
    with get_conn() as conn:
        assistant_cursor = conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content, citations_json, model_id, created_at)
            VALUES (?, 'assistant', ?, ?, ?, ?)
            """,
            (conversation_id, answer, citations_to_json(citations), model["id"], now),
        )
        assistant_message_id = assistant_cursor.lastrowid
        conn.execute(
            """
            INSERT INTO model_usage
            (conversation_id, user_message_id, assistant_message_id, model_id, model_preset_id, provider, model,
             input_tokens, output_tokens, total_tokens, estimated_cost, currency, is_estimated, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?)
            """,
            (
                conversation_id,
                user_message_id,
                assistant_message_id,
                model["id"],
                payload.preset_id,
                model["provider"],
                model["model"],
                input_tokens,
                output_tokens,
                total_tokens,
                estimated_cost,
                int(usage_is_estimated),
                now,
            ),
        )
        conn.execute("UPDATE conversations SET updated_at = ?, model_id = ?, model_preset_id = ? WHERE id = ?", (now, model["id"], payload.preset_id, conversation_id))
        conn.execute(
            """
            INSERT INTO rag_debug_logs
            (conversation_id, project_id, model_id, query, retrieval_mode, top_k, similarity_threshold,
             retrieved_count, retrieval_ms, generation_ms, citations_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                conversation_id,
                payload.project_id,
                model["id"],
                effective_query,
                rag_settings["retrieval_mode"],
                rag_settings["top_k"],
                rag_settings["similarity_threshold"],
                len(contexts),
                retrieval_ms,
                generation_ms,
                citations_to_json(citations),
                now,
            ),
        )

    return {
        "conversation_id": conversation_id,
        "assistant_message_id": assistant_message_id,
        "answer": answer,
        "citations": citations,
        "model": _public_model(model),
        "preset": _public_preset(preset) if preset else None,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "estimated_cost": estimated_cost,
            "currency": "USD",
            "is_estimated": usage_is_estimated,
        },
        "debug": {
            "retrieval_mode": rag_settings["retrieval_mode"],
            "retrieval_scope": rag_settings["retrieval_scope"],
            "effective_query": effective_query,
            "top_k": rag_settings["top_k"],
            "similarity_threshold": rag_settings["similarity_threshold"],
            "retrieved_count": len(contexts),
            "retrieval_ms": retrieval_ms,
            "generation_ms": generation_ms,
        },
    }


@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, request: Request) -> StreamingResponse:
    async def events():
        try:
            request_payload = payload
            preset = _load_model_preset(request_payload.preset_id)
            if request_payload.preset_id and preset is None:
                raise HTTPException(status_code=404, detail="Preset not found")
            request_payload = _apply_preset_to_chat(request_payload, preset)
            yield _sse("status", {"status": "retrieving", "label": "查询知识库中"})
            with get_conn() as conn:
                if request_payload.project_id:
                    _assert_project_access(conn, request, request_payload.project_id, "viewer")
                if request_payload.model_id:
                    model = row_to_dict(
                        conn.execute(
                            "SELECT * FROM model_configs WHERE id = ? AND enabled = 1 AND model_type = 'chat'",
                            (request_payload.model_id,),
                        ).fetchone()
                    )
                else:
                    model = row_to_dict(
                        conn.execute(
                            "SELECT * FROM model_configs WHERE enabled = 1 AND model_type = 'chat' ORDER BY is_default DESC, id ASC LIMIT 1"
                        ).fetchone()
                    )
                if model is None:
                    raise HTTPException(status_code=400, detail="No enabled model configured")
                model = _private_model(model) or model
                if preset is not None:
                    model["temperature"] = float(preset.get("temperature") or model.get("temperature") or 0.2)

                now = now_iso()
                conversation_id = request_payload.conversation_id
                if conversation_id is None:
                    title = request_payload.message.strip().replace("\n", " ")[:36] or "New thread"
                    cursor = conn.execute(
                        """
                        INSERT INTO conversations (title, project_id, model_id, model_preset_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (title, request_payload.project_id, model["id"], request_payload.preset_id, now, now),
                    )
                    conversation_id = cursor.lastrowid
                else:
                    conversation = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
                    if conversation is None:
                        raise HTTPException(status_code=404, detail="Conversation not found")
                    if conversation["project_id"]:
                        _assert_project_access(conn, request, int(conversation["project_id"]), "viewer")

                user_cursor = conn.execute(
                    """
                    INSERT INTO messages (conversation_id, role, content, model_id, created_at)
                    VALUES (?, 'user', ?, ?, ?)
                    """,
                    (conversation_id, request_payload.message, model["id"], now),
                )
                user_message_id = user_cursor.lastrowid

            with get_conn() as conn:
                project = (
                    row_to_dict(conn.execute("SELECT * FROM projects WHERE id = ?", (request_payload.project_id,)).fetchone())
                    if request_payload.project_id
                    else None
                )
            rag_settings, contexts, effective_query, retrieval_ms = await _prepare_retrieval(request_payload, project, request, conversation_id)
            citations = build_citations(contexts)
            messages = _messages_with_preset(build_llm_messages(request_payload.message, contexts), preset)
            yield _sse("status", {"status": "thinking", "label": "模型思考中"})
            result = {
                "conversation_id": conversation_id,
                "model": _public_model(model),
                "preset": _public_preset(preset) if preset else None,
                "citations": citations,
                "usage": None,
                "debug": {
                    "retrieval_mode": rag_settings["retrieval_mode"],
                    "retrieval_scope": rag_settings["retrieval_scope"],
                    "effective_query": effective_query,
                    "top_k": rag_settings["top_k"],
                    "similarity_threshold": rag_settings["similarity_threshold"],
                    "retrieved_count": len(contexts),
                    "retrieval_ms": retrieval_ms,
                    "generation_ms": 0,
                },
            }
            yield _sse(
                "meta",
                {
                    "conversation_id": result["conversation_id"],
                    "model": result["model"],
                    "preset": result["preset"],
                    "citations": result["citations"],
                    "usage": result["usage"],
                    "debug": result["debug"],
                },
            )
            yield _sse("status", {"status": "answering", "label": "生成回答中"})
            provider_usage: dict[str, Any] | None = None
            answer_parts: list[str] = []
            generation_start = time.perf_counter()
            try:
                async for event in stream_with_model(model, messages, request_payload.message, contexts):
                    if event.get("type") == "usage":
                        provider_usage = event.get("usage") or provider_usage
                        continue
                    if event.get("type") == "reasoning":
                        yield _sse("reasoning", {"text": str(event.get("text") or "")})
                        continue
                    text = str(event.get("text") or "")
                    if not text:
                        continue
                    answer_parts.append(text)
                    yield _sse("chunk", {"text": text})
            except ModelCallError as exc:
                if answer_parts:
                    text = f"\n\nModel stream interrupted: {str(exc)[:300]}"
                else:
                    text = f"{local_answer(request_payload.message, contexts)}\n\nCurrent model call failed, so Kortex used the local retrieval answer. Error: {str(exc)[:300]}"
                for index in range(0, len(text), 24):
                    chunk = text[index : index + 24]
                    answer_parts.append(chunk)
                    yield _sse("chunk", {"text": chunk})
                    await asyncio.sleep(0.035)

            answer = "".join(answer_parts)
            if not answer:
                answer = local_answer(request_payload.message, contexts)
                for index in range(0, len(answer), 24):
                    yield _sse("chunk", {"text": answer[index : index + 24]})
                    await asyncio.sleep(0.035)
            generation_ms = int((time.perf_counter() - generation_start) * 1000)

            now = now_iso()
            usage_is_estimated = not (provider_usage and any(int(provider_usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "total_tokens")))
            if not usage_is_estimated:
                input_tokens = int(provider_usage.get("input_tokens") or 0)
                output_tokens = int(provider_usage.get("output_tokens") or 0)
                total_tokens = int(provider_usage.get("total_tokens") or input_tokens + output_tokens)
            else:
                input_tokens = sum(_estimate_tokens(message["content"]) for message in messages)
                output_tokens = _estimate_tokens(answer)
                total_tokens = input_tokens + output_tokens
            estimated_cost = _estimate_usage_cost(
                model["provider"],
                model["model"],
                input_tokens,
                output_tokens,
                int(provider_usage.get("cached_input_tokens") or 0) if provider_usage else 0,
            )

            with get_conn() as conn:
                assistant_cursor = conn.execute(
                    """
                    INSERT INTO messages (conversation_id, role, content, citations_json, model_id, created_at)
                    VALUES (?, 'assistant', ?, ?, ?, ?)
                    """,
                    (conversation_id, answer, citations_to_json(citations), model["id"], now),
                )
                assistant_message_id = assistant_cursor.lastrowid
                conn.execute(
                    """
                    INSERT INTO model_usage
                    (conversation_id, user_message_id, assistant_message_id, model_id, model_preset_id, provider, model,
                     input_tokens, output_tokens, total_tokens, estimated_cost, currency, is_estimated, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?)
                    """,
                    (
                        conversation_id,
                        user_message_id,
                        assistant_message_id,
                        model["id"],
                        request_payload.preset_id,
                        model["provider"],
                        model["model"],
                        input_tokens,
                        output_tokens,
                        total_tokens,
                        estimated_cost,
                        int(usage_is_estimated),
                        now,
                    ),
                )
                conn.execute(
                    "UPDATE conversations SET updated_at = ?, model_id = ?, model_preset_id = ? WHERE id = ?",
                    (now, model["id"], request_payload.preset_id, conversation_id),
                )
                conn.execute(
                    """
                    INSERT INTO rag_debug_logs
                    (conversation_id, project_id, model_id, query, retrieval_mode, top_k, similarity_threshold,
                     retrieved_count, retrieval_ms, generation_ms, citations_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        conversation_id,
                        request_payload.project_id,
                        model["id"],
                        effective_query,
                        rag_settings["retrieval_mode"],
                        rag_settings["top_k"],
                        rag_settings["similarity_threshold"],
                        len(contexts),
                        retrieval_ms,
                        generation_ms,
                        citations_to_json(citations),
                        now,
                    ),
                )

            result = {
                "conversation_id": conversation_id,
                "assistant_message_id": assistant_message_id,
                "answer": answer,
                "citations": citations,
                "model": _public_model(model),
                "preset": _public_preset(preset) if preset else None,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "estimated_cost": estimated_cost,
                    "currency": "USD",
                    "is_estimated": usage_is_estimated,
                },
                "debug": {
                    "retrieval_mode": rag_settings["retrieval_mode"],
                    "retrieval_scope": rag_settings["retrieval_scope"],
                    "effective_query": effective_query,
                    "top_k": rag_settings["top_k"],
                    "similarity_threshold": rag_settings["similarity_threshold"],
                    "retrieved_count": len(contexts),
                    "retrieval_ms": retrieval_ms,
                    "generation_ms": generation_ms,
                },
            }
            yield _sse("done", result)
        except Exception as exc:
            yield _sse("error", {"message": str(exc)[:800]})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat/feedback")
def save_chat_feedback(payload: FeedbackRequest) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        message = conn.execute(
            "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
            (payload.message_id, payload.conversation_id),
        ).fetchone()
        if message is None:
            raise HTTPException(status_code=404, detail="Message not found")
        conn.execute(
            """
            INSERT INTO message_feedback (conversation_id, message_id, rating, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.conversation_id, payload.message_id, payload.rating, payload.note.strip(), now),
        )
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/regenerate")
async def regenerate_last_answer(request: Request, conversation_id: int, model_id: int | None = None) -> dict[str, Any]:
    with get_conn() as conn:
        conversation = row_to_dict(conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone())
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.get("project_id"):
            _assert_project_access(conn, request, int(conversation["project_id"]), "viewer")
        last_user = row_to_dict(
            conn.execute(
                "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1",
                (conversation_id,),
            ).fetchone()
        )
    if last_user is None:
        raise HTTPException(status_code=400, detail="No user message to regenerate from")
    payload = ChatRequest(
        message=last_user["content"],
        project_id=conversation.get("project_id"),
        model_id=model_id or conversation.get("model_id"),
        preset_id=conversation.get("model_preset_id"),
        conversation_id=conversation_id,
    )
    return await chat(payload, request)


@app.get("/api/models/usage")
def list_model_usage(request: Request, limit: int = 100) -> dict[str, Any]:
    limit = max(1, min(limit, 500))
    with get_conn() as conn:
        where_sql = ""
        params: list[Any] = []
        totals_where_sql = ""
        totals_params: list[Any] = []
        accessible_ids = _accessible_project_ids(conn, request)
        where_sql, params = _project_filter_sql(accessible_ids, "conversations.project_id")
        totals_where_sql, totals_params = _project_filter_sql(accessible_ids, "conversations.project_id")
        params.append(limit)
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT model_usage.*,
                       conversations.title AS conversation_title,
                       projects.name AS project_name,
                       model_configs.name AS model_name,
                       model_presets.name AS preset_name
                FROM model_usage
                LEFT JOIN conversations ON conversations.id = model_usage.conversation_id
                LEFT JOIN projects ON projects.id = conversations.project_id
                LEFT JOIN model_configs ON model_configs.id = model_usage.model_id
                LEFT JOIN model_presets ON model_presets.id = model_usage.model_preset_id
                {where_sql}
                ORDER BY model_usage.created_at DESC, model_usage.id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        )
        totals = rows_to_dicts(
            conn.execute(
                f"""
                SELECT model_usage.provider AS provider,
                       model_usage.model AS model,
                       model_usage.model_preset_id AS model_preset_id,
                       model_presets.name AS preset_name,
                       COUNT(*) AS call_count,
                       SUM(model_usage.input_tokens) AS input_tokens,
                       SUM(model_usage.output_tokens) AS output_tokens,
                       SUM(model_usage.total_tokens) AS total_tokens,
                       SUM(model_usage.estimated_cost) AS estimated_cost,
                       MAX(model_usage.created_at) AS last_used_at
                FROM model_usage
                LEFT JOIN conversations ON conversations.id = model_usage.conversation_id
                LEFT JOIN model_presets ON model_presets.id = model_usage.model_preset_id
                {totals_where_sql}
                GROUP BY model_usage.provider, model_usage.model, model_usage.model_preset_id, model_presets.name
                ORDER BY last_used_at DESC
                """,
                tuple(totals_params),
            ).fetchall()
        )
    for row in rows:
        row.update(_repair_payload(row))
        row["estimated_cost"] = _repair_usage_cost(
            row.get("provider") or "",
            row.get("model") or "",
            int(row.get("input_tokens") or 0),
            int(row.get("output_tokens") or 0),
            float(row.get("estimated_cost") or 0),
        )
    totals_by_key: dict[tuple[str, str, Any], float] = {}
    for row in rows:
        key = (row.get("provider") or "", row.get("model") or "", row.get("model_preset_id"))
        totals_by_key[key] = totals_by_key.get(key, 0.0) + float(row.get("estimated_cost") or 0)
    for total in totals:
        total.update(_repair_payload(total))
        key = (total.get("provider") or "", total.get("model") or "", total.get("model_preset_id"))
        total["estimated_cost"] = round(totals_by_key.get(key, float(total.get("estimated_cost") or 0)), 8)
    return {"items": rows, "totals": totals}


@app.post("/api/rag/debug")
async def debug_retrieval(payload: RagDebugRequest, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        project = _assert_project_access(conn, request, payload.project_id, "viewer") if payload.project_id else None
    settings, contexts, effective_query, retrieval_ms = await _prepare_retrieval(payload, project, request)
    return {
        "query": payload.query,
        "effective_query": effective_query,
        "settings": settings,
        "retrieval_ms": retrieval_ms,
        "items": [
            {
                "chunk_id": item["id"],
                "document_id": item["document_id"],
                "document_title": item["document_title"],
                "filename": item["filename"],
                "chunk_index": item["chunk_index"],
                "score": item["score"],
                "vector_score": item.get("vector_score", 0),
                "keyword_score": item.get("keyword_score", 0),
                "rerank_score": item.get("rerank_score", 0),
                "section_path": item.get("section_path", ""),
                "snippet": re.sub(r"\s+", " ", item["content"]).strip()[:420],
            }
            for item in contexts
        ],
    }


@app.get("/api/rag/logs")
def list_rag_logs(request: Request, project_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 200))
    params: tuple[Any, ...]
    where = ""
    if project_id:
        with get_conn() as conn:
            _assert_project_access(conn, request, project_id, "viewer")
        where = "WHERE rag_debug_logs.project_id = ?"
        params = (project_id, limit)
    else:
        with get_conn() as conn:
            accessible_ids = _accessible_project_ids(conn, request)
        where, project_params = _project_filter_sql(accessible_ids, "rag_debug_logs.project_id")
        params = (*project_params, limit)
    with get_conn() as conn:
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT rag_debug_logs.*,
                       projects.name AS project_name,
                       model_configs.name AS model_name,
                       conversations.title AS conversation_title
                FROM rag_debug_logs
                LEFT JOIN projects ON projects.id = rag_debug_logs.project_id
                LEFT JOIN model_configs ON model_configs.id = rag_debug_logs.model_id
                LEFT JOIN conversations ON conversations.id = rag_debug_logs.conversation_id
                {where}
                ORDER BY rag_debug_logs.created_at DESC, rag_debug_logs.id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        )
    for row in rows:
        row["citations"] = _repair_payload(json.loads(row.pop("citations_json") or "[]"))
        row.update(_repair_payload(row))
    return rows


@app.get("/api/eval/cases")
def list_eval_cases(request: Request, project_id: int | None = None) -> list[dict[str, Any]]:
    where = "WHERE eval_cases.project_id = ?" if project_id else ""
    params: tuple[Any, ...] = (project_id,) if project_id else ()
    with get_conn() as conn:
        if project_id:
            _assert_project_access(conn, request, project_id, "viewer")
        else:
            accessible_ids = _accessible_project_ids(conn, request)
            if accessible_ids is not None:
                where, project_params = _project_filter_sql(accessible_ids, "eval_cases.project_id")
                params = tuple(project_params)
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT eval_cases.*, projects.name AS project_name
                FROM eval_cases
                LEFT JOIN projects ON projects.id = eval_cases.project_id
                {where}
                ORDER BY eval_cases.updated_at DESC, eval_cases.id DESC
                """,
                params,
            ).fetchall()
        )
    return rows


@app.post("/api/eval/cases")
def create_eval_case(payload: EvalCaseIn, request: Request) -> dict[str, Any]:
    now = now_iso()
    with get_conn() as conn:
        if payload.project_id:
            _assert_project_access(conn, request, payload.project_id, "editor")
        cursor = conn.execute(
            """
            INSERT INTO eval_cases (project_id, question, expected_answer, expected_document, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (payload.project_id, payload.question.strip(), payload.expected_answer.strip(), payload.expected_document.strip(), payload.tags.strip(), now, now),
        )
        row = row_to_dict(conn.execute("SELECT * FROM eval_cases WHERE id = ?", (cursor.lastrowid,)).fetchone()) or {}
    return row


@app.delete("/api/eval/cases/{case_id}")
def delete_eval_case(case_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        case = row_to_dict(conn.execute("SELECT * FROM eval_cases WHERE id = ?", (case_id,)).fetchone())
        if case is None:
            raise HTTPException(status_code=404, detail="Eval case not found")
        if case.get("project_id"):
            _assert_project_access(conn, request, int(case["project_id"]), "editor")
        conn.execute("DELETE FROM eval_cases WHERE id = ?", (case_id,))
    return {"ok": True}


def _score_answer(answer: str, expected_answer: str) -> float:
    expected_tokens = set(re.findall(r"[\w\u4e00-\u9fff]+", expected_answer.lower()))
    if not expected_tokens:
        return 0.0
    answer_text = answer.lower()
    hits = sum(1 for token in expected_tokens if token in answer_text)
    return round(hits / len(expected_tokens), 4)


@app.post("/api/eval/run")
async def run_eval(payload: EvalRunRequest, request: Request) -> dict[str, Any]:
    params: list[Any] = []
    where = []
    if payload.case_ids:
        placeholders = ",".join("?" for _ in payload.case_ids)
        where.append(f"id IN ({placeholders})")
        params.extend(payload.case_ids)
    if payload.project_id:
        where.append("project_id = ?")
        params.append(payload.project_id)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    with get_conn() as conn:
        if payload.project_id:
            _assert_project_access(conn, request, payload.project_id, "viewer")
        cases = rows_to_dicts(conn.execute(f"SELECT * FROM eval_cases {where_sql} ORDER BY id ASC", params).fetchall())
    results = []
    for case in cases[:30]:
        started = time.perf_counter()
        result = await chat(
            ChatRequest(
                message=case["question"],
                project_id=case.get("project_id") or payload.project_id,
                model_id=payload.model_id,
                preset_id=payload.preset_id,
            ),
            request,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        citations = result.get("citations") or []
        expected_document = (case.get("expected_document") or "").lower()
        retrieval_score = 0.0
        if expected_document:
            retrieval_score = 1.0 if any(expected_document in (citation.get("filename", "") + " " + citation.get("document_title", "")).lower() for citation in citations) else 0.0
        answer_score = _score_answer(result.get("answer", ""), case.get("expected_answer", ""))
        now = now_iso()
        with get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO eval_runs
                (case_id, project_id, model_id, model_preset_id, model_snapshot_json, answer, citations_json, retrieval_score, answer_score, latency_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    case["id"],
                    case.get("project_id") or payload.project_id,
                    result.get("model", {}).get("id") or payload.model_id,
                    result.get("preset", {}).get("id") or payload.preset_id,
                    _model_snapshot(result.get("model", {}), result.get("preset")),
                    result.get("answer", ""),
                    json.dumps(citations, ensure_ascii=False),
                    retrieval_score,
                    answer_score,
                    latency_ms,
                    now,
                ),
            )
        results.append({"run_id": cursor.lastrowid, "case_id": case["id"], "retrieval_score": retrieval_score, "answer_score": answer_score, "latency_ms": latency_ms})
    return {"count": len(results), "items": results}


@app.get("/api/eval/runs")
def list_eval_runs(request: Request, limit: int = 100) -> list[dict[str, Any]]:
    limit = max(1, min(limit, 500))
    with get_conn() as conn:
        where_sql = ""
        params: list[Any] = []
        accessible_ids = _accessible_project_ids(conn, request)
        where_sql, params = _project_filter_sql(accessible_ids, "eval_runs.project_id")
        params.append(limit)
        rows = rows_to_dicts(
            conn.execute(
                f"""
                SELECT eval_runs.*, eval_cases.question, model_configs.name AS model_name, model_presets.name AS preset_name
                FROM eval_runs
                JOIN eval_cases ON eval_cases.id = eval_runs.case_id
                LEFT JOIN model_configs ON model_configs.id = eval_runs.model_id
                LEFT JOIN model_presets ON model_presets.id = eval_runs.model_preset_id
                {where_sql}
                ORDER BY eval_runs.created_at DESC, eval_runs.id DESC
                LIMIT ?
                """,
                tuple(params),
            ).fetchall()
        )
    for row in rows:
        row["citations"] = json.loads(row.pop("citations_json") or "[]")
    return rows


@app.get("/api/conversations")
def list_conversations(request: Request) -> list[dict[str, Any]]:
    with get_conn() as conn:
        accessible_ids = _accessible_project_ids(conn, request)
        where_sql, params = _project_filter_sql(accessible_ids, "conversations.project_id")
        rows = conn.execute(
            f"""
            SELECT conversations.*, projects.name AS project_name, model_configs.name AS model_name, model_presets.name AS preset_name
            FROM conversations
            LEFT JOIN projects ON projects.id = conversations.project_id
            LEFT JOIN model_configs ON model_configs.id = conversations.model_id
            LEFT JOIN model_presets ON model_presets.id = conversations.model_preset_id
            {where_sql}
            ORDER BY conversations.updated_at DESC
            """,
            tuple(params),
        ).fetchall()
        return [_repair_payload(item) for item in rows_to_dicts(rows)]


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: int, request: Request) -> dict[str, Any]:
    with get_conn() as conn:
        conversation = row_to_dict(conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone())
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.get("project_id"):
            _assert_project_access(conn, request, int(conversation["project_id"]), "viewer")
        messages = rows_to_dicts(
            conn.execute(
                """
                SELECT messages.*,
                       model_configs.name AS model_name,
                       model_configs.provider AS model_provider,
                       model_configs.model AS model_model,
                       conversations.model_preset_id,
                       model_usage.input_tokens AS usage_input_tokens,
                       model_usage.output_tokens AS usage_output_tokens,
                       model_usage.total_tokens AS usage_total_tokens,
                       model_usage.estimated_cost AS usage_estimated_cost,
                       model_usage.currency AS usage_currency,
                       model_usage.is_estimated AS usage_is_estimated
                FROM messages
                LEFT JOIN model_configs ON model_configs.id = messages.model_id
                LEFT JOIN conversations ON conversations.id = messages.conversation_id
                LEFT JOIN model_usage ON model_usage.assistant_message_id = messages.id
                WHERE messages.conversation_id = ?
                ORDER BY messages.id ASC
                """,
                (conversation_id,),
            ).fetchall()
        )
        for message in messages:
            import json

            message["citations"] = _repair_payload(json.loads(message.pop("citations_json") or "[]"))
            message.update(_repair_payload(message))
            if message["role"] == "assistant" and message.get("usage_total_tokens") is not None:
                usage_input_tokens = int(message.pop("usage_input_tokens") or 0)
                usage_output_tokens = int(message.pop("usage_output_tokens") or 0)
                usage_total_tokens = int(message.pop("usage_total_tokens") or 0)
                usage_estimated_cost = float(message.pop("usage_estimated_cost") or 0)
                usage_currency = message.pop("usage_currency") or "USD"
                usage_is_estimated = bool(message.pop("usage_is_estimated") or False)
                message["usage"] = {
                    "input_tokens": usage_input_tokens,
                    "output_tokens": usage_output_tokens,
                    "total_tokens": usage_total_tokens,
                    "estimated_cost": _repair_usage_cost(
                        message.get("model_provider") or "",
                        message.get("model_model") or "",
                        usage_input_tokens,
                        usage_output_tokens,
                        usage_estimated_cost,
                    ),
                    "currency": usage_currency,
                    "is_estimated": usage_is_estimated,
                }
            else:
                message.pop("usage_input_tokens", None)
                message.pop("usage_output_tokens", None)
                message.pop("usage_total_tokens", None)
                message.pop("usage_estimated_cost", None)
                message.pop("usage_currency", None)
                message.pop("usage_is_estimated", None)
        conversation["messages"] = messages
        return _repair_payload(conversation)


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, request: Request) -> dict[str, bool]:
    with get_conn() as conn:
        conversation = row_to_dict(conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone())
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if conversation.get("project_id"):
            _assert_project_access(conn, request, int(conversation["project_id"]), "viewer")
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return {"ok": True}


@app.get("/api/admin/stats")
def admin_stats() -> dict[str, Any]:
    with get_conn() as conn:
        counts = {
            "projects": conn.execute("SELECT COUNT(*) AS count FROM projects").fetchone()["count"],
            "documents": conn.execute("SELECT COUNT(*) AS count FROM documents").fetchone()["count"],
            "chunks": conn.execute("SELECT COUNT(*) AS count FROM chunks").fetchone()["count"],
            "conversations": conn.execute("SELECT COUNT(*) AS count FROM conversations").fetchone()["count"],
            "models": conn.execute("SELECT COUNT(*) AS count FROM model_configs").fetchone()["count"],
            "presets": conn.execute("SELECT COUNT(*) AS count FROM model_presets").fetchone()["count"],
            "eval_cases": conn.execute("SELECT COUNT(*) AS count FROM eval_cases").fetchone()["count"],
            "feedback": conn.execute("SELECT COUNT(*) AS count FROM message_feedback").fetchone()["count"],
        }
        recent_documents = rows_to_dicts(
            conn.execute(
                """
                SELECT documents.id, documents.title, documents.filename, documents.chunk_count,
                       documents.created_at, projects.name AS project_name
                FROM documents
                JOIN projects ON projects.id = documents.project_id
                ORDER BY documents.created_at DESC
                LIMIT 8
                """
            ).fetchall()
        )
        recent_conversations = rows_to_dicts(
            conn.execute(
                """
                SELECT conversations.id, conversations.title, conversations.updated_at,
                       projects.name AS project_name
                FROM conversations
                LEFT JOIN projects ON projects.id = conversations.project_id
                ORDER BY conversations.updated_at DESC
                LIMIT 8
                """
            ).fetchall()
        )
    return {"counts": counts, "recent_documents": recent_documents, "recent_conversations": recent_conversations}


@app.get("/api/admin/health")
def admin_health() -> dict[str, Any]:
    db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    uploads_size = 0
    for path in UPLOAD_DIR.rglob("*"):
        if path.is_file():
            uploads_size += path.stat().st_size
    with get_conn() as conn:
        failed_jobs = conn.execute("SELECT COUNT(*) AS count FROM import_jobs WHERE status = 'failed'").fetchone()["count"]
        recent_events = rows_to_dicts(
            conn.execute(
                "SELECT * FROM system_events ORDER BY created_at DESC, id DESC LIMIT 20",
            ).fetchall()
        )
        feedback_count = conn.execute("SELECT COUNT(*) AS count FROM message_feedback").fetchone()["count"]
    return {
        "status": "ok",
        "database_path": str(DB_PATH),
        "data_dir": str(DATA_DIR),
        "db_size": db_size,
        "uploads_size": uploads_size,
        "failed_import_jobs": failed_jobs,
        "feedback_count": feedback_count,
        "recent_events": recent_events,
        "auth_required": bool(os.getenv("KORTEX_ADMIN_TOKEN")),
        "vector_backend": os.getenv("VECTOR_BACKEND", "sqlite"),
        "qdrant": qdrant_status(),
    }


@app.get("/api/admin/backup")
def download_backup() -> FileResponse:
    backup_dir = DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_iso().replace(":", "-").replace(".", "-")
    backup_path = backup_dir / f"kortex-backup-{stamp}.zip"
    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        if DB_PATH.exists():
            archive.write(DB_PATH, "knowledge.sqlite3")
        for path in UPLOAD_DIR.rglob("*"):
            if path.is_file():
                archive.write(path, f"uploads/{path.relative_to(UPLOAD_DIR)}")
    _log_event("info", "backup", "Backup archive created", {"path": str(backup_path)})
    return FileResponse(str(backup_path), filename=backup_path.name, media_type="application/zip")


@app.post("/api/admin/backup/restore")
async def restore_backup(file: UploadFile = File(...)) -> dict[str, Any]:
    restore_dir = DATA_DIR / "restore"
    restore_dir.mkdir(parents=True, exist_ok=True)
    target = restore_dir / _storage_name(file.filename or "backup.zip")
    with target.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    try:
        with zipfile.ZipFile(target) as archive:
            if "knowledge.sqlite3" not in archive.namelist():
                raise HTTPException(status_code=400, detail="Backup does not contain knowledge.sqlite3")
            current_backup = DATA_DIR / f"knowledge-before-restore-{now_iso().replace(':', '-')}.sqlite3"
            if DB_PATH.exists():
                shutil.copy2(DB_PATH, current_backup)
            archive.extract("knowledge.sqlite3", DATA_DIR)
            uploads_member_prefix = "uploads/"
            for member in archive.namelist():
                if not member.startswith(uploads_member_prefix) or member.endswith("/"):
                    continue
                relative = Path(member.removeprefix(uploads_member_prefix))
                destination = UPLOAD_DIR / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(archive.read(member))
    finally:
        target.unlink(missing_ok=True)
    init_db()
    _log_event("warning", "backup", "Backup restored", {})
    return {"ok": True}


frontend_dir = Path(os.getenv("KB_FRONTEND_DIR", "")).resolve() if os.getenv("KB_FRONTEND_DIR") else None
if frontend_dir and frontend_dir.exists():
    assets_dir = frontend_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")

        requested = (frontend_dir / full_path).resolve()
        if requested.is_file() and frontend_dir in requested.parents:
            return FileResponse(requested)
        return FileResponse(frontend_dir / "index.html")
