from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .database import UPLOAD_DIR, get_conn, init_db, now_iso, row_to_dict, rows_to_dicts
from .document_loader import extract_text, split_text
from .providers import ModelCallError, ModelDiscoveryError, discover_models, generate_with_model
from .rag import build_citations, build_llm_messages, citations_to_json, local_answer, retrieve_context
from .vectorizer import dumps_vector, embed


app = FastAPI(title="Kortex Knowledge Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""


PROVIDER_PATTERN = "^(local|ollama|openai_compatible|anthropic|google)$"


class ModelConfigIn(BaseModel):
    name: str
    provider: str = Field(pattern=PROVIDER_PATTERN)
    model: str
    base_url: str = ""
    api_key: str = ""
    temperature: float = 0.2
    enabled: bool = True
    is_default: bool = False


class ModelConfigPatch(BaseModel):
    name: str | None = None
    provider: str | None = Field(default=None, pattern=PROVIDER_PATTERN)
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
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
    conversation_id: int | None = None
    top_k: int = 5


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT projects.*,
                   COUNT(DISTINCT documents.id) AS document_count,
                   COUNT(chunks.id) AS chunk_count
            FROM projects
            LEFT JOIN documents ON documents.project_id = projects.id
            LEFT JOIN chunks ON chunks.project_id = projects.id
            GROUP BY projects.id
            ORDER BY projects.updated_at DESC
            """
        ).fetchall()
        return rows_to_dicts(rows)


@app.post("/api/projects")
def create_project(payload: ProjectCreate) -> dict[str, Any]:
    now = now_iso()
    try:
        with get_conn() as conn:
            cursor = conn.execute(
                "INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (payload.name.strip(), payload.description.strip(), now, now),
            )
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (cursor.lastrowid,)).fetchone()
            return row_to_dict(row) or {}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/documents")
def list_documents(project_id: int | None = None) -> list[dict[str, Any]]:
    with get_conn() as conn:
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
            rows = conn.execute(
                """
                SELECT documents.*, projects.name AS project_name
                FROM documents
                JOIN projects ON projects.id = documents.project_id
                ORDER BY documents.created_at DESC
                """
            ).fetchall()
        return rows_to_dicts(rows)


@app.post("/api/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    project_id: int = Form(1),
) -> dict[str, Any]:
    uploaded = []
    with get_conn() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

    for upload in files:
        safe_name = Path(upload.filename or "document.txt").name
        timestamp = now_iso().replace(":", "-").replace(".", "-")
        target_path = UPLOAD_DIR / f"{timestamp}_{safe_name}"
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(upload.file, buffer)

        try:
            text = extract_text(target_path, safe_name)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"{safe_name} could not be parsed: {exc}") from exc

        chunks = split_text(text)
        if not chunks:
            raise HTTPException(status_code=400, detail=f"{safe_name} did not contain readable text")

        now = now_iso()
        with get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO documents
                (project_id, title, filename, content_type, size, path, status, chunk_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)
                """,
                (
                    project_id,
                    Path(safe_name).stem,
                    safe_name,
                    upload.content_type or "",
                    target_path.stat().st_size,
                    str(target_path),
                    len(chunks),
                    now,
                ),
            )
            document_id = cursor.lastrowid
            conn.executemany(
                """
                INSERT INTO chunks
                (document_id, project_id, chunk_index, content, vector_json, char_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        document_id,
                        project_id,
                        index,
                        chunk,
                        dumps_vector(embed(chunk)),
                        len(chunk),
                        now,
                    )
                    for index, chunk in enumerate(chunks)
                ],
            )
            conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
            uploaded.append({"document_id": document_id, "filename": safe_name, "chunks": len(chunks)})

    return {"uploaded": uploaded}


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: int) -> dict[str, bool]:
    file_removed = True
    with get_conn() as conn:
        row = conn.execute("SELECT path FROM documents WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found")
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
        try:
            Path(row["path"]).unlink(missing_ok=True)
        except OSError:
            file_removed = False
    return {"ok": True, "file_removed": file_removed}


def _public_model(row: dict[str, Any]) -> dict[str, Any]:
    row["enabled"] = bool(row["enabled"])
    row["is_default"] = bool(row["is_default"])
    row["api_key_set"] = bool(row.get("api_key"))
    row["api_key"] = ""
    return row


@app.get("/api/models")
def list_models() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = rows_to_dicts(conn.execute("SELECT * FROM model_configs ORDER BY is_default DESC, id ASC").fetchall())
    return [_public_model(row) for row in rows]


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
        if payload.is_default:
            conn.execute("UPDATE model_configs SET is_default = 0")
        cursor = conn.execute(
            """
            INSERT INTO model_configs
            (name, provider, model, base_url, api_key, temperature, enabled, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name,
                payload.provider,
                payload.model,
                payload.base_url,
                payload.api_key,
                payload.temperature,
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


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> dict[str, Any]:
    with get_conn() as conn:
        if payload.model_id:
            model = row_to_dict(
                conn.execute("SELECT * FROM model_configs WHERE id = ? AND enabled = 1", (payload.model_id,)).fetchone()
            )
        else:
            model = row_to_dict(
                conn.execute(
                    "SELECT * FROM model_configs WHERE enabled = 1 ORDER BY is_default DESC, id ASC LIMIT 1"
                ).fetchone()
            )
        if model is None:
            raise HTTPException(status_code=400, detail="No enabled model configured")

        now = now_iso()
        conversation_id = payload.conversation_id
        if conversation_id is None:
            title = payload.message.strip().replace("\n", " ")[:36] or "New thread"
            cursor = conn.execute(
                """
                INSERT INTO conversations (title, project_id, model_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (title, payload.project_id, model["id"], now, now),
            )
            conversation_id = cursor.lastrowid
        else:
            conversation = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
            if conversation is None:
                raise HTTPException(status_code=404, detail="Conversation not found")

        conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content, model_id, created_at)
            VALUES (?, 'user', ?, ?, ?)
            """,
            (conversation_id, payload.message, model["id"], now),
        )

    contexts = retrieve_context(payload.message, payload.project_id, payload.top_k)
    citations = build_citations(contexts)
    messages = build_llm_messages(payload.message, contexts)

    try:
        answer = await generate_with_model(model, messages, payload.message, contexts)
    except ModelCallError as exc:
        fallback = local_answer(payload.message, contexts)
        answer = f"{fallback}\n\nCurrent model call failed, so Kortex used the local retrieval answer. Error: {str(exc)[:300]}"

    now = now_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO messages (conversation_id, role, content, citations_json, model_id, created_at)
            VALUES (?, 'assistant', ?, ?, ?, ?)
            """,
            (conversation_id, answer, citations_to_json(citations), model["id"], now),
        )
        conn.execute("UPDATE conversations SET updated_at = ?, model_id = ? WHERE id = ?", (now, model["id"], conversation_id))

    return {
        "conversation_id": conversation_id,
        "answer": answer,
        "citations": citations,
        "model": _public_model(model),
    }


@app.get("/api/conversations")
def list_conversations() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT conversations.*, projects.name AS project_name, model_configs.name AS model_name
            FROM conversations
            LEFT JOIN projects ON projects.id = conversations.project_id
            LEFT JOIN model_configs ON model_configs.id = conversations.model_id
            ORDER BY conversations.updated_at DESC
            """
        ).fetchall()
        return rows_to_dicts(rows)


@app.get("/api/conversations/{conversation_id}")
def get_conversation(conversation_id: int) -> dict[str, Any]:
    with get_conn() as conn:
        conversation = row_to_dict(conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone())
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        messages = rows_to_dicts(
            conn.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC", (conversation_id,)).fetchall()
        )
        for message in messages:
            import json

            message["citations"] = json.loads(message.pop("citations_json") or "[]")
        conversation["messages"] = messages
        return conversation


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: int) -> dict[str, bool]:
    with get_conn() as conn:
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
