# ProjectVault Agent

一个本地优先的项目知识库 Agent 系统：文档上传、向量化、RAG 问答、多模型切换、聊天记录、后台管理、Electron 桌面入口和 Docker 部署。

## 功能

- 文档入库：支持 `txt`、`md`、`pdf`、`docx`、代码文件和常见配置文件。
- 本地向量化：默认使用离线 hashing 向量检索，不需要 API Key 也能先用。
- RAG 问答：回答会返回引用片段、来源文件和相似度。
- 多模型切换：内置本地检索回答、Ollama 配置，可添加 OpenAI-compatible 接口。
- 聊天记录：会话和消息保存在 SQLite。
- 后台管理：查看项目、文档、切片、会话和模型数量。
- 桌面程序：`npm run desktop` 启动 Electron 可视化桌面壳。
- Docker 部署：`docker compose up --build` 一键跑前后端。

## 本地开发

```powershell
python -m venv .venv
 .\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
npm.cmd run dev
```

访问前端：`http://127.0.0.1:5180`

后端健康检查：`http://127.0.0.1:8010/api/health`

## 桌面版

```powershell
npm.cmd run desktop
```

这个命令会同时启动 FastAPI、Vite 和 Electron 窗口。

## Windows 安装包

```powershell
npm.cmd run build:desktop
```

安装包会生成到 `release/ProjectVault-Agent-Setup-0.1.0.exe`。安装后桌面会出现 `ProjectVault Agent` 快捷方式，应用会自动启动内置后端和可视化界面，不需要手动打开命令行。

## Docker

```powershell
docker compose up --build
```

访问：`http://127.0.0.1:8080`

SQLite 数据和上传文件保存在 Docker volume `kb_data`。

## 连接模型

### Ollama

1. 本机启动 Ollama。
2. 拉取模型，例如 `ollama pull qwen2.5:7b`。
3. 在“模型切换”里启用 `Ollama Qwen`，确认 Base URL 是 `http://localhost:11434`。

### OpenAI-compatible

在“模型切换”里添加：

- Provider: `OpenAI 兼容`
- Model: 例如 `deepseek-chat`、`gpt-4.1-mini`、`qwen-plus`
- Base URL: 对应供应商的 `/v1` 地址
- API Key: 对应密钥

## 建议入库内容

- 做过项目的需求说明、开题报告、任务书、验收材料。
- README、接口文档、数据库设计、部署说明。
- 交付记录、客户修改意见、项目复盘。
- 关键代码片段或模块说明。
