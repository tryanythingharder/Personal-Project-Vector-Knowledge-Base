# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex 是一个桌面优先的个人项目向量知识库，用来沉淀需求、交付记录、README、接口文档、部署说明、复盘经验和关键代码片段。它支持文档上传、向量化检索、RAG 问答、多模型切换、聊天记录、后台管理、远程后端模式和 Windows 安装包。

## 功能特性

- 文档入库：支持 `txt`、`md`、`pdf`、`docx`、源码、日志和常见配置文件。
- 本地优先检索：默认 hashing 向量检索无需 API Key，可离线使用。
- RAG 问答：回答附带引用片段、来源文件和相似度。
- 多模型切换：支持本地检索回答、Ollama、OpenAI-compatible、Anthropic Claude、Google Gemini、DeepSeek、Qwen、Kimi 和 OpenRouter。
- 远程后端模式：桌面端可指向服务器 API，多台设备共享同一个知识库和聊天记录。
- 聊天记录：会话与消息默认存储在 SQLite。
- 后台管理：查看项目、文档、切片、会话和模型数量。
- 桌面程序：Electron 启动内置 FastAPI 后端和可视化界面。
- Docker 部署：可把后端和前端部署到服务器。

## 技术栈

- Desktop：Electron
- Frontend：React + Vite + TypeScript
- Backend：FastAPI + Python
- Packaging：PyInstaller + electron-builder + NSIS
- Database：SQLite，后续可升级 PostgreSQL + pgvector

## 本地开发

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
npm.cmd run dev
```

前端地址：`http://127.0.0.1:5180`

后端健康检查：`http://127.0.0.1:8010/api/health`

## 桌面开发模式

```powershell
npm.cmd run desktop
```

这个命令会同时启动 FastAPI、Vite 和 Electron 桌面窗口。

## Windows 安装包

```powershell
npm.cmd run build:desktop
```

安装包会生成到 `release/Kortex-Setup-0.1.0.exe`。安装后可以从桌面快捷方式或开始菜单打开 Kortex。

> 如果安装包所在路径包含中文导致 NSIS 安装器异常，可把安装包复制到纯英文路径后再运行，例如 `C:\Users\Administrator\Desktop\Kortex-Setup-0.1.0.exe`。

## 远程后端

Kortex 桌面端支持两种模式：

- 内置模式：Electron 自动启动本机打包后的 FastAPI 后端。
- 远程模式：在桌面端的“服务器”页面填写 API 地址，例如 `https://kb.example.com`。

服务器部署时，可以先用 SQLite + 持久化磁盘满足个人使用。后续如果需要多设备、大规模文档或多人协作，推荐升级为 PostgreSQL + pgvector。

## Docker

```powershell
docker compose up --build
```

访问 `http://127.0.0.1:8080`。SQLite 数据和上传文件会保存在 Docker volume `kb_data`。

## 模型配置

“模型”页面现在按平台管理连接：先选择 OpenAI / GPT、Ollama、DeepSeek、Qwen、Kimi、OpenRouter、Anthropic 或 Google，填写 Base URL 和可选 API Key，然后点击“获取模型列表”。Kortex 会从对应端点拉取可用模型，用户只需要勾选想在聊天框里切换的模型，并选择默认启动模型。

如果某个厂商不支持模型列表接口，也可以手动输入模型 ID。API Key 可以在添加模型时填写，也可以后续在已配置模型列表中行内编辑。

### Ollama

1. 本机启动 Ollama。
2. 拉取模型，例如 `ollama pull qwen2.5:7b`。
3. 在 Kortex 的“模型”页面选择 Ollama，确认 Base URL 为 `http://localhost:11434`。
4. 点击“获取模型列表”，勾选要启用的本地模型。

### 云模型

在“模型”页面选择或新增以下供应商：

- OpenAI-compatible：OpenAI、DeepSeek、Qwen DashScope 兼容模式、Kimi、OpenRouter。
- Anthropic：Claude Messages API。
- Google：Gemini Generative Language API。

API Key 默认保存在当前后端的本地数据库中，不会在界面列表里明文显示。如果使用远程后端，请在共享后端上配置模型密钥。

## 适合入库的内容

- 需求说明、开题报告、任务书、验收记录、复盘总结。
- README、接口文档、数据库设计、部署说明、架构决策。
- 客户反馈、修改记录、交付说明。
- 关键代码片段和模块说明。
