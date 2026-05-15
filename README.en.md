# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex is a desktop-first vector knowledge base for personal project memory. It helps you store requirements, delivery notes, README files, API docs, deployment notes, retrospectives, and important code snippets. It supports document upload, vector retrieval, RAG chat, model switching, conversation history, admin visibility, remote backend mode, and a Windows installer.

## Features

- Knowledge library: upload `txt`, `md`, `pdf`, `docx`, source code, logs, and common configuration files.
- Local-first retrieval: the default hashing retriever works offline and does not require an API key.
- RAG chat: answers include evidence snippets, source files, and similarity scores.
- Model switching: supports local evidence answers, Ollama, OpenAI-compatible APIs, Anthropic Claude, Google Gemini, DeepSeek, Qwen, Kimi, and OpenRouter.
- Remote backend mode: point the desktop client at a server API so multiple devices share one knowledge base and chat history.
- Conversation history: sessions and messages are stored in SQLite by default.
- Admin view: inspect project, document, chunk, session, and model counts.
- Desktop shell: Electron launches the packaged FastAPI backend and app UI.
- Docker deployment: run the backend and frontend together for server hosting.

## Tech Stack

- Desktop: Electron
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python
- Packaging: PyInstaller + electron-builder + NSIS
- Database: SQLite, with PostgreSQL + pgvector as the recommended upgrade path

## Local Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
npm.cmd run dev
```

Frontend: `http://127.0.0.1:5180`

Backend health: `http://127.0.0.1:8010/api/health`

## Desktop Development

```powershell
npm.cmd run desktop
```

This starts FastAPI, Vite, and the Electron desktop window together.

## Windows Installer

```powershell
npm.cmd run build:desktop
```

The installer is generated at `release/Kortex-Setup-0.1.0.exe`. After installation, Kortex is available from the desktop shortcut and Start menu.

> If the NSIS installer crashes when launched from a path containing Chinese characters, copy it to an ASCII-only path first, for example `C:\Users\Administrator\Desktop\Kortex-Setup-0.1.0.exe`.

## Remote Backend

The desktop app can run in two modes:

- Embedded mode: Electron starts the local packaged FastAPI backend automatically.
- Remote mode: open the Server view and set the API endpoint, for example `https://kb.example.com`.

For a personal server deployment, SQLite plus a persistent disk is enough to start. For larger collections, multiple devices, or collaboration, PostgreSQL plus pgvector is the recommended next step.

## Docker

```powershell
docker compose up --build
```

Open `http://127.0.0.1:8080`. SQLite data and uploaded files are stored in the `kb_data` Docker volume.

## Model Setup

The Models view now works as a provider connection manager. Pick OpenAI / GPT, Ollama, DeepSeek, Qwen, Kimi, OpenRouter, Anthropic, or Google, enter the Base URL and optional API key, then click **Fetch model list**. Kortex lists the models returned by that endpoint, and you can choose exactly which models appear in the chat switcher plus the default startup model.

If a provider does not expose a model-list endpoint, add the model id manually. API keys can be added when saving the model or later from the inline editor in the configured model list.

### Ollama

1. Start Ollama locally.
2. Pull a model such as `ollama pull qwen2.5:7b`.
3. Choose Ollama in the Models view and confirm the base URL is `http://localhost:11434`.
4. Click **Fetch model list** and select the local models you want enabled.

### Cloud Providers

Use the Models view to choose or add providers:

- OpenAI-compatible: OpenAI, DeepSeek, Qwen DashScope compatible mode, Kimi, and OpenRouter.
- Anthropic: Claude via the Messages API.
- Google: Gemini via the Generative Language API.

API keys are stored in the current backend database and are not shown in plaintext in the list UI. When using a remote backend, configure keys on that shared backend.

## Good Content To Store

- Requirements, proposals, task briefs, acceptance notes, and retrospectives.
- README files, API docs, database designs, deployment notes, and architecture decisions.
- Client feedback, change records, and project handoff notes.
- Important code snippets or module explanations.
