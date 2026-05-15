import {
  Activity,
  Bot,
  Check,
  Cloud,
  Database,
  FileText,
  Globe2,
  HardDrive,
  History,
  Languages,
  Layers3,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Server,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  X,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getApiBase, setApiBase } from './api'
import type { AdminStats, ChatMessage, Citation, ConversationSummary, DiscoveredModel, DocumentItem, ModelConfig, ModelProvider, Project } from './types'

type View = 'chat' | 'knowledge' | 'models' | 'server' | 'admin' | 'settings'
type Language = 'zh' | 'en'

type ModelPlatform = {
  id: string
  name: string
  provider: ModelProvider
  base_url: string
  noteKey: string
  models: string[]
}

type ModelFormState = {
  platformId: string
  provider: ModelProvider
  base_url: string
  api_key: string
  temperature: number
  manual_model: string
  default_model: string
}

type ModelEditDraft = {
  name: string
  provider: ModelProvider
  model: string
  base_url: string
  api_key: string
  temperature: number
  discovered: DiscoveredModel[]
}

const PRODUCT_NAME = 'Kortex'
const LANGUAGE_STORAGE_KEY = 'kortex.language'

const navItems: Array<{ id: Exclude<View, 'settings'>; labelKey: string; icon: typeof MessageSquareText }> = [
  { id: 'chat', labelKey: 'nav.ask', icon: MessageSquareText },
  { id: 'knowledge', labelKey: 'nav.library', icon: Database },
  { id: 'models', labelKey: 'nav.models', icon: Layers3 },
  { id: 'server', labelKey: 'nav.server', icon: Cloud },
  { id: 'admin', labelKey: 'nav.admin', icon: Activity },
]

const translations: Record<Language, Record<string, string>> = {
  zh: {
    'app.subtitle': '项目记忆系统',
    'nav.ask': '问答',
    'nav.library': '知识库',
    'nav.models': '模型',
    'nav.server': '服务器',
    'nav.admin': '后台',
    'nav.settings': '设置',
    'status.online': '在线',
    'status.checking': '检查中',
    'status.offline': '离线',
    'status.local': '内置后端',
    'topbar.workspace': '工作区',
    'project.default': '个人项目',
    'project.all': '全部项目',
    'model.localEvidence': '本地检索回答',
    'model.localRag': '本地 RAG',
    'model.openaiCompatible': 'OpenAI 兼容',
    'model.google': 'Google Gemini',
    'common.refresh': '刷新',
    'common.dismiss': '关闭',
    'common.enabled': '已启用',
    'common.disabled': '已停用',
    'common.default': '默认',
    'common.save': '保存',
    'common.cancel': '取消',
    'chat.sessions': '会话',
    'chat.newThread': '新建会话',
    'chat.emptyTitle': '向你的项目记忆提问',
    'chat.emptyBody': '上传需求、交付记录、README、设计决策和复盘内容后，Kortex 会先检索证据再回答。',
    'chat.prompt.summary': '总结这个项目',
    'chat.prompt.deploy': '查找部署步骤',
    'chat.prompt.lessons': '提取可复用经验',
    'chat.you': '你',
    'chat.loading': '正在检索证据并生成回答',
    'chat.placeholder': '询问项目、决策、模块、部署、问题或经验...',
    'chat.send': '发送',
    'chat.requestFailed': '请求失败',
    'evidence.title': '证据',
    'evidence.empty': '回答后，这里会显示引用片段、来源文件和相似度。',
    'library.ingest': '导入',
    'library.drop': '把项目文件放入记忆库',
    'library.selected': '已选择 {count} 个文件',
    'library.fileTypes': 'txt、md、pdf、docx、源码、日志、配置文件',
    'library.index': '索引文档',
    'library.newProject': '新建项目空间',
    'library.projectName': '项目名称',
    'library.projectDescription': '这个项目空间里要放什么内容？',
    'library.createProject': '创建项目',
    'library.indexedFiles': '已索引文件',
    'library.filesCount': '{count} 个文件',
    'library.chunks': '{count} 个切片',
    'library.deleteDocument': '删除文档',
    'library.empty': '这个项目空间还没有索引文件。',
    'library.documentRemoved': '文档已移除。',
    'library.uploadFailed': '上传失败',
    'library.indexedNotice': '已索引 {count} 个文件。',
    'library.projectCreated': '项目已创建：{name}',
    'models.preset.openai': 'OpenAI API',
    'models.preset.anthropic': 'Claude Messages API',
    'models.preset.google': 'Google AI Studio 密钥',
    'models.preset.compatible': 'OpenAI 兼容',
    'models.preset.qwen': 'DashScope 兼容模式',
    'models.preset.kimi': 'Moonshot 兼容 API',
    'models.preset.openrouter': '连接多种托管模型',
    'models.preset.ollama': '本地私有模型',
    'models.endpoint': '模型端点',
    'models.displayName': '显示名称',
    'models.providerLabel': '平台协议',
    'models.provider.local': '本地检索回答',
    'models.provider.ollama': 'Ollama',
    'models.provider.openai': 'OpenAI 兼容',
    'models.provider.anthropic': 'Anthropic Claude',
    'models.provider.google': 'Google Gemini',
    'models.modelId': '模型 ID',
    'models.baseUrl': 'Base URL',
    'models.apiKey': 'API Key',
    'models.temperature': 'Temperature',
    'models.save': '保存模型',
    'models.configured': '已配置模型',
    'models.endpointCount': '{count} 个端点',
    'models.saved': '模型已保存：{name}',
    'models.title': '模型连接',
    'models.subtitle': '按平台连接端点，拉取可用模型，然后把常用模型加入聊天切换器。',
    'models.platforms': '平台',
    'models.connection': '连接',
    'models.discovery': '可用模型',
    'models.discover': '获取模型列表',
    'models.discovering': '正在获取',
    'models.discoveredCount': '发现 {count} 个模型',
    'models.manualModel': '手动输入模型 ID',
    'models.addManual': '加入列表',
    'models.saveSelected': '添加选中模型',
    'models.selectedCount': '已选择 {count} 个',
    'models.defaultStartup': '默认启动模型',
    'models.defaultStartupPlaceholder': '选择一个默认模型',
    'models.noDiscovered': '输入 Base URL 和密钥后获取模型；如果厂商不支持列表接口，也可以手动输入模型 ID。',
    'models.apiKeyHint': '密钥只写入后端数据库，列表中不会明文显示。留空保存时可后续编辑。',
    'models.keySet': '已保存密钥',
    'models.keyMissing': '未设置密钥',
    'models.edit': '编辑',
    'models.delete': '删除',
    'models.refreshOne': '重新获取',
    'models.savedBatch': '已更新 {count} 个模型。',
    'models.updated': '模型已更新。',
    'models.deleted': '模型已删除。',
    'models.emptyConfigured': '还没有可切换模型。先选择平台并添加模型。',
    'models.endpointGroup': '{provider} / {base}',
    'server.eyebrow': '共享后端模式',
    'server.title': '让每台设备指向同一个知识库。',
    'server.body': '后端部署到你的服务器后，桌面端只需要填写 API 地址，就能共用同一批文档、模型配置和聊天记录。',
    'server.localMode': '本地内置后端',
    'server.remoteMode': '远程 API 后端',
    'server.endpoint': '后端地址',
    'server.placeholder': 'https://kb.your-domain.com，留空则使用本地',
    'server.save': '保存地址',
    'server.test': '测试',
    'server.savedRemote': '远程服务器已保存，后续 API 请求会使用这个后端。',
    'server.savedLocal': '已切回内置本地后端。',
    'server.testOk': '服务器连接成功。',
    'server.testFailed': '服务器测试失败',
    'server.localNote': '这个地址只保存在当前桌面端本机，不会改写已安装程序。',
    'server.notes': '部署备注',
    'server.note1': '服务器端可用 Docker Compose 或进程管理器运行 FastAPI 后端，并通过 Nginx、Caddy 或云负载均衡提供 HTTPS。',
    'server.note2': '把 KB_DATA_DIR 放在持久化磁盘上，保证上传文件、SQLite 数据和向量结果不会随部署丢失。',
    'server.note3': '后续多设备或多人协作时，可以把 SQLite 升级为 PostgreSQL + pgvector，桌面端不需要大改。',
    'admin.projects': '项目',
    'admin.documents': '文档',
    'admin.chunks': '切片',
    'admin.conversations': '会话',
    'admin.models': '模型',
    'admin.recentDocuments': '最近文档',
    'admin.recentSessions': '最近会话',
    'settings.title': '设置',
    'settings.language': '界面语言',
    'settings.languageNote': '语言偏好会保存在当前桌面端。',
    'settings.chinese': '中文',
    'settings.english': 'English',
    'settings.currentBackend': '当前后端',
    'settings.backendLocal': '内置本地后端',
  },
  en: {
    'app.subtitle': 'Project memory OS',
    'nav.ask': 'Ask',
    'nav.library': 'Library',
    'nav.models': 'Models',
    'nav.server': 'Server',
    'nav.admin': 'Admin',
    'nav.settings': 'Settings',
    'status.online': 'Online',
    'status.checking': 'Checking',
    'status.offline': 'Offline',
    'status.local': 'Bundled backend',
    'topbar.workspace': 'Workspace',
    'project.default': 'Personal Projects',
    'project.all': 'All projects',
    'model.localEvidence': 'Local Evidence Answer',
    'model.localRag': 'Local RAG',
    'model.openaiCompatible': 'OpenAI-compatible',
    'model.google': 'Google Gemini',
    'common.refresh': 'Refresh',
    'common.dismiss': 'Dismiss',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'common.default': 'Default',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'chat.sessions': 'Sessions',
    'chat.newThread': 'New thread',
    'chat.emptyTitle': 'Ask across your project memory',
    'chat.emptyBody': 'Upload requirements, handoff notes, README files, design decisions, and retrospectives. Kortex will retrieve the closest evidence before answering.',
    'chat.prompt.summary': 'Summarize this project',
    'chat.prompt.deploy': 'Find deployment steps',
    'chat.prompt.lessons': 'Extract reusable lessons',
    'chat.you': 'You',
    'chat.loading': 'Retrieving evidence and composing an answer',
    'chat.placeholder': 'Ask about a project, decision, module, deployment, bug, or lesson learned...',
    'chat.send': 'Send',
    'chat.requestFailed': 'Request failed',
    'evidence.title': 'Evidence',
    'evidence.empty': 'Cited chunks, source files, and similarity scores appear here after an answer.',
    'library.ingest': 'Ingest',
    'library.drop': 'Drop project files into memory',
    'library.selected': '{count} file(s) selected',
    'library.fileTypes': 'txt, md, pdf, docx, source code, logs, config files',
    'library.index': 'Index documents',
    'library.newProject': 'New project space',
    'library.projectName': 'Project name',
    'library.projectDescription': 'What belongs in this project?',
    'library.createProject': 'Create project',
    'library.indexedFiles': 'Indexed files',
    'library.filesCount': '{count} file(s)',
    'library.chunks': '{count} chunks',
    'library.deleteDocument': 'Delete document',
    'library.empty': 'This project space does not have indexed files yet.',
    'library.documentRemoved': 'Document removed.',
    'library.uploadFailed': 'Upload failed',
    'library.indexedNotice': 'Indexed {count} file(s).',
    'library.projectCreated': 'Project created: {name}',
    'models.preset.openai': 'OpenAI API',
    'models.preset.anthropic': 'Claude Messages API',
    'models.preset.google': 'Google AI Studio key',
    'models.preset.compatible': 'OpenAI-compatible',
    'models.preset.qwen': 'DashScope compatible mode',
    'models.preset.kimi': 'Moonshot compatible API',
    'models.preset.openrouter': 'Route to many hosted models',
    'models.preset.ollama': 'Private local model',
    'models.endpoint': 'Model endpoint',
    'models.displayName': 'Display name',
    'models.providerLabel': 'Provider protocol',
    'models.provider.local': 'Local evidence answer',
    'models.provider.ollama': 'Ollama',
    'models.provider.openai': 'OpenAI-compatible',
    'models.provider.anthropic': 'Anthropic Claude',
    'models.provider.google': 'Google Gemini',
    'models.modelId': 'Model id',
    'models.baseUrl': 'Base URL',
    'models.apiKey': 'API key',
    'models.temperature': 'Temperature',
    'models.save': 'Save model',
    'models.configured': 'Configured models',
    'models.endpointCount': '{count} endpoint(s)',
    'models.saved': 'Model saved: {name}',
    'models.title': 'Model connections',
    'models.subtitle': 'Connect a provider endpoint, discover available models, then add the models you want in the chat switcher.',
    'models.platforms': 'Platforms',
    'models.connection': 'Connection',
    'models.discovery': 'Available models',
    'models.discover': 'Fetch model list',
    'models.discovering': 'Fetching',
    'models.discoveredCount': '{count} model(s) found',
    'models.manualModel': 'Manual model id',
    'models.addManual': 'Add to list',
    'models.saveSelected': 'Add selected models',
    'models.selectedCount': '{count} selected',
    'models.defaultStartup': 'Default startup model',
    'models.defaultStartupPlaceholder': 'Choose a default model',
    'models.noDiscovered': 'Enter a Base URL and key to fetch models. If a provider does not expose a list endpoint, add a model id manually.',
    'models.apiKeyHint': 'Keys are stored only in the backend database and never shown in the list. You can save models now and add the key later.',
    'models.keySet': 'Key saved',
    'models.keyMissing': 'No key',
    'models.edit': 'Edit',
    'models.delete': 'Delete',
    'models.refreshOne': 'Fetch again',
    'models.savedBatch': 'Updated {count} model(s).',
    'models.updated': 'Model updated.',
    'models.deleted': 'Model deleted.',
    'models.emptyConfigured': 'No switchable models yet. Pick a platform and add models first.',
    'models.endpointGroup': '{provider} / {base}',
    'server.eyebrow': 'Shared backend mode',
    'server.title': 'Point every device at the same knowledge base.',
    'server.body': 'Deploy the FastAPI backend on your server, then set this desktop app to that API URL. Your devices will share documents, model settings, and chat history.',
    'server.localMode': 'Local bundled backend',
    'server.remoteMode': 'Remote API backend',
    'server.endpoint': 'Backend endpoint',
    'server.placeholder': 'https://kb.your-domain.com or leave empty for local',
    'server.save': 'Save endpoint',
    'server.test': 'Test',
    'server.savedRemote': 'Remote server saved. All API calls now use that backend.',
    'server.savedLocal': 'Switched back to the bundled local backend.',
    'server.testOk': 'Server connection succeeded.',
    'server.testFailed': 'Server test failed',
    'server.localNote': 'The desktop app stores this endpoint locally. It does not rewrite the installed app.',
    'server.notes': 'Deployment notes',
    'server.note1': 'Run the backend on your server with Docker Compose or a process manager and expose HTTPS through Nginx, Caddy, or a cloud load balancer.',
    'server.note2': 'Keep KB_DATA_DIR on a persistent disk so uploads, SQLite data, and vectors survive redeploys.',
    'server.note3': 'For team or multi-device scale, replace SQLite with PostgreSQL plus pgvector while keeping the desktop client unchanged.',
    'admin.projects': 'Projects',
    'admin.documents': 'Documents',
    'admin.chunks': 'Chunks',
    'admin.conversations': 'Threads',
    'admin.models': 'Models',
    'admin.recentDocuments': 'Recent documents',
    'admin.recentSessions': 'Recent sessions',
    'settings.title': 'Settings',
    'settings.language': 'Interface language',
    'settings.languageNote': 'Language preference is saved on this desktop client.',
    'settings.chinese': '中文',
    'settings.english': 'English',
    'settings.currentBackend': 'Current backend',
    'settings.backendLocal': 'Bundled local backend',
  },
}

const providerLabels: Record<ModelProvider, string> = {
  local: 'model.localRag',
  ollama: 'Ollama',
  openai_compatible: 'model.openaiCompatible',
  anthropic: 'Anthropic',
  google: 'model.google',
}

const modelPlatforms: ModelPlatform[] = [
  {
    id: 'openai',
    name: 'OpenAI / GPT',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    noteKey: 'models.preset.openai',
    models: ['gpt-5.2', 'gpt-5.1', 'gpt-4.1', 'gpt-4.1-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    noteKey: 'models.preset.anthropic',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-3-5-sonnet-latest'],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    provider: 'google',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    noteKey: 'models.preset.google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'openai_compatible',
    base_url: 'https://api.deepseek.com/v1',
    noteKey: 'models.preset.compatible',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'qwen',
    name: 'Qwen / DashScope',
    provider: 'openai_compatible',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    noteKey: 'models.preset.qwen',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
  },
  {
    id: 'kimi',
    name: 'Kimi / Moonshot',
    provider: 'openai_compatible',
    base_url: 'https://api.moonshot.cn/v1',
    noteKey: 'models.preset.kimi',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openai_compatible',
    base_url: 'https://openrouter.ai/api/v1',
    noteKey: 'models.preset.openrouter',
    models: ['openai/gpt-5.2', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    provider: 'ollama',
    base_url: 'http://localhost:11434',
    noteKey: 'models.preset.ollama',
    models: ['qwen2.5:7b', 'llama3.2', 'gemma3'],
  },
  {
    id: 'compatible',
    name: 'OpenAI Compatible',
    provider: 'openai_compatible',
    base_url: '',
    noteKey: 'models.preset.compatible',
    models: ['model-id'],
  },
  {
    id: 'local',
    name: 'Local RAG',
    provider: 'local',
    base_url: '',
    noteKey: 'models.provider.local',
    models: ['extractive-rag'],
  },
]

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function normalizeApiBase(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'zh'
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh'
}

function App() {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage)
  const [activeView, setActiveView] = useState<View>('chat')
  const [projects, setProjects] = useState<Project[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [models, setModels] = useState<ModelConfig[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number>(1)
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>()
  const [conversationId, setConversationId] = useState<number | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [notice, setNotice] = useState('')
  const [, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [files, setFiles] = useState<FileList | null>(null)
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase())
  const [connectionState, setConnectionState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [newProject, setNewProject] = useState({ name: '', description: '' })
  const [modelForm, setModelForm] = useState<ModelFormState>({
    platformId: 'openai',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    temperature: 0.2,
    manual_model: '',
    default_model: '',
  })
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>(() => modelPlatforms[0].models.map((id) => ({ id, name: id })))
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState<string[]>([])
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false)
  const [editingModelId, setEditingModelId] = useState<number | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<number, ModelEditDraft>>({})
  const [refreshingModelId, setRefreshingModelId] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      let value = translations[language][key] ?? key
      if (values) {
        Object.entries(values).forEach(([name, replacement]) => {
          value = value.replace(`{${name}}`, String(replacement))
        })
      }
      return value
    },
    [language],
  )

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
    document.documentElement.lang = nextLanguage === 'zh' ? 'zh-CN' : 'en'
  }, [])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  const displayProjectName = useCallback(
    (name?: string | null, fallbackKey = 'project.default') => {
      if (!name) return t(fallbackKey)
      if (language === 'zh' && name === 'Personal Projects') return t('project.default')
      return name
    },
    [language, t],
  )

  const displayModelName = useCallback(
    (name?: string | null) => {
      if (!name) return PRODUCT_NAME
      if (language === 'zh' && name === 'Local Evidence Answer') return t('model.localEvidence')
      return name
    },
    [language, t],
  )

  const providerLabel = useCallback(
    (provider: ModelProvider) => {
      const label = providerLabels[provider]
      return label ? t(label) : provider
    },
    [t],
  )

  const modelOptionLabel = useCallback(
    (model: ModelConfig) => `${providerLabel(model.provider)} / ${model.model}`,
    [providerLabel],
  )

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  )
  const enabledModels = useMemo(() => models.filter((model) => model.enabled), [models])
  const selectedModel = useMemo(
    () => enabledModels.find((model) => model.id === selectedModelId) ?? enabledModels.find((model) => model.is_default) ?? enabledModels[0],
    [enabledModels, selectedModelId],
  )
  const activePlatform = useMemo(
    () => modelPlatforms.find((platform) => platform.id === modelForm.platformId) ?? modelPlatforms[0],
    [modelForm.platformId],
  )
  const latestCitations = useMemo(() => {
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.citations?.length)
    return assistant?.citations ?? []
  }, [messages])

  const refreshAll = useCallback(async () => {
    setConnectionState('checking')
    const [projectData, modelData, conversationData, statsData] = await Promise.all([
      api.projects(),
      api.models(),
      api.conversations(),
      api.stats(),
    ])
    setProjects(projectData)
    setModels(modelData)
    setConversations(conversationData)
    setStats(statsData)
    const defaultProjectId = selectedProjectId || projectData[0]?.id || 1
    setSelectedProjectId(defaultProjectId)
    setSelectedModelId((current) => current ?? modelData.find((model) => model.enabled && model.is_default)?.id ?? modelData.find((model) => model.enabled)?.id)
    setDocuments(await api.documents(defaultProjectId))
    setConnectionState('online')
  }, [selectedProjectId])

  useEffect(() => {
    refreshAll()
      .catch((error) => {
        setConnectionState('offline')
        setNotice(error.message)
      })
      .finally(() => setIsLoading(false))
  }, [refreshAll])

  useEffect(() => {
    if (!selectedProjectId) return
    api.documents(selectedProjectId).then(setDocuments).catch((error) => setNotice(error.message))
  }, [selectedProjectId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    if (!newProject.name.trim()) return
    const created = await api.createProject(newProject)
    setNewProject({ name: '', description: '' })
    setSelectedProjectId(created.id)
    setNotice(t('library.projectCreated', { name: created.name }))
    await refreshAll()
  }

  async function handleUpload() {
    if (!files?.length || !selectedProject) return
    setIsUploading(true)
    try {
      const result = await api.uploadDocuments(selectedProject.id, files)
      setFiles(null)
      setNotice(t('library.indexedNotice', { count: result.uploaded.length }))
      await refreshAll()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('library.uploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDeleteDocument(id: number) {
    await api.deleteDocument(id)
    setNotice(t('library.documentRemoved'))
    await refreshAll()
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    const content = question.trim()
    if (!content || isSending) return
    setQuestion('')
    setIsSending(true)
    setMessages((current) => [...current, { role: 'user', content }])
    try {
      const response = await api.chat({
        message: content,
        project_id: selectedProject?.id,
        model_id: selectedModel?.id,
        conversation_id: conversationId,
        top_k: 5,
      })
      setConversationId(response.conversation_id)
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: response.answer,
          citations: response.citations as Citation[],
        },
      ])
      await refreshAll()
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: error instanceof Error ? `${t('chat.requestFailed')}: ${error.message}` : `${t('chat.requestFailed')}.`,
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function handleLoadConversation(id: number) {
    const detail = await api.conversation(id)
    setConversationId(id)
    setMessages(detail.messages)
    if (detail.project_id) setSelectedProjectId(detail.project_id)
    setActiveView('chat')
  }

  function seedPlatformModels(platform: ModelPlatform) {
    return platform.models.map((id) => ({ id, name: id }))
  }

  function uniqueDiscovered(items: DiscoveredModel[]) {
    const seen = new Set<string>()
    return items.filter((item) => {
      const id = item.id.trim()
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }

  function selectModelPlatform(platform: ModelPlatform) {
    const seeded = seedPlatformModels(platform)
    setModelForm({
      platformId: platform.id,
      provider: platform.provider,
      base_url: platform.base_url,
      api_key: '',
      temperature: 0.2,
      manual_model: '',
      default_model: seeded[0]?.id ?? '',
    })
    setDiscoveredModels(seeded)
    setSelectedDiscoveryIds([])
  }

  async function handleDiscoverModels() {
    setIsDiscoveringModels(true)
    try {
      const response = await api.discoverModels({
        provider: modelForm.provider,
        base_url: modelForm.base_url,
        api_key: modelForm.api_key,
      })
      const found = uniqueDiscovered(response.models)
      setDiscoveredModels(found)
      setSelectedDiscoveryIds([])
      setModelForm((current) => ({ ...current, default_model: found[0]?.id ?? '' }))
      setNotice(t('models.discoveredCount', { count: found.length }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('chat.requestFailed'))
    } finally {
      setIsDiscoveringModels(false)
    }
  }

  function toggleDiscoveredModel(modelId: string) {
    setSelectedDiscoveryIds((current) => {
      const next = current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId]
      setModelForm((form) => {
        if (next.length === 0) return { ...form, default_model: '' }
        if (next.includes(form.default_model)) return form
        return { ...form, default_model: next[0] }
      })
      return next
    })
  }

  function handleAddManualModel() {
    const modelId = modelForm.manual_model.trim()
    if (!modelId) return
    setDiscoveredModels((current) => uniqueDiscovered([{ id: modelId, name: modelId }, ...current]))
    setSelectedDiscoveryIds((current) => (current.includes(modelId) ? current : [modelId, ...current]))
    setModelForm((current) => ({ ...current, manual_model: '', default_model: current.default_model || modelId }))
  }

  async function handleSaveSelectedModels() {
    if (selectedDiscoveryIds.length === 0) return
    const defaultModel = selectedDiscoveryIds.includes(modelForm.default_model) ? modelForm.default_model : selectedDiscoveryIds[0]

    for (const modelId of selectedDiscoveryIds) {
      const existing = models.find(
        (model) =>
          model.provider === modelForm.provider &&
          normalizeApiBase(model.base_url || '') === normalizeApiBase(modelForm.base_url || '') &&
          model.model === modelId,
      )
      const payload = {
        name: modelForm.provider === 'local' ? 'Local Evidence Answer' : `${activePlatform.name} / ${modelId}`,
        provider: modelForm.provider,
        model: modelId,
        base_url: modelForm.base_url,
        temperature: modelForm.temperature,
        enabled: true,
        is_default: modelId === defaultModel,
        api_key: modelForm.api_key,
      }
      if (existing) {
        await api.patchModel(existing.id, payload)
      } else {
        await api.createModel(payload)
      }
    }

    setNotice(t('models.savedBatch', { count: selectedDiscoveryIds.length }))
    setModelForm((current) => ({ ...current, api_key: '' }))
    setSelectedDiscoveryIds([])
    await refreshAll()
  }

  async function patchModel(id: number, payload: Partial<ModelConfig> & { api_key?: string }) {
    await api.patchModel(id, payload)
    await refreshAll()
  }

  function startEditModel(model: ModelConfig) {
    setEditingModelId(model.id)
    setModelDrafts((current) => ({
      ...current,
      [model.id]: {
        name: displayModelName(model.name),
        provider: model.provider,
        model: model.model,
        base_url: model.base_url,
        api_key: '',
        temperature: model.temperature,
        discovered: [],
      },
    }))
  }

  function updateModelDraft(id: number, patch: Partial<ModelEditDraft>) {
    setModelDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }))
  }

  async function discoverDraftModels(model: ModelConfig) {
    const draft = modelDrafts[model.id]
    if (!draft) return
    setRefreshingModelId(model.id)
    try {
      const response = await api.discoverModels({
        provider: draft.provider,
        base_url: draft.base_url,
        api_key: draft.api_key,
      })
      updateModelDraft(model.id, { discovered: uniqueDiscovered(response.models) })
      setNotice(t('models.discoveredCount', { count: response.models.length }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('chat.requestFailed'))
    } finally {
      setRefreshingModelId(null)
    }
  }

  async function saveEditedModel(model: ModelConfig) {
    const draft = modelDrafts[model.id]
    if (!draft) return
    const payload: Partial<ModelConfig> & { api_key?: string } = {
      name: draft.name,
      provider: draft.provider,
      model: draft.model,
      base_url: draft.base_url,
      temperature: draft.temperature,
    }
    if (draft.api_key.trim()) payload.api_key = draft.api_key.trim()
    await api.patchModel(model.id, payload)
    setEditingModelId(null)
    setNotice(t('models.updated'))
    await refreshAll()
  }

  async function deleteModel(id: number) {
    await api.deleteModel(id)
    setNotice(t('models.deleted'))
    await refreshAll()
  }

  async function handleSaveServer(event: FormEvent) {
    event.preventDefault()
    setApiBase(apiBaseInput)
    setNotice(apiBaseInput.trim() ? t('server.savedRemote') : t('server.savedLocal'))
    await refreshAll()
  }

  async function handleTestServer() {
    const base = normalizeApiBase(apiBaseInput)
    try {
      const response = await fetch(`${base}/api/health`)
      if (!response.ok) throw new Error(response.statusText)
      setNotice(t('server.testOk'))
    } catch (error) {
      setNotice(error instanceof Error ? `${t('server.testFailed')}: ${error.message}` : `${t('server.testFailed')}.`)
    }
  }

  const activeApiBase = getApiBase()
  const connectionLabel = connectionState === 'online' ? t('status.online') : connectionState === 'checking' ? t('status.checking') : t('status.offline')

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>{PRODUCT_NAME}</strong>
            <span>{t('app.subtitle')}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={activeView === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(item.id)}>
                <Icon size={18} />
                <span>{t(item.labelKey)}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className={activeView === 'settings' ? 'settings-button active' : 'settings-button'} onClick={() => setActiveView('settings')}>
            <Settings2 size={17} />
            <span>{t('nav.settings')}</span>
          </button>
          <div className="sidebar-footer">
            <div className={`status-dot ${connectionState}`} />
            <div>
              <strong>{connectionLabel}</strong>
              <span>{activeApiBase || t('status.local')}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <Bot size={19} />
            <div>
              <span>{t('topbar.workspace')}</span>
              <strong>{displayProjectName(selectedProject?.name)}</strong>
            </div>
          </div>
          <div className="topbar-controls">
            <select value={selectedProject?.id ?? ''} onChange={(event) => setSelectedProjectId(Number(event.target.value))}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {displayProjectName(project.name)}
                </option>
              ))}
            </select>
            <select value={selectedModel?.id ?? ''} onChange={(event) => setSelectedModelId(Number(event.target.value))}>
              {enabledModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelOptionLabel(model)}
                </option>
              ))}
            </select>
            <button className="icon-button" title={t('common.refresh')} onClick={() => refreshAll()}>
              <RefreshCcw size={17} />
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>{t('common.dismiss')}</button>
          </div>
        )}

        {activeView === 'chat' && renderChat()}
        {activeView === 'knowledge' && renderKnowledge()}
        {activeView === 'models' && renderModels()}
        {activeView === 'server' && renderServer()}
        {activeView === 'admin' && renderAdmin()}
        {activeView === 'settings' && renderSettings()}
      </main>
    </div>
  )

  function renderChat() {
    const promptKeys = ['chat.prompt.summary', 'chat.prompt.deploy', 'chat.prompt.lessons']
    return (
      <section className="chat-layout">
        <aside className="conversation-rail">
          <div className="section-heading">
            <History size={17} />
            <span>{t('chat.sessions')}</span>
          </div>
          <button
            className="primary-button full-width"
            onClick={() => {
              setConversationId(undefined)
              setMessages([])
            }}
          >
            <Plus size={16} />
            {t('chat.newThread')}
          </button>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === conversationId ? 'conversation-item active' : 'conversation-item'}
                onClick={() => handleLoadConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>
                  {displayProjectName(conversation.project_name, 'project.all')} / {formatDate(conversation.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-main">
          <div className="chat-stream">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-mark">
                  <Search size={28} />
                </div>
                <h2>{t('chat.emptyTitle')}</h2>
                <p>{t('chat.emptyBody')}</p>
                <div className="prompt-row">
                  {promptKeys.map((promptKey) => (
                    <button key={promptKey} onClick={() => setQuestion(t(promptKey))}>
                      {t(promptKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <div className="message-role">{message.role === 'user' ? t('chat.you') : displayModelName(selectedModel?.name)}</div>
                <div className="message-content">{message.content}</div>
                {!!message.citations?.length && (
                  <div className="inline-citations">
                    {message.citations.slice(0, 3).map((citation) => (
                      <span key={citation.chunk_id}>[{citation.rank}] {citation.document_title}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {isSending && (
              <article className="message assistant">
                <div className="message-role">{PRODUCT_NAME}</div>
                <div className="message-content loading-line">
                  <Loader2 size={16} className="spin" />
                  {t('chat.loading')}
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="composer" onSubmit={handleSend}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t('chat.placeholder')}
              rows={3}
            />
            <button className="send-button" type="submit" disabled={isSending || !question.trim()} title={t('chat.send')}>
              {isSending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
          </form>
        </section>

        <aside className="inspector">
          <div className="section-heading">
            <FileText size={17} />
            <span>{t('evidence.title')}</span>
          </div>
          {latestCitations.length === 0 ? (
            <p className="muted">{t('evidence.empty')}</p>
          ) : (
            <div className="citation-list">
              {latestCitations.map((citation) => (
                <div className="citation-item" key={citation.chunk_id}>
                  <div className="citation-title">
                    <span>[{citation.rank}] {citation.document_title}</span>
                    <small>{Math.round(citation.score * 100)}%</small>
                  </div>
                  <p>{citation.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </section>
    )
  }

  function renderKnowledge() {
    return (
      <section className="two-column-page">
        <div className="panel">
          <div className="section-heading">
            <Upload size={17} />
            <span>{t('library.ingest')}</span>
          </div>
          <label className="file-drop">
            <input type="file" multiple onChange={(event) => setFiles(event.target.files)} />
            <Upload size={22} />
            <strong>{files?.length ? t('library.selected', { count: files.length }) : t('library.drop')}</strong>
            <span>{t('library.fileTypes')}</span>
          </label>
          <button className="primary-button full-width" onClick={handleUpload} disabled={!files?.length || isUploading}>
            {isUploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            {t('library.index')}
          </button>

          <form className="stacked-form" onSubmit={handleCreateProject}>
            <div className="section-heading compact">
              <Plus size={16} />
              <span>{t('library.newProject')}</span>
            </div>
            <input value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} placeholder={t('library.projectName')} />
            <textarea
              value={newProject.description}
              onChange={(event) => setNewProject({ ...newProject, description: event.target.value })}
              placeholder={t('library.projectDescription')}
              rows={4}
            />
            <button className="secondary-button" type="submit">
              <Plus size={16} />
              {t('library.createProject')}
            </button>
          </form>
        </div>

        <div className="panel wide">
          <div className="section-heading split">
            <span>{t('library.indexedFiles')}</span>
            <small>{t('library.filesCount', { count: documents.length })}</small>
          </div>
          <div className="table-list">
            {documents.map((document) => (
              <div className="table-row" key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <span>{document.filename} / {t('library.chunks', { count: document.chunk_count })} / {formatDate(document.created_at)}</span>
                </div>
                <button className="icon-button danger" title={t('library.deleteDocument')} onClick={() => handleDeleteDocument(document.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {documents.length === 0 && <p className="muted">{t('library.empty')}</p>}
          </div>
        </div>
      </section>
    )
  }

  function renderModels() {
    const modelGroups = Object.values(
      models.reduce<Record<string, { provider: ModelProvider; baseUrl: string; items: ModelConfig[] }>>((groups, model) => {
        const baseUrl = model.base_url || t('status.local')
        const key = `${model.provider}:${baseUrl}`
        if (!groups[key]) groups[key] = { provider: model.provider, baseUrl, items: [] }
        groups[key].items.push(model)
        return groups
      }, {}),
    )

    return (
      <section className="models-page">
        <div className="model-page-title">
          <div>
            <h2>{t('models.title')}</h2>
            <p>{t('models.subtitle')}</p>
          </div>
          <span>{t('models.selectedCount', { count: selectedDiscoveryIds.length })}</span>
        </div>

        <div className="model-workbench">
          <aside className="model-platform-panel">
            <div className="section-heading">
              <Layers3 size={17} />
              <span>{t('models.platforms')}</span>
            </div>
            <div className="model-platform-list">
              {modelPlatforms.map((platform) => (
                <button
                  key={platform.id}
                  className={platform.id === modelForm.platformId ? 'model-platform active' : 'model-platform'}
                  onClick={() => selectModelPlatform(platform)}
                >
                  <strong>{platform.name}</strong>
                  <span>{t(platform.noteKey)}</span>
                  <small>{providerLabel(platform.provider)}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="model-builder-panel">
            <div className="model-connection-bar">
              <div className="section-heading">
                <Settings2 size={17} />
                <span>{t('models.connection')}</span>
              </div>
              <div className="model-form-grid">
                <label>
                  <span>{t('models.providerLabel')}</span>
                  <select value={modelForm.provider} onChange={(event) => setModelForm({ ...modelForm, provider: event.target.value as ModelProvider })}>
                    <option value="local">{t('models.provider.local')}</option>
                    <option value="ollama">{t('models.provider.ollama')}</option>
                    <option value="openai_compatible">{t('models.provider.openai')}</option>
                    <option value="anthropic">{t('models.provider.anthropic')}</option>
                    <option value="google">{t('models.provider.google')}</option>
                  </select>
                </label>
                <label className="span-2">
                  <span>{t('models.baseUrl')}</span>
                  <input
                    value={modelForm.base_url}
                    onChange={(event) => setModelForm({ ...modelForm, base_url: event.target.value })}
                    placeholder={activePlatform.base_url || 'https://api.example.com/v1'}
                    disabled={modelForm.provider === 'local'}
                  />
                </label>
                <label className="span-2">
                  <span>{t('models.apiKey')}</span>
                  <input
                    type="password"
                    value={modelForm.api_key}
                    onChange={(event) => setModelForm({ ...modelForm, api_key: event.target.value })}
                    placeholder={t('models.apiKey')}
                    disabled={modelForm.provider === 'local' || modelForm.provider === 'ollama'}
                  />
                </label>
                <label className="range-row span-2">
                  <span>{t('models.temperature')}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={modelForm.temperature}
                    onChange={(event) => setModelForm({ ...modelForm, temperature: Number(event.target.value) })}
                  />
                  <strong>{modelForm.temperature}</strong>
                </label>
              </div>
              <div className="model-actions-row">
                <button className="primary-button" type="button" onClick={handleDiscoverModels} disabled={isDiscoveringModels}>
                  {isDiscoveringModels ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
                  {isDiscoveringModels ? t('models.discovering') : t('models.discover')}
                </button>
                <p className="muted">{t('models.apiKeyHint')}</p>
              </div>
            </div>

            <div className="model-discovery-panel">
              <div className="section-heading split">
                <span>{t('models.discovery')}</span>
                <small>{t('models.discoveredCount', { count: discoveredModels.length })}</small>
              </div>

              <div className="manual-model-row">
                <input
                  value={modelForm.manual_model}
                  onChange={(event) => setModelForm({ ...modelForm, manual_model: event.target.value })}
                  placeholder={t('models.manualModel')}
                />
                <button className="secondary-button" type="button" onClick={handleAddManualModel}>
                  <Plus size={16} />
                  {t('models.addManual')}
                </button>
              </div>

              <div className="model-picker-list">
                {discoveredModels.length === 0 && <p className="muted">{t('models.noDiscovered')}</p>}
                {discoveredModels.map((model) => {
                  const selected = selectedDiscoveryIds.includes(model.id)
                  return (
                    <button key={model.id} className={selected ? 'model-picker active' : 'model-picker'} onClick={() => toggleDiscoveredModel(model.id)}>
                      <span>{selected && <Check size={14} />}</span>
                      <div>
                        <strong>{model.id}</strong>
                        {model.name && model.name !== model.id && <small>{model.name}</small>}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="default-model-row">
                <label>
                  <span>{t('models.defaultStartup')}</span>
                  <select
                    value={modelForm.default_model}
                    onChange={(event) => setModelForm({ ...modelForm, default_model: event.target.value })}
                    disabled={selectedDiscoveryIds.length === 0}
                  >
                    <option value="">{t('models.defaultStartupPlaceholder')}</option>
                    {selectedDiscoveryIds.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {modelId}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" type="button" onClick={handleSaveSelectedModels} disabled={selectedDiscoveryIds.length === 0}>
                  <Plus size={16} />
                  {t('models.saveSelected')}
                </button>
              </div>
            </div>
          </section>

          <section className="model-configured-panel">
            <div className="section-heading split">
              <span>{t('models.configured')}</span>
              <small>{t('models.endpointCount', { count: models.length })}</small>
            </div>
            <div className="configured-models">
              {modelGroups.length === 0 && <p className="muted">{t('models.emptyConfigured')}</p>}
              {modelGroups.map((group) => (
                <div className="model-config-group" key={`${group.provider}-${group.baseUrl}`}>
                  <div className="model-group-heading">
                    <strong>{providerLabel(group.provider)}</strong>
                    <span>{group.baseUrl}</span>
                  </div>
                  {group.items.map((model) => {
                    const draft = modelDrafts[model.id]
                    const isEditing = editingModelId === model.id && draft
                    if (isEditing) {
                      return (
                        <div className="model-row editing" key={model.id}>
                          <div className="model-edit-grid">
                            <input value={draft.name} onChange={(event) => updateModelDraft(model.id, { name: event.target.value })} placeholder={t('models.displayName')} />
                            <select value={draft.provider} onChange={(event) => updateModelDraft(model.id, { provider: event.target.value as ModelProvider })}>
                              <option value="local">{t('models.provider.local')}</option>
                              <option value="ollama">{t('models.provider.ollama')}</option>
                              <option value="openai_compatible">{t('models.provider.openai')}</option>
                              <option value="anthropic">{t('models.provider.anthropic')}</option>
                              <option value="google">{t('models.provider.google')}</option>
                            </select>
                            <input value={draft.base_url} onChange={(event) => updateModelDraft(model.id, { base_url: event.target.value })} placeholder={t('models.baseUrl')} />
                            <select value={draft.model} onChange={(event) => updateModelDraft(model.id, { model: event.target.value })}>
                              <option value={draft.model}>{draft.model}</option>
                              {draft.discovered.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.id}
                                </option>
                              ))}
                            </select>
                            <input
                              type="password"
                              value={draft.api_key}
                              onChange={(event) => updateModelDraft(model.id, { api_key: event.target.value })}
                              placeholder={model.api_key_set ? t('models.keySet') : t('models.apiKey')}
                            />
                            <label className="range-row compact-range">
                              <span>{t('models.temperature')}</span>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={draft.temperature}
                                onChange={(event) => updateModelDraft(model.id, { temperature: Number(event.target.value) })}
                              />
                              <strong>{draft.temperature}</strong>
                            </label>
                          </div>
                          <div className="row-actions">
                            <button className="secondary-button" type="button" onClick={() => discoverDraftModels(model)} disabled={refreshingModelId === model.id}>
                              {refreshingModelId === model.id ? <Loader2 size={15} className="spin" /> : <RefreshCcw size={15} />}
                              {t('models.refreshOne')}
                            </button>
                            <button className="primary-button" type="button" onClick={() => saveEditedModel(model)}>
                              <Check size={15} />
                              {t('common.save')}
                            </button>
                            <button className="icon-button" type="button" title={t('common.cancel')} onClick={() => setEditingModelId(null)}>
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div className="model-row" key={model.id}>
                        <div className="model-row-main">
                          <strong>{displayModelName(model.name)}</strong>
                          <span>{modelOptionLabel(model)}</span>
                          <small>{model.base_url || t('status.local')}</small>
                        </div>
                        <div className="row-actions">
                          <span className={model.api_key_set ? 'key-state active' : 'key-state'}>{model.api_key_set ? t('models.keySet') : t('models.keyMissing')}</span>
                          <button className={model.enabled ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { enabled: !model.enabled })}>
                            {model.enabled ? t('common.enabled') : t('common.disabled')}
                          </button>
                          <button className={model.is_default ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { is_default: true, enabled: true })}>
                            <Check size={14} />
                            {t('common.default')}
                          </button>
                          <button className="icon-button" type="button" title={t('models.edit')} onClick={() => startEditModel(model)}>
                            <Pencil size={16} />
                          </button>
                          <button className="icon-button danger" type="button" title={t('models.delete')} onClick={() => deleteModel(model.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    )
  }

  function renderServer() {
    return (
      <section className="server-page">
        <div className="server-hero">
          <div>
            <div className="eyebrow">
              <Wifi size={15} />
              {t('server.eyebrow')}
            </div>
            <h2>{t('server.title')}</h2>
            <p>{t('server.body')}</p>
          </div>
          <div className="server-mode">
            <div>
              <HardDrive size={18} />
              <span>{t('server.localMode')}</span>
            </div>
            <div>
              <Globe2 size={18} />
              <span>{t('server.remoteMode')}</span>
            </div>
          </div>
        </div>

        <div className="two-column-page flush">
          <form className="panel stacked-form" onSubmit={handleSaveServer}>
            <div className="section-heading">
              <Server size={17} />
              <span>{t('server.endpoint')}</span>
            </div>
            <input value={apiBaseInput} onChange={(event) => setApiBaseInput(event.target.value)} placeholder={t('server.placeholder')} />
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={16} />
                {t('server.save')}
              </button>
              <button className="secondary-button" type="button" onClick={handleTestServer}>
                <Wifi size={16} />
                {t('server.test')}
              </button>
            </div>
            <p className="muted">{t('server.localNote')}</p>
          </form>

          <div className="panel wide">
            <div className="section-heading">
              <Shield size={17} />
              <span>{t('server.notes')}</span>
            </div>
            <div className="note-list">
              <p>{t('server.note1')}</p>
              <p>{t('server.note2')}</p>
              <p>{t('server.note3')}</p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderAdmin() {
    return (
      <section className="admin-page">
        <div className="metric-strip">
          {stats &&
            Object.entries(stats.counts).map(([key, value]) => (
              <div className="metric" key={key}>
                <span>{metricLabel(key)}</span>
                <strong>{value}</strong>
              </div>
            ))}
        </div>

        <div className="two-column-page flush">
          <div className="panel wide">
            <div className="section-heading">
              <FileText size={17} />
              <span>{t('admin.recentDocuments')}</span>
            </div>
            <div className="table-list">
              {stats?.recent_documents.map((document) => (
                <div className="table-row" key={document.id}>
                  <div>
                    <strong>{document.title}</strong>
                    <span>{displayProjectName(document.project_name)} / {t('library.chunks', { count: document.chunk_count })}</span>
                  </div>
                  <small>{formatDate(document.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading">
              <Activity size={17} />
              <span>{t('admin.recentSessions')}</span>
            </div>
            <div className="table-list">
              {stats?.recent_conversations.map((conversation) => (
                <button className="table-row as-button" key={conversation.id} onClick={() => handleLoadConversation(conversation.id)}>
                  <div>
                    <strong>{conversation.title}</strong>
                    <span>{displayProjectName(conversation.project_name, 'project.all')}</span>
                  </div>
                  <small>{formatDate(conversation.updated_at)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderSettings() {
    return (
      <section className="settings-page">
        <div className="panel settings-panel">
          <div className="section-heading">
            <Settings2 size={17} />
            <span>{t('settings.title')}</span>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t('settings.language')}</strong>
              <span>{t('settings.languageNote')}</span>
            </div>
            <div className="segmented-control" aria-label={t('settings.language')}>
              <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>
                <Languages size={15} />
                {t('settings.chinese')}
              </button>
              <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>
                <Languages size={15} />
                {t('settings.english')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t('settings.currentBackend')}</strong>
              <span>{activeApiBase || t('settings.backendLocal')}</span>
            </div>
            <button className="secondary-button" onClick={() => setActiveView('server')}>
              <Server size={16} />
              {t('nav.server')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  function metricLabel(key: string) {
    const labels: Record<string, string> = {
      projects: t('admin.projects'),
      documents: t('admin.documents'),
      chunks: t('admin.chunks'),
      conversations: t('admin.conversations'),
      models: t('admin.models'),
    }
    return labels[key] ?? key
  }
}

export default App
