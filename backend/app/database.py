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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
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
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                vector_json TEXT NOT NULL,
                char_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
            CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);

            CREATE TABLE IF NOT EXISTS model_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                base_url TEXT NOT NULL DEFAULT '',
                api_key TEXT NOT NULL DEFAULT '',
                temperature REAL NOT NULL DEFAULT 0.2,
                enabled INTEGER NOT NULL DEFAULT 1,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                project_id INTEGER,
                model_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
                FOREIGN KEY(model_id) REFERENCES model_configs(id) ON DELETE SET NULL
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
            """
        )

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
        normalize_model_defaults(conn)
