# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex 是一个面向个人项目沉淀的知识库 Agent 系统，支持文档入库、向量检索、RAG 问答、多模型切换、聊天记录、项目共享与远程部署。

它的目标不是单纯做一个“文档上传工具”，而是把你做过的项目资料沉淀成一个可检索、可追问、可长期复用的个人项目大脑。

## 项目特性

- 文档上传、文件夹导入与知识库入库
- 文件夹监听同步
- 向量检索与 RAG 问答
- 引用证据与命中片段预览
- 多模型接入与聊天切换
- 模型预设与用量统计
- 会话历史保存
- 工作区邀请、角色分级与项目共享
- 本地模式与远程后端模式
- Docker / Docker Compose 部署

## 使用场景

Kortex 适合整理和复用以下项目资料：

- 项目源码
- README 与接口文档
- 需求文档与设计说明
- 数据库设计与部署文档
- 交付材料与运维记录
- 客户反馈与项目复盘

## 技术栈

- Desktop: Electron
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + Python
- Packaging: PyInstaller + electron-builder + NSIS
- Database: SQLite
- Production Path: PostgreSQL + pgvector / Qdrant

## 项目结构

```text
frontend/   React 前端
backend/    FastAPI 后端
electron/   桌面壳
docs/       项目文档
assets/     静态资源
```

## 快速开始

### 1. 安装依赖

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
```

### 2. 启动前后端开发模式

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

## 安装包构建

```powershell
npm.cmd run build:desktop
```

输出位置：

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

### 生产部署

项目提供以下部署文件：

- `docker-compose.yml`
- `docker-compose.prod.yml`

可用于远程后端部署、持久化数据与向量服务接入。

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

## 文档

- [贡献指南](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
- [English README](README.en.md)

## 路线图

- 检索质量持续优化
- 生产级数据库与向量存储接入
- 自动更新与版本回滚
- 更完整的团队协作能力
- 更完善的评测与观测能力

## 参与贡献

欢迎通过 Issue 和 Pull Request 参与项目改进。开始前建议先阅读：

- [CONTRIBUTING.md](CONTRIBUTING.md)

## 联系方式

- QQ: `1062147677`

## License

[MIT](LICENSE)
