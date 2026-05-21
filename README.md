# Kortex

[简体中文](README.md) | [English](README.en.md)

Kortex 是一个面向个人项目沉淀与长期复用的知识库 Agent 系统。它把“项目文件归档、向量检索、RAG 问答、模型切换、协作共享、远程部署”放进同一套产品里，目标不是做一个笨重的后台，而是做一个能长期陪你整理项目记忆的工作台。

我现在也把这个项目公开出来，欢迎一起参与开发、提建议、提 Issue、提 PR。

联系方式：

- QQ：`1062147677`

## 项目定位

这个项目更适合下面这类场景：

- 沉淀自己做过的项目资料
- 上传项目源码、需求文档、部署文档、交付说明、复盘记录
- 用自然语言快速追问“这个项目当时怎么部署”“这个模块为什么这样设计”
- 在多设备之间共用同一套知识库
- 后续部署到自己的服务器上，桌面端只负责连接和使用

## 当前能力

### 1. 知识库导入与生命周期

- 支持上传文件、文件夹
- 支持项目资料的预览、切片、向量化入库
- 支持查看文档状态、跳过原因、失败原因
- 支持重试、重新索引、批量删除
- 支持文件夹监听同步
- 支持导入后摘要，说明本次新增、更新、重复、失败了什么

### 2. RAG 问答

- 基于知识库做检索增强问答
- 支持引用证据、命中文档、命中段落查看
- 支持 Focused / Full Context 两种检索范围
- 支持检索调试、检索日志、评测台
- 对话支持流式状态展示，如思考中、检索中、输出中

### 3. 模型管理

- 支持 OpenAI-compatible 平台
- 支持 OpenAI / DeepSeek / Qwen / Kimi / OpenRouter
- 支持 Anthropic Claude
- 支持 Google Gemini
- 支持 Ollama 本地模型
- 支持“平台 -> 拉取模型 -> 勾选加入聊天切换器”的极简配置方式
- 支持默认模型设置、模型测试、模型可用性检查
- 支持模型用量、Token 消耗、费用估算
- 支持模型预设：模型 + 系统提示词 + 知识库 + 参数

### 4. 聊天与项目记忆

- 会话历史保存
- 对话中可切换启用模型
- 支持跨项目检索
- 支持项目记忆快捷动作，例如：
  - 生成项目复盘
  - 提取可复用经验
  - 输出面试/简历项目表述
  - 汇总部署步骤
  - 提炼风险与踩坑
  - 输出交付清单

### 5. 协作与权限

- 支持账号登录
- 支持设备会话管理
- 支持邀请成员加入工作区
- 支持工作区角色分级：`owner / admin / member / viewer`
- 支持项目共享
- 支持项目成员角色分级：`owner / editor / viewer`
- 支持邀请码预览、接受邀请、共享项目访问控制

### 6. 远程后端与部署

- 支持本地内置后端
- 支持桌面端连接远程后端
- 支持 Docker / Docker Compose 部署
- 已预留向 PostgreSQL + pgvector / Qdrant 的生产化升级路径

## 技术栈

- Desktop：Electron
- Frontend：React + Vite + TypeScript
- Backend：FastAPI + Python
- Packaging：PyInstaller + electron-builder + NSIS
- Default DB：SQLite
- Production upgrade path：PostgreSQL + pgvector / Qdrant

## 目录结构

```text
frontend/   React 前端
backend/    FastAPI 后端
electron/   桌面壳
docs/       设计与迁移文档
assets/     图标与静态资源
```

## 本地开发启动

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

启动后默认地址：

- 前端：`http://127.0.0.1:5180`
- 后端健康检查：`http://127.0.0.1:8010/api/health`

### 3. 启动桌面开发模式

```powershell
npm.cmd run desktop
```

这个命令会同时启动：

- FastAPI 后端
- Vite 前端
- Electron 桌面窗口

## Windows 安装包构建

```powershell
npm.cmd run build:desktop
```

产物位置：

- `release/Kortex-Setup-0.1.0.exe`

如果安装包从带中文路径的位置启动时出现 NSIS 异常，可先复制到纯英文路径后再运行，例如：

```text
C:\Users\Administrator\Desktop\Kortex-Setup-0.1.0.exe
```

## Docker 部署

### 开发 / 轻量部署

```powershell
docker compose up --build
```

默认访问：

- `http://127.0.0.1:8080`

### 生产版 Compose

项目内提供了：

- `docker-compose.yml`
- `docker-compose.prod.yml`

生产版可接入：

- Qdrant
- 持久化数据目录
- 环境变量鉴权

## 模型配置说明

模型页现在是按“平台连接”来管理，而不是手工一条条硬编码模型。

推荐流程：

1. 选择平台
2. 填写 Base URL
3. 拉取该平台可用模型列表
4. 勾选你希望加入聊天切换器的模型
5. 设置默认启动模型
6. 保存后再配置或更新 API Key

支持的主要来源：

- OpenAI
- DeepSeek
- Qwen
- Kimi
- OpenRouter
- Anthropic Claude
- Google Gemini
- Ollama 本地模型

## 适合入库的内容

- README
- 项目源码
- API 文档
- 数据库设计说明
- 部署步骤
- 运维记录
- 需求文档
- 交付说明
- 客户反馈
- 项目复盘
- 面试项目总结

## 协作开发

欢迎一起把它做成更成熟的开源项目。

你可以通过下面这些方式参与：

- 提交 Issue 报告 Bug
- 提交 PR 完成功能或修复
- 参与 UI / UX 优化
- 参与 RAG 检索质量优化
- 参与远程部署和生产化能力完善

比较欢迎的方向：

- PostgreSQL + pgvector 完整落地
- Qdrant 生产化接入优化
- 自动更新与版本回滚
- 团队协作与更细权限模型
- 全局搜索 / 跨项目项目视图
- 更完整的评测与观测能力

## Roadmap

计划继续完善：

- 全局搜索与项目总览
- 更强的文件监听与自动同步
- 自动更新
- 版本回滚
- 团队共享与协作权限继续细化
- 更完整的生产化部署方案
- 更强的 RAG 质量评测体系

## 联系方式

如果你想一起开发、共建、交流思路，可以直接联系我：

- QQ：`1062147677`

## License

当前仓库默认按公开协作方式维护。正式开源许可证可根据后续协作情况补充为 MIT 或 Apache-2.0。
