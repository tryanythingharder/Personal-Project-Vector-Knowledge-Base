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
    {
        "name": "Ollama Qwen 2.5",
        "provider": "ollama",
        "model": "qwen2.5:7b",
        "base_url": "http://localhost:11434",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "OpenAI GPT-4.1 Mini",
        "provider": "openai_compatible",
        "model": "gpt-4.1-mini",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "DeepSeek Chat",
        "provider": "openai_compatible",
        "model": "deepseek-chat",
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "Claude Sonnet",
        "provider": "anthropic",
        "model": "claude-3-5-sonnet-latest",
        "base_url": "https://api.anthropic.com/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "Gemini Flash",
        "provider": "google",
        "model": "gemini-1.5-flash",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "Qwen Plus",
        "provider": "openai_compatible",
        "model": "qwen-plus",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "Kimi",
        "provider": "openai_compatible",
        "model": "moonshot-v1-8k",
        "base_url": "https://api.moonshot.cn/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
    {
        "name": "OpenRouter",
        "provider": "openai_compatible",
        "model": "openai/gpt-4.1-mini",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": 0,
        "is_default": 0,
    },
]


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
