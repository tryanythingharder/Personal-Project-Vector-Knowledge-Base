# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex is a knowledge base Agent system for personal project memory. It supports document ingestion, vector retrieval, RAG chat, model switching, conversation history, project sharing, and remote deployment.

It is designed for storing and reusing materials from projects you have already built, such as source code, README files, requirement documents, deployment notes, delivery records, and retrospectives.

## Features

- Document upload and knowledge base ingestion
- Folder import and file-watch sync
- Vector retrieval and RAG chat
- Evidence citations and chunk preview
- Multi-model integration and chat switching
- Model presets and usage tracking
- Conversation history
- Workspace invitations and project sharing
- Local mode and remote backend mode
- Docker / Docker Compose deployment

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

Default URLs:

- Frontend: `http://127.0.0.1:5180`
- Backend: `http://127.0.0.1:8010`
- Health: `http://127.0.0.1:8010/api/health`

### 3. Start Desktop Development Mode

```powershell
npm.cmd run desktop
```

## Windows Installer

```powershell
npm.cmd run build:desktop
```

Installer output:

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

## Recommended Content

Recommended content for indexing:

- Source code
- README files
- API documentation
- Database design notes
- Deployment instructions
- Requirement documents
- Delivery documents
- Client feedback
- Project retrospectives

## Roadmap

- Retrieval quality improvements
- Production-grade database and vector store integration
- Auto update and rollback
- More complete collaboration features
- Better evaluation and observability

## Contributing

Contributions are welcome through:

- Issues
- Pull Requests
- UI / UX improvements
- RAG and retrieval quality work
- Deployment and engineering improvements

## Contact

- QQ: `1062147677`

## License

[MIT](LICENSE)
