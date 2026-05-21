# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex is a desktop-first knowledge base Agent system for personal project memory. It brings document ingestion, vector retrieval, RAG chat, model switching, collaboration, and remote deployment into one product so your past projects become reusable knowledge instead of forgotten folders.

This repository is now public and open to outside contributors. Issues, discussions, and pull requests are welcome.

Contact:

- QQ: `1062147677`

## What Kortex Is For

Kortex is especially useful if you want to:

- archive and structure projects you have already delivered
- upload source code, requirement docs, deployment notes, handoff files, and retrospectives
- ask natural-language questions such as “How did I deploy this project?” or “Why was this module designed this way?”
- use the same project memory across multiple devices
- deploy the backend on your own server and keep the desktop app as the client

## Current Capabilities

### 1. Knowledge Base Ingestion and Lifecycle

- upload files and folders
- preview, chunk, vectorize, and index project material
- inspect document status, skip reasons, and failure reasons
- retry failed imports, reindex documents, and batch delete
- folder watch and sync support
- import summary that explains what was added, updated, duplicated, skipped, or failed

### 2. RAG Chat

- retrieval-augmented Q&A over the knowledge base
- evidence citations, hit files, and hit chunk preview
- Focused / Full Context retrieval modes
- retrieval debug view, logs, and evaluation workbench
- streaming state indicators such as thinking, retrieving, and responding

### 3. Model Management

- OpenAI-compatible platform support
- OpenAI / DeepSeek / Qwen / Kimi / OpenRouter
- Anthropic Claude
- Google Gemini
- Ollama local models
- minimal flow: platform -> fetch models -> choose models for the chat switcher
- default model selection, connection checks, and model testing
- token usage and cost estimation
- model presets: model + system prompt + knowledge base + parameters

### 4. Chat and Project Memory

- persistent conversation history
- model switching inside chat
- cross-project retrieval
- project-memory quick actions such as:
  - generate a project retrospective
  - extract reusable lessons
  - produce interview or resume-ready project summaries
  - summarize deployment steps
  - list risks and pitfalls
  - generate delivery checklists

### 5. Collaboration and Permissions

- account login
- device session management
- workspace invitations
- workspace role levels: `owner / admin / member / viewer`
- project sharing
- project member role levels: `owner / editor / viewer`
- invitation preview, invite acceptance, and shared-project access control

### 6. Remote Backend and Deployment

- built-in local backend mode
- desktop client can point to a remote backend
- Docker / Docker Compose deployment
- production upgrade path prepared for PostgreSQL + pgvector or Qdrant

## Tech Stack

- Desktop: Electron
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python
- Packaging: PyInstaller + electron-builder + NSIS
- Default DB: SQLite
- Production upgrade path: PostgreSQL + pgvector / Qdrant

## Project Structure

```text
frontend/   React frontend
backend/    FastAPI backend
electron/   Desktop shell
docs/       Design and migration docs
assets/     Icons and static assets
```

## Local Development

### 1. Install Dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
```

### 2. Start Frontend and Backend

```powershell
npm.cmd run dev
```

Default addresses:

- Frontend: `http://127.0.0.1:5180`
- Backend health: `http://127.0.0.1:8010/api/health`

### 3. Start Desktop Development Mode

```powershell
npm.cmd run desktop
```

This launches:

- FastAPI backend
- Vite frontend
- Electron desktop window

## Windows Installer

```powershell
npm.cmd run build:desktop
```

Output:

- `release/Kortex-Setup-0.1.0.exe`

If NSIS crashes when the installer is launched from a path containing non-ASCII characters, copy it to an ASCII-only path first, for example:

```text
C:\Users\Administrator\Desktop\Kortex-Setup-0.1.0.exe
```

## Docker Deployment

### Lightweight Setup

```powershell
docker compose up --build
```

Default access:

- `http://127.0.0.1:8080`

### Production Compose

This repo includes:

- `docker-compose.yml`
- `docker-compose.prod.yml`

The production compose setup is designed for:

- Qdrant
- persistent storage
- environment-variable auth

## Model Configuration

The Models page is now organized around provider connections rather than hardcoded single-model forms.

Recommended flow:

1. choose a platform
2. enter the Base URL
3. fetch available models from that platform
4. choose which models should appear in the chat switcher
5. select a default startup model
6. save and then configure or update the API key

Main supported providers:

- OpenAI
- DeepSeek
- Qwen
- Kimi
- OpenRouter
- Anthropic Claude
- Google Gemini
- Ollama local models

## Good Content To Store

- README files
- project source code
- API docs
- database design notes
- deployment steps
- operations notes
- requirement docs
- delivery notes
- client feedback
- retrospectives
- project summaries for interviews

## Contributing

I would love to make this a stronger open-source project together.

Good ways to contribute:

- open issues for bugs and product gaps
- submit pull requests
- improve UI / UX
- improve retrieval quality
- help productionize the deployment story

Areas where contributions are especially welcome:

- full PostgreSQL + pgvector implementation
- Qdrant production integration polish
- auto-update and rollback
- richer team collaboration and permission models
- better global search and cross-project views
- stronger evaluation and observability

## Roadmap

Planned improvements include:

- global search and project overview
- stronger file watching and sync automation
- automatic updates
- version rollback
- more complete collaboration and sharing
- stronger production deployment workflows
- more robust RAG evaluation

## Contact

If you want to contribute, collaborate, or discuss ideas:

- QQ: `1062147677`

## License

The repository is currently maintained as a public collaborative project. A formal open-source license such as MIT or Apache-2.0 can be added next as collaboration grows.
