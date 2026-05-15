# Kortex

Kortex is a desktop-first vector knowledge base for personal project memory.
It supports document upload, local vector retrieval, RAG answers, model
switching, conversation history, admin visibility, Docker deployment, and a
Windows installer.

## Features

- Knowledge library: upload `txt`, `md`, `pdf`, `docx`, code files, and common
  configuration files.
- Local-first retrieval: the default hashing retriever works without an API key.
- RAG chat: answers include evidence snippets, source files, and similarity
  scores.
- Mainstream model providers: local evidence answers, Ollama, OpenAI-compatible
  APIs, Anthropic Claude, Google Gemini, DeepSeek, Qwen, Kimi, and OpenRouter.
- Remote backend mode: point the desktop client at a server endpoint so multiple
  devices share the same backend and database.
- Conversation history: sessions and messages are stored in SQLite by default.
- Admin view: inspect project, document, chunk, session, and model counts.
- Desktop shell: Electron launches the packaged FastAPI backend and app UI.
- Docker deployment: run the backend and frontend together for server hosting.

## Local Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
npm.cmd run dev
```

Frontend: `http://127.0.0.1:5180`

Backend health: `http://127.0.0.1:8010/api/health`

## Desktop App

```powershell
npm.cmd run desktop
```

This starts FastAPI, Vite, and the Electron desktop window together.

## Windows Installer

```powershell
npm.cmd run build:desktop
```

The installer is generated at `release/Kortex-Setup-0.1.0.exe`. After
installation, Kortex is available from the desktop shortcut and Start menu.

## Remote Backend

The desktop app can run in two modes:

- Embedded mode: Electron starts the local packaged backend automatically.
- Remote mode: open the Server view and set the API endpoint, for example
  `https://kb.example.com`.

For production server use, deploy the backend with Docker or a process manager
and point every desktop client at the same endpoint. SQLite is fine for a single
small deployment, while PostgreSQL plus pgvector is the recommended next step
for multi-user or larger document collections.

## Docker

```powershell
docker compose up --build
```

Open `http://127.0.0.1:8080`. SQLite data and uploaded files are stored in the
`kb_data` Docker volume.

## Model Setup

### Ollama

1. Start Ollama locally.
2. Pull a model such as `ollama pull qwen2.5:7b`.
3. Enable the Ollama preset in the Models view and confirm the base URL is
   `http://localhost:11434`.

### Cloud Providers

Use the Models view to enable or add providers:

- OpenAI-compatible: OpenAI, DeepSeek, Qwen DashScope compatible mode, Kimi, and
  OpenRouter.
- Anthropic: Claude via the Messages API.
- Google: Gemini via the Generative Language API.

API keys are stored in the local application database for the current backend.
When using a remote backend, configure keys on that shared backend.

## Good Content To Store

- Requirements, proposals, task briefs, acceptance notes, and retrospectives.
- README files, API docs, database designs, deployment notes, and architecture
  decisions.
- Client feedback, change records, and project handoff notes.
- Important code snippets or module explanations.
