# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex 是一个面向个人项目沉淀的知识库 Agent 系统，支持文档入库、向量检索、RAG 问答、模型切换、聊天记录、项目共享与远程部署。

它适合用来整理自己做过的项目资料，例如源码、README、需求文档、部署说明、交付记录和项目复盘，并通过对话方式进行检索和复用。

## 功能特性

- 文档上传与知识库入库
- 文件夹导入与监听同步
- 向量检索与 RAG 问答
- 引用证据与命中片段预览
- 多模型接入与聊天切换
- 模型预设与用量统计
- 聊天记录保存
- 工作区成员邀请与项目共享
- 本地运行与远程后端模式
- Docker / Docker Compose 部署

## 技术栈

- Desktop: Electron
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python
- Packaging: PyInstaller + electron-builder + NSIS
- Database: SQLite
- Production Path: PostgreSQL + pgvector / Qdrant

## 目录结构

```text
frontend/   React 前端
backend/    FastAPI 后端
electron/   桌面壳
docs/       项目文档
assets/     静态资源
```

## 本地开发

### 1. 安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
```

### 2. 启动前后端

```powershell
npm.cmd run dev
```

默认地址：

- Frontend: `http://127.0.0.1:5180`
- Backend: `http://127.0.0.1:8010`
- Health: `http://127.0.0.1:8010/api/health`

### 3. 启动桌面开发模式

```powershell
npm.cmd run desktop
```

## Windows 安装包构建

```powershell
npm.cmd run build:desktop
```

安装包输出位置：

```text
release/Kortex-Setup-0.1.0.exe
```

## Docker 部署

### 基础部署

```powershell
docker compose up --build
```

默认访问地址：

```text
http://127.0.0.1:8080
```

### 生产版部署

项目同时提供：

- `docker-compose.yml`
- `docker-compose.prod.yml`

可用于接入远程后端、持久化数据和向量检索服务。

## 模型支持

当前支持以下模型来源：

- OpenAI-compatible
- OpenAI
- DeepSeek
- Qwen
- Kimi
- OpenRouter
- Anthropic Claude
- Google Gemini
- Ollama

模型页采用“平台 -> 拉取模型 -> 勾选加入聊天切换器”的配置方式。

## 适用内容

适合入库的内容包括：

- 项目源码
- README
- API 文档
- 数据库设计
- 部署说明
- 需求文档
- 交付文档
- 客户反馈
- 项目复盘

## 开发计划

- 检索质量持续优化
- 生产化数据库与向量存储接入
- 自动更新与版本回滚
- 更完整的团队协作能力
- 更完善的评测与观测能力

## 参与贡献

欢迎通过以下方式参与项目：

- 提交 Issue
- 提交 Pull Request
- 参与 UI / UX 优化
- 参与 RAG 与检索效果优化
- 参与部署与工程化完善

## 联系方式

- QQ: `1062147677`

## License

[MIT](LICENSE)
