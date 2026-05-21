from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("KB_DATA_DIR", APP_ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "knowledge.sqlite3"

DEFAULT_MODEL_CONFIGS = [
    {
        "name": "Local Evidence Answer",
        "provider": "local",
        "model": "extractive-rag",
        "base_url": "",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 1,
        "is_default": 1,
    },
]

LEGACY_SEEDED_MODEL_KEYS = {
    ("Ollama Qwen", "ollama", "qwen2.5:7b", "http://localhost:11434"),
    ("Ollama Qwen 2.5", "ollama", "qwen2.5:7b", "http://localhost:11434"),
    ("OpenAI GPT-4.1 Mini", "openai_compatible", "gpt-4.1-mini", "https://api.openai.com/v1"),
    ("DeepSeek Chat", "openai_compatible", "deepseek-chat", "https://api.deepseek.com/v1"),
    ("Claude Sonnet", "anthropic", "claude-3-5-sonnet-latest", "https://api.anthropic.com/v1"),
    ("Gemini Flash", "google", "gemini-1.5-flash", "https://generativelanguage.googleapis.com/v1beta"),
    ("Qwen Plus", "openai_compatible", "qwen-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    ("Kimi", "openai_compatible", "moonshot-v1-8k", "https://api.moonshot.cn/v1"),
    ("OpenRouter", "openai_compatible", "openai/gpt-4.1-mini", "https://openrouter.ai/api/v1"),
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(row) or {} for row in rows]


def ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def cleanup_legacy_seeded_models(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT model_configs.*,
               COUNT(DISTINCT conversations.id) AS conversation_count,
               COUNT(DISTINCT messages.id) AS message_count
        FROM model_configs
        LEFT JOIN conversations ON conversations.model_id = model_configs.id
        LEFT JOIN messages ON messages.model_id = model_configs.id
        GROUP BY model_configs.id
        """
    ).fetchall()
    for row in rows:
        key = (row["name"], row["provider"], row["model"], row["base_url"])
        is_unused = row["conversation_count"] == 0 and row["message_count"] == 0
        if key in LEGACY_SEEDED_MODEL_KEYS and not row["api_key"] and is_unused:
            conn.execute("DELETE FROM model_configs WHERE id = ?", (row["id"],))


def cleanup_duplicate_model_configs(conn: sqlite3.Connection) -> None:
    duplicate_groups = conn.execute(
        """
        SELECT provider, base_url, model, COUNT(*) AS count
        FROM model_configs
        GROUP BY provider, base_url, model
        HAVING count > 1
        """
    ).fetchall()

    for group in duplicate_groups:
        rows = conn.execute(
            """
            SELECT model_configs.*,
                   COUNT(DISTINCT conversations.id) AS conversation_count,
                   COUNT(DISTINCT messages.id) AS message_count
            FROM model_configs
            LEFT JOIN conversations ON conversations.model_id = model_configs.id
            LEFT JOIN messages ON messages.model_id = model_configs.id
            WHERE model_configs.provider = ?
              AND model_configs.base_url = ?
              AND model_configs.model = ?
            GROUP BY model_configs.id
            ORDER BY model_configs.id ASC
            """,
            (group["provider"], group["base_url"], group["model"]),
        ).fetchall()
        if len(rows) < 2:
            continue

        def score(row: sqlite3.Row) -> tuple[int, int, int, int]:
            return (
                1 if row["is_default"] else 0,
                1 if row["api_key"] else 0,
                row["conversation_count"] + row["message_count"],
                -row["id"],
            )

        keep = max(rows, key=score)
        for row in rows:
            if row["id"] == keep["id"]:
                continue
            conn.execute("UPDATE conversations SET model_id = ? WHERE model_id = ?", (keep["id"], row["id"]))
            conn.execute("UPDATE messages SET model_id = ? WHERE model_id = ?", (keep["id"], row["id"]))
            conn.execute("DELETE FROM model_configs WHERE id = ?", (row["id"],))


def normalize_model_defaults(conn: sqlite3.Connection) -> None:
    enabled_defaults = conn.execute(
        "SELECT id FROM model_configs WHERE enabled = 1 AND is_default = 1 ORDER BY id ASC"
    ).fetchall()
    if enabled_defaults:
        keep_id = enabled_defaults[0]["id"]
        conn.execute("UPDATE model_configs SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", (keep_id,))
        return

    replacement = conn.execute(
        """
        SELECT id FROM model_configs
        WHERE enabled = 1
        ORDER BY CASE WHEN provider = 'local' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
        """
    ).fetchone()
    if replacement is not None:
        conn.execute("UPDATE model_configs SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END", (replacement["id"],))


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL DEFAULT '',
                chunk_size INTEGER NOT NULL DEFAULT 1200,
                chunk_overlap INTEGER NOT NULL DEFAULT 160,
                retrieval_top_k INTEGER NOT NULL DEFAULT 5,
                retrieval_mode TEXT NOT NULL DEFAULT 'hybrid',
                retrieval_scope TEXT NOT NULL DEFAULT 'focused',
                similarity_threshold REAL NOT NULL DEFAULT 0,
                query_rewrite_enabled INTEGER NOT NULL DEFAULT 0,
                rerank_enabled INTEGER NOT NULL DEFAULT 0,
                agent_tools_enabled INTEGER NOT NULL DEFAULT 0,
                full_context_limit INTEGER NOT NULL DEFAULT 20,
                metadata_filter_json TEXT NOT NULL DEFAULT '{}',
                embedding_model_id INTEGER,
                rerank_model_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(embedding_model_id) REFERENCES model_configs(id) ON DELETE SET NULL,
                FOREIGN KEY(rerank_model_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                filename TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT '',
                size INTEGER NOT NULL DEFAULT 0,
                path TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ready',
                chunk_count INTEGER NOT NULL DEFAULT 0,
                checksum TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1,
                parent_document_id INTEGER,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                last_indexed_at TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_document_id) REFERENCES documents(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                vector_json TEXT NOT NULL,
                char_count INTEGER NOT NULL DEFAULT 0,
                parent_chunk_id INTEGER,
                section_path TEXT NOT NULL DEFAULT '',
                start_char INTEGER NOT NULL DEFAULT 0,
                end_char INTEGER NOT NULL DEFAULT 0,
                vector_model_id INTEGER,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(parent_chunk_id) REFERENCES chunks(id) ON DELETE SET NULL,
                FOREIGN KEY(vector_model_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
            CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);

            CREATE TABLE IF NOT EXISTS model_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                base_url TEXT NOT NULL DEFAULT '',
                api_key TEXT NOT NULL DEFAULT '',
                temperature REAL NOT NULL DEFAULT 0.2,
                model_type TEXT NOT NULL DEFAULT 'chat',
                context_window INTEGER NOT NULL DEFAULT 0,
                supports_tools INTEGER NOT NULL DEFAULT 0,
                supports_vision INTEGER NOT NULL DEFAULT 0,
                last_test_status TEXT NOT NULL DEFAULT 'untested',
                last_test_latency_ms INTEGER,
                last_test_error TEXT NOT NULL DEFAULT '',
                last_test_at TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                project_id INTEGER,
                model_id INTEGER,
                system_prompt TEXT NOT NULL DEFAULT '',
                temperature REAL NOT NULL DEFAULT 0.2,
                retrieval_scope TEXT NOT NULL DEFAULT 'focused',
                retrieval_mode TEXT NOT NULL DEFAULT 'hybrid',
                top_k INTEGER NOT NULL DEFAULT 5,
                similarity_threshold REAL NOT NULL DEFAULT 0,
                use_query_rewrite INTEGER NOT NULL DEFAULT 0,
                use_rerank INTEGER NOT NULL DEFAULT 0,
                metadata_filter_json TEXT NOT NULL DEFAULT '{}',
                tools_json TEXT NOT NULL DEFAULT '[]',
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_model_presets_project ON model_presets(project_id);
            CREATE INDEX IF NOT EXISTS idx_model_presets_model ON model_presets(model_id);

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                project_id INTEGER,
                model_id INTEGER,
                model_preset_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL,
                FOREIGN KEY(model_preset_id) REFERENCES model_presets(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                citations_json TEXT NOT NULL DEFAULT '[]',
                model_id INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS model_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                user_message_id INTEGER,
                assistant_message_id INTEGER,
                model_id INTEGER,
                model_preset_id INTEGER,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                estimated_cost REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'USD',
                is_estimated INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY(user_message_id) REFERENCES messages(id) ON DELETE SET NULL,
                FOREIGN KEY(assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL,
                FOREIGN KEY(model_preset_id) REFERENCES model_presets(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_model_usage_conversation ON model_usage(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_model_usage_model ON model_usage(model_id);

            CREATE TABLE IF NOT EXISTS import_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'completed',
                source_name TEXT NOT NULL DEFAULT '',
                total_files INTEGER NOT NULL DEFAULT 0,
                indexed_files INTEGER NOT NULL DEFAULT 0,
                skipped_files INTEGER NOT NULL DEFAULT 0,
                failed_files INTEGER NOT NULL DEFAULT 0,
                uploaded_json TEXT NOT NULL DEFAULT '[]',
                skipped_json TEXT NOT NULL DEFAULT '[]',
                error TEXT NOT NULL DEFAULT '',
                started_at TEXT NOT NULL,
                finished_at TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_import_jobs_project ON import_jobs(project_id);

            CREATE TABLE IF NOT EXISTS rag_debug_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                project_id INTEGER,
                model_id INTEGER,
                query TEXT NOT NULL,
                retrieval_mode TEXT NOT NULL,
                top_k INTEGER NOT NULL,
                similarity_threshold REAL NOT NULL DEFAULT 0,
                retrieved_count INTEGER NOT NULL DEFAULT 0,
                retrieval_ms INTEGER NOT NULL DEFAULT 0,
                generation_ms INTEGER NOT NULL DEFAULT 0,
                citations_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_rag_logs_project ON rag_debug_logs(project_id);

            CREATE TABLE IF NOT EXISTS message_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                rating INTEGER NOT NULL DEFAULT 0,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);

            CREATE TABLE IF NOT EXISTS eval_cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER,
                question TEXT NOT NULL,
                expected_answer TEXT NOT NULL DEFAULT '',
                expected_document TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS eval_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id INTEGER NOT NULL,
                project_id INTEGER,
                model_id INTEGER,
                model_preset_id INTEGER,
                model_snapshot_json TEXT NOT NULL DEFAULT '{}',
                answer TEXT NOT NULL DEFAULT '',
                citations_json TEXT NOT NULL DEFAULT '[]',
                retrieval_score REAL NOT NULL DEFAULT 0,
                answer_score REAL NOT NULL DEFAULT 0,
                latency_ms INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(case_id) REFERENCES eval_cases(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL,
                FOREIGN KEY(model_preset_id) REFERENCES model_presets(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS system_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL DEFAULT 'info',
                area TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL,
                detail_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                workspace_role TEXT NOT NULL DEFAULT 'member',
                disabled INTEGER NOT NULL DEFAULT 0,
                last_login_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

            CREATE TABLE IF NOT EXISTS auth_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                device_name TEXT NOT NULL DEFAULT '',
                user_agent TEXT NOT NULL DEFAULT '',
                ip_address TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                expires_at TEXT,
                last_seen_at TEXT,
                revoked_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);

            CREATE TABLE IF NOT EXISTS project_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'viewer',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(project_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

            CREATE TABLE IF NOT EXISTS team_invitations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                workspace_role TEXT NOT NULL DEFAULT 'member',
                project_role TEXT NOT NULL DEFAULT 'viewer',
                project_ids_json TEXT NOT NULL DEFAULT '[]',
                invite_token TEXT NOT NULL UNIQUE,
                message TEXT NOT NULL DEFAULT '',
                invited_by_user_id INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT,
                accepted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email);
            CREATE INDEX IF NOT EXISTS idx_team_invitations_status ON team_invitations(status);

            CREATE TABLE IF NOT EXISTS sync_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
                include_globs TEXT NOT NULL DEFAULT '',
                exclude_globs TEXT NOT NULL DEFAULT '',
                delete_missing INTEGER NOT NULL DEFAULT 0,
                last_scan_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                last_summary_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sync_sources_project ON sync_sources(project_id);

            CREATE TABLE IF NOT EXISTS sync_source_documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_source_id INTEGER NOT NULL,
                document_id INTEGER,
                relative_path TEXT NOT NULL,
                source_mtime REAL NOT NULL DEFAULT 0,
                source_size INTEGER NOT NULL DEFAULT 0,
                checksum TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'ready',
                error TEXT NOT NULL DEFAULT '',
                last_seen_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(sync_source_id) REFERENCES sync_sources(id) ON DELETE CASCADE,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL,
                UNIQUE(sync_source_id, relative_path)
            );

            CREATE INDEX IF NOT EXISTS idx_sync_source_documents_source ON sync_source_documents(sync_source_id);
            CREATE INDEX IF NOT EXISTS idx_sync_source_documents_document ON sync_source_documents(document_id);
            """
        )

        ensure_column(conn, "projects", "chunk_size", "chunk_size INTEGER NOT NULL DEFAULT 1200")
        ensure_column(conn, "projects", "chunk_overlap", "chunk_overlap INTEGER NOT NULL DEFAULT 160")
        ensure_column(conn, "projects", "retrieval_top_k", "retrieval_top_k INTEGER NOT NULL DEFAULT 5")
        ensure_column(conn, "projects", "retrieval_mode", "retrieval_mode TEXT NOT NULL DEFAULT 'hybrid'")
        ensure_column(conn, "projects", "retrieval_scope", "retrieval_scope TEXT NOT NULL DEFAULT 'focused'")
        ensure_column(conn, "projects", "similarity_threshold", "similarity_threshold REAL NOT NULL DEFAULT 0")
        ensure_column(conn, "projects", "query_rewrite_enabled", "query_rewrite_enabled INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "projects", "rerank_enabled", "rerank_enabled INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "projects", "agent_tools_enabled", "agent_tools_enabled INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "projects", "full_context_limit", "full_context_limit INTEGER NOT NULL DEFAULT 20")
        ensure_column(conn, "projects", "metadata_filter_json", "metadata_filter_json TEXT NOT NULL DEFAULT '{}'")
        ensure_column(conn, "projects", "embedding_model_id", "embedding_model_id INTEGER")
        ensure_column(conn, "projects", "rerank_model_id", "rerank_model_id INTEGER")

        ensure_column(conn, "documents", "checksum", "checksum TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "documents", "version", "version INTEGER NOT NULL DEFAULT 1")
        ensure_column(conn, "documents", "parent_document_id", "parent_document_id INTEGER")
        ensure_column(conn, "documents", "metadata_json", "metadata_json TEXT NOT NULL DEFAULT '{}'")
        ensure_column(conn, "documents", "updated_at", "updated_at TEXT")
        ensure_column(conn, "documents", "last_indexed_at", "last_indexed_at TEXT")

        ensure_column(conn, "chunks", "parent_chunk_id", "parent_chunk_id INTEGER")
        ensure_column(conn, "chunks", "section_path", "section_path TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "chunks", "start_char", "start_char INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "chunks", "end_char", "end_char INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "chunks", "vector_model_id", "vector_model_id INTEGER")
        ensure_column(conn, "chunks", "metadata_json", "metadata_json TEXT NOT NULL DEFAULT '{}'")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_checksum ON documents(project_id, checksum)")

        ensure_column(conn, "model_configs", "model_type", "model_type TEXT NOT NULL DEFAULT 'chat'")
        ensure_column(conn, "model_configs", "context_window", "context_window INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "model_configs", "supports_tools", "supports_tools INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "model_configs", "supports_vision", "supports_vision INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "model_configs", "last_test_status", "last_test_status TEXT NOT NULL DEFAULT 'untested'")
        ensure_column(conn, "model_configs", "last_test_latency_ms", "last_test_latency_ms INTEGER")
        ensure_column(conn, "model_configs", "last_test_error", "last_test_error TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "model_configs", "last_test_at", "last_test_at TEXT")

        ensure_column(conn, "conversations", "model_preset_id", "model_preset_id INTEGER")
        ensure_column(conn, "model_usage", "model_preset_id", "model_preset_id INTEGER")
        ensure_column(conn, "eval_runs", "model_preset_id", "model_preset_id INTEGER")
        ensure_column(conn, "eval_runs", "model_snapshot_json", "model_snapshot_json TEXT NOT NULL DEFAULT '{}'")
        ensure_column(conn, "users", "workspace_role", "workspace_role TEXT NOT NULL DEFAULT 'member'")

        now = now_iso()
        conn.execute(
            """
            INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at)
            VALUES (1, 'Personal Projects', 'Store project requirements, delivery notes, technical decisions, retrospectives, and reusable experience.', ?, ?)
            """,
            (now, now),
        )

        existing_names = {
            row["name"]
            for row in conn.execute("SELECT name FROM model_configs").fetchall()
        }
        for config in DEFAULT_MODEL_CONFIGS:
            if config["name"] in existing_names:
                continue
            conn.execute(
                """
                INSERT INTO model_configs
                (name, provider, model, base_url, api_key, temperature, enabled, is_default, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    config["name"],
                    config["provider"],
                    config["model"],
                    config["base_url"],
                    config["api_key"],
                    config["temperature"],
                    config["enabled"],
                    config["is_default"],
                    now,
                    now,
                ),
            )

        cleanup_legacy_seeded_models(conn)
        cleanup_duplicate_model_configs(conn)
        normalize_model_defaults(conn)
