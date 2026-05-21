# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex is a knowledge base Agent system for personal project memory. It supports document ingestion, vector retrieval, RAG chat, multi-model switching, conversation history, project sharing, and remote deployment.

The goal is not just to upload files, but to turn your previous projects into a searchable, reusable project memory system.

## Features

- Document upload, folder import, and knowledge base ingestion
- Folder watch and sync
- Vector retrieval and RAG chat
- Evidence citations and chunk preview
- Multi-model integration and chat switching
- Model presets and usage tracking
- Persistent conversation history
- Workspace invitations, role levels, and project sharing
- Local mode and remote backend mode
- Docker / Docker Compose deployment

## Use Cases

Kortex works well for indexing and reusing:

- project source code
- README files and API docs
- requirement documents and design notes
- database design and deployment documentation
- delivery materials and operations notes
- client feedback and retrospectives

## Tech Stack

- Desktop: Electron
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python
- Packaging: PyInstaller + electron-builder + NSIS
- Database: SQLite
- Production Path: PostgreSQL + pgvector / Qdrant

## Project Structure

```text
frontend/   React frontend
backend/    FastAPI backend
electron/   Desktop shell
docs/       Project docs
assets/     Static assets
```

## Quick Start

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

Default URLs:

- Frontend: `http://127.0.0.1:5180`
- Backend: `http://127.0.0.1:8010`
- Health: `http://127.0.0.1:8010/api/health`

### 3. Start Desktop Development Mode

```powershell
npm.cmd run desktop
```

## Build Installer

```powershell
npm.cmd run build:desktop
```

Output:

```text
release/Kortex-Setup-0.1.0.exe
```

## Docker Deployment

### Basic Deployment

```powershell
docker compose up --build
```

Default URL:

```text
http://127.0.0.1:8080
```

### Production Deployment

The repository includes:

- `docker-compose.yml`
- `docker-compose.prod.yml`

These can be used for remote backend deployment, persistent storage, and vector service integration.

## Model Support

Currently supported model sources:

- OpenAI-compatible
- OpenAI
- DeepSeek
- Qwen
- Kimi
- OpenRouter
- Anthropic Claude
- Google Gemini
- Ollama

The Models page follows a simple flow: platform -> fetch models -> select models for the chat switcher.

## Documentation

- [Contributing Guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Chinese README](README.md)

## Roadmap

- Continued retrieval quality improvements
- Production-grade database and vector store integration
- Auto update and rollback
- More complete collaboration features
- Better evaluation and observability

## Contributing

Issues and pull requests are welcome. Please read:

- [CONTRIBUTING.md](CONTRIBUTING.md)

## Contact

- QQ: `1062147677`

## License

[MIT](LICENSE)
