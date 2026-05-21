import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Cloud,
  ClipboardList,
  Database,
  FileText,
  FlaskConical,
  FolderTree,
  Gauge,
  Globe2,
  HardDrive,
  History,
  Languages,
  Layers3,
  ListTree,
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
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { api, getApiBase, getApiToken, setApiBase, setApiToken } from './api'
import { chatMachineReducer, createInitialChatMachineState, isChatMachineBusy, type ChatMachineStage } from './chatMachine'
import type {
  AdminStats,
  AdminHealth,
  AuthSessionInfo,
  ChatDebug,
  DocumentChunk,
  ChatMessage,
  Citation,
  ConversationSummary,
  DeviceSession,
  DiscoveredModel,
  DocumentDetail,
  DocumentItem,
  DocumentPreview,
  DocumentTreeNode,
  EvalCase,
  EvalRun,
  ImportJob,
  ImportResultItem,
  ImportSummary,
  ModelConfig,
  ModelProvider,
  ModelPreset,
  ModelType,
  ModelUsage,
  ModelUsageTotal,
  Project,
  ProjectMember,
  RagDebugResult,
  RagLog,
  RetrievalMode,
  RetrievalScope,
  SearchResult,
  SyncSource,
  TeamInvitation,
  TeamInvitationPreview,
  TeamMember,
} from './types'

type View = 'chat' | 'knowledge' | 'models' | 'diagnostics' | 'server' | 'admin' | 'settings'
type Language = 'zh' | 'en'
type ModelModuleTab = 'config' | 'presets' | 'usage'
type KnowledgeLayer = 'daily' | 'advanced'
type ToastTone = 'info' | 'success' | 'warning' | 'danger'

type ToastMessage = {
  id: number
  message: string
  tone: ToastTone
}

type SyncSourceDraft = {
  name: string
  source_path: string
  poll_interval_seconds: number
  include_globs: string
  exclude_globs: string
  delete_missing: boolean
}

type ServerProfile = {
  id: string
  name: string
  base_url: string
  token: string
  last_checked_at?: string
  last_status?: 'checking' | 'online' | 'offline'
  last_error?: string
}

type AuthGateMode = 'loading' | 'setup' | 'login' | 'ready'

type AuthFormState = {
  email: string
  display_name: string
  password: string
  device_name: string
}

type TeamInviteDraft = {
  email: string
  workspace_role: 'admin' | 'member' | 'viewer'
  project_role: 'editor' | 'viewer'
  project_ids: number[]
  message: string
  expires_in_days: number
}

type ProjectShareDraft = {
  user_id?: number
  role: 'owner' | 'editor' | 'viewer'
}

type InviteAcceptDraft = {
  invite_token: string
  display_name: string
  password: string
  device_name: string
}

type CitationPreviewState = {
  document: DocumentDetail
  citation: Citation
}

type ChatTimelineItem = {
  id: string
  stage: string
  label: string
  detail?: string
  at: number
}

type TourPlacement = 'top' | 'right' | 'bottom' | 'left'

type TourStep = {
  id: string
  view: View
  target: string
  titleKey: string
  bodyKey: string
  placement: TourPlacement
}

type TourRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

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
  model_type: ModelType
  context_window: number
  supports_tools: boolean
  supports_vision: boolean
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
  model_type: ModelType
  context_window: number
  supports_tools: boolean
  supports_vision: boolean
  discovered: DiscoveredModel[]
}

type ModelPresetDraft = {
  name: string
  description: string
  project_id?: number
  model_id?: number
  system_prompt: string
  temperature: number
  retrieval_scope: RetrievalScope
  retrieval_mode: RetrievalMode
  top_k: number
  similarity_threshold: number
  use_query_rewrite: boolean
  use_rerank: boolean
  metadata_filter_json: string
  tools_json: string
  is_default: boolean
}

const PRODUCT_NAME = 'Kortex'
const LANGUAGE_STORAGE_KEY = 'kortex.language'
const ONBOARDING_STORAGE_KEY = 'kortex.onboardingDone'
const PROFESSIONAL_MODE_STORAGE_KEY = 'kortex.professionalMode'
const SERVER_PROFILES_STORAGE_KEY = 'kortex.serverProfiles'
const USAGE_BUDGET_STORAGE_KEY = 'kortex.usageBudget'

const navItems: Array<{ id: Exclude<View, 'settings'>; labelKey: string; icon: typeof MessageSquareText }> = [
  { id: 'chat', labelKey: 'nav.ask', icon: MessageSquareText },
  { id: 'knowledge', labelKey: 'nav.library', icon: Database },
  { id: 'models', labelKey: 'nav.models', icon: Layers3 },
  { id: 'diagnostics', labelKey: 'nav.diagnostics', icon: FlaskConical },
  { id: 'server', labelKey: 'nav.server', icon: Cloud },
  { id: 'admin', labelKey: 'nav.admin', icon: Activity },
]

const onboardingSteps: TourStep[] = [
  {
    id: 'workspace',
    view: 'chat',
    target: '[data-tour="workspace-selector"]',
    titleKey: 'onboarding.workspace.title',
    bodyKey: 'onboarding.workspace.body',
    placement: 'bottom',
  },
  {
    id: 'upload',
    view: 'knowledge',
    target: '[data-tour="knowledge-upload"]',
    titleKey: 'onboarding.upload.title',
    bodyKey: 'onboarding.upload.body',
    placement: 'right',
  },
  {
    id: 'rag',
    view: 'knowledge',
    target: '[data-tour="rag-settings"]',
    titleKey: 'onboarding.rag.title',
    bodyKey: 'onboarding.rag.body',
    placement: 'left',
  },
  {
    id: 'models',
    view: 'models',
    target: '[data-tour="model-platforms"]',
    titleKey: 'onboarding.models.title',
    bodyKey: 'onboarding.models.body',
    placement: 'bottom',
  },
  {
    id: 'chat',
    view: 'chat',
    target: '[data-tour="chat-composer"]',
    titleKey: 'onboarding.chat.title',
    bodyKey: 'onboarding.chat.body',
    placement: 'top',
  },
]

const enTranslations: Record<string, string> = {

    'app.subtitle': 'Project memory OS',
    'nav.ask': 'Ask',
    'nav.library': 'Library',
    'nav.models': 'Models',
    'nav.diagnostics': 'Debug',
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
    'common.retry': 'Retry',
    'common.close': 'Close',
    'common.view': 'View',
    'common.test': 'Test',
    'common.testing': 'Testing',
    'onboarding.title': 'Turn your project files into a searchable knowledge base',
    'onboarding.body': 'Complete four steps: create a project, add a model, upload a project folder, then ask questions. You can later point the client to a remote backend.',
    'onboarding.step.project': 'Project space',
    'onboarding.step.model': 'Model setup',
    'onboarding.step.upload': 'Upload files',
    'onboarding.step.ask': 'Ask',
    'onboarding.start': 'Start setup',
    'onboarding.done': 'Got it',
    'onboarding.progress': 'Step {current} of {total}',
    'onboarding.previous': 'Previous',
    'onboarding.next': 'Next',
    'onboarding.skip': 'Skip tour',
    'onboarding.finish': 'Finish',
    'onboarding.workspace.title': 'Confirm the project space',
    'onboarding.workspace.body': 'This decides which project the current chat, uploads, and retrieval use. Keep different projects in separate spaces so their context stays clean.',
    'onboarding.upload.title': 'Upload a project folder or archive',
    'onboarding.upload.body': 'Drop source code, README files, requirements, retrospectives, or zip archives here. Kortex indexes them into the knowledge base.',
    'onboarding.rag.title': 'Tune retrieval behavior',
    'onboarding.rag.body': 'Control chunking, Top K, vector/keyword/hybrid retrieval, and use the test bench to see which files a question will hit.',
    'onboarding.models.title': 'Configure model platforms',
    'onboarding.models.body': 'Choose a platform, enter its Base URL and API key, then fetch available models. Selected models appear in the chat composer switcher.',
    'onboarding.chat.title': 'Switch models and ask',
    'onboarding.chat.body': 'Pick the model for this conversation, type your question, press Enter to send, or use Shift + Enter for a new line.',
    'chat.sessions': 'Sessions',
    'chat.newThread': 'New thread',
    'chat.modelSwitcher': 'Switch model',
    'chat.emptyTitle': 'Ask across your project memory',
    'chat.emptyBody': 'Upload requirements, handoff notes, README files, design decisions, and retrospectives. Kortex will retrieve the closest evidence before answering.',
    'chat.prompt.summary': 'Summarize this project',
    'chat.prompt.deploy': 'Find deployment steps',
    'chat.prompt.lessons': 'Extract reusable lessons',
    'chat.you': 'You',
    'chat.loading': 'Retrieving evidence and composing an answer',
    'chat.status.submitting': 'Submitting question',
    'chat.status.retrieving': 'Searching knowledge base',
    'chat.status.thinking': 'Model thinking',
    'chat.status.reasoningReceived': 'DeepSeek is thinking, {count} reasoning signal(s) received',
    'chat.status.streaming': 'Streaming answer',
    'chat.status.finalizing': 'Saving conversation',
    'chat.status.failed': 'Generation failed',
    'chat.answerGrounded': 'Grounded in {files} file(s) / {chunks} citation(s)',
    'chat.answerUngrounded': 'No knowledge-base citation was attached to this answer',
    'chat.costEstimated': 'Cost is estimated',
    'chat.activeModel': 'Active model',
    'chat.modelSwitched': 'Switched to: {name}',
    'chat.noModel': 'No available model',
    'chat.placeholder': 'Ask about a project, decision, module, deployment, bug, or lesson learned...',
    'chat.send': 'Send',
    'chat.requestFailed': 'Request failed',
    'evidence.title': 'Evidence',
    'evidence.summary': 'Answer grounding',
    'evidence.bestMatch': 'Best match',
    'evidence.sourceFiles': 'Source files',
    'evidence.empty': 'Cited chunks, source files, and similarity scores appear here after an answer.',
    'evidence.open': 'Open citation',
    'evidence.previewTitle': 'Citation preview',
    'evidence.previewBody': 'Inspect the matched chunk without leaving the chat.',
    'evidence.primaryHit': 'Primary matched excerpt',
    'evidence.fullDocument': 'Open in knowledge base',
    'evidence.closePreview': 'Close preview',
    'library.ingest': 'Ingest',
    'library.taskCenter': 'Import tasks',
    'library.fileTree': 'File tree',
    'library.documentDetail': 'Document detail',
    'library.ragSettings': 'RAG settings',
    'library.debugQuery': 'Retrieval test bench',
    'library.debugPlaceholder': 'Ask a test query and inspect retrieved chunks...',
    'library.runDebug': 'Test retrieval',
    'library.noTree': 'Upload a project folder to see files grouped by path.',
    'library.noDetail': 'Select a document from the tree or an answer citation to inspect chunks.',
    'library.chunkSize': 'Chunk size',
    'library.chunkOverlap': 'Overlap',
    'library.topK': 'Top K',
    'library.threshold': 'Similarity threshold',
    'library.mode': 'Retrieval mode',
    'library.mode.vector': 'Vector',
    'library.mode.keyword': 'Keyword',
    'library.mode.hybrid': 'Hybrid',
    'library.settingsSaved': 'RAG settings saved.',
    'library.importEmpty': 'No import tasks yet.',
    'library.openDocument': 'Open document',
    'library.drop': 'Drop project files into memory',
    'library.selected': '{count} file(s) selected',
    'library.fileTypes': 'Project folders, zip archives, txt, md, pdf, docx, source code, logs, config files',
    'library.pickFolder': 'Choose project folder',
    'library.pickFiles': 'Choose files or archive',
    'library.skippedNotice': 'Indexed {count} file(s), skipped {skipped} unreadable or dependency file(s).',
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
    'library.preview': 'Chunk preview',
    'library.previewReady': 'Generated previews for {count} file(s).',
    'library.previewEmpty': 'Choose files, then preview chunks, duplicates, and metadata.',
    'library.duplicate': 'Duplicate',
    'library.version': 'Version',
    'library.metadata': 'Metadata',
    'library.metadataSaved': 'Document metadata saved.',
    'library.reindex': 'Reindex',
    'library.reindexed': 'Reindexed {count} chunk(s).',
    'library.batchDelete': 'Batch delete',
    'library.batchDeleted': 'Deleted {count} document(s).',
    'library.retry': 'Retry',
    'library.retryDone': 'Retried {count} document(s).',
    'library.scope': 'Context scope',
    'library.scope.focused': 'Focused retrieval',
    'library.scope.full': 'Full context',
    'library.queryRewrite': 'Multi-turn query rewrite',
    'library.rerank': 'Rerank',
    'library.agentTools': 'Agent knowledge tools',
    'library.fullContextLimit': 'Full-context chunk limit',
    'library.embeddingModel': 'Embedding model',
    'library.rerankModel': 'Rerank model',
    'library.metadataFilter': 'Metadata filter JSON',
    'library.overview': 'Knowledge overview',
    'library.documentsIndexed': 'Indexed documents',
    'library.totalChunks': 'Stored chunks',
    'library.lastImport': 'Latest import',
    'library.statusHealthy': 'Healthy',
    'library.openTasks': 'Import tasks and skipped reasons',
    'library.openProjectTools': 'Project space tools',
    'library.openAdvancedGuide': 'Advanced retrieval settings',
    'library.openAdvancedGuideBody': 'Switch to Professional mode when you need chunking, embedding, rerank, and retrieval diagnostics.',
    'library.switchToProfessional': 'Switch to Professional mode',
    'chat.feedback': 'Feedback',
    'chat.feedbackNote': 'Add feedback...',
    'chat.feedbackSaved': 'Feedback saved.',
    'chat.regenerate': 'Regenerate',
    'chat.regenerated': 'Answer regenerated.',
    'eval.title': 'RAG evaluation',
    'eval.subtitle': 'Use stable test questions to track retrieval hits, answer coverage, and model changes.',
    'eval.newCase': 'New test question',
    'eval.expectedAnswer': 'Expected answer keywords',
    'eval.expectedDocument': 'Expected source document',
    'eval.tags': 'Tags',
    'eval.caseCreated': 'Test question created.',
    'eval.run': 'Run eval',
    'eval.runDone': 'Finished {count} eval run(s).',
    'eval.cases': 'Test set',
    'eval.runs': 'Recent runs',
    'eval.empty': 'No test questions yet.',
    'admin.health': 'System health',
    'admin.backup': 'Download backup',
    'admin.restore': 'Restore backup',
    'admin.restoreDone': 'Backup restored.',
    'admin.dbSize': 'Database',
    'admin.uploadsSize': 'Uploads',
    'admin.failedJobs': 'Failed jobs',
    'admin.events': 'System events',
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
    'models.modelType': 'Model role',
    'models.type.chat': 'Chat',
    'models.type.embedding': 'Embedding',
    'models.type.rerank': 'Rerank',
    'models.contextWindow': 'Context window',
    'models.supportsTools': 'Tools',
    'models.supportsVision': 'Vision',
    'models.connectionOk': 'Connection OK: {latency}ms',
    'models.connectionFailed': 'Connection failed: {error}',
    'models.lastTest': 'Last test',
    'models.save': 'Save model',
    'models.configured': 'In chat switcher',
    'models.endpointCount': '{count} model(s)',
    'models.saved': 'Model saved: {name}',
    'models.title': 'Model connections',
    'models.subtitle': 'Read model lists from a Base URL, then add selected models to the chat input switcher.',
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
    'models.noDiscovered': 'Fetching models directly requests the current Base URL. If the endpoint requires auth or has no list API, add a model id manually.',
    'models.apiKeyHint': 'Model discovery directly requests the Base URL. Fill an API key when the endpoint requires auth; saved keys are never shown in plaintext.',
    'models.apiKeyRequired': 'The current Base URL requires auth or cannot list models right now. Suggested models remain available; select one or add a model id manually, then add the key later.',
    'models.keySet': 'Key saved',
    'models.keyMissing': 'No key',
    'models.edit': 'Edit',
    'models.delete': 'Delete',
    'models.refreshOne': 'Fetch again',
    'models.savedBatch': 'Added {count} model(s) to the chat switcher.',
    'models.updated': 'Model updated.',
    'models.deleted': 'Model deleted.',
    'models.emptyConfigured': 'No models have been added to the chat switcher yet. Pick a platform and add models first.',
    'models.endpointGroup': '{provider} / {base}',
    'models.tab.config': 'Model config',
    'models.tab.usage': 'Usage',
    'models.activePlatform': 'Active platform',
    'models.configuredForPlatform': 'Added for this platform',
    'models.emptyConfiguredForPlatform': 'No models from this platform are in the chat switcher yet.',
    'models.usageTitle': 'Model usage',
    'models.usageSubtitle': 'Track the model, estimated tokens, and cost for every chat call so switching is visible.',
    'models.usageCalls': 'Calls',
    'models.usageInput': 'Input tokens',
    'models.usageOutput': 'Output tokens',
    'models.usageTotal': 'Total tokens',
    'models.usageCost': 'Estimated cost',
    'models.usageLastUsed': 'Last used',
    'models.usageConversation': 'Conversation',
    'models.usageEmpty': 'No usage records yet. Send one chat message to see model, token, and cost records here.',
    'models.usageCostNote': 'Cost uses built-in estimate rates. Local and unknown-rate models show 0.',
    'server.eyebrow': 'Shared backend mode',
    'server.title': 'Point every device at the same knowledge base.',
    'server.body': 'Deploy the FastAPI backend on your server, then set this desktop app to that API URL. Your devices will share documents, model settings, and chat history.',
    'server.localMode': 'Local bundled backend',
    'server.remoteMode': 'Remote API backend',
    'server.endpoint': 'Backend endpoint',
    'server.token': 'Admin token',
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
    'diagnostics.title': 'RAG debug',
    'diagnostics.subtitle': 'Inspect retrieval hits, latency, and model generation time for each question.',
    'diagnostics.logs': 'Debug logs',
    'diagnostics.empty': 'No debug logs yet. Send a chat message or run a retrieval test to create one.',
    'settings.title': 'Settings',
    'settings.language': 'Interface language',
    'settings.languageNote': 'Language preference is saved on this desktop client.',
    'settings.mode': 'Workspace mode',
    'settings.modeNote': 'Simple mode keeps only the entry points you are likely to use every day.',
    'settings.simpleMode': 'Simple mode',
    'settings.simpleModeBody': 'Best for uploading project material, switching models, and asking questions.',
    'settings.proMode': 'Professional mode',
    'settings.proModeBody': 'Shows diagnostics, admin, evaluation, and advanced retrieval controls.',
    'settings.proModeEnabled': 'Professional mode is on',
    'settings.proModeDisabled': 'Simple mode is active',
    'settings.simpleModeSummary': 'Primary nav: Ask, Library, Models. Server stays in Settings.',
    'settings.proModeSummary': 'Adds Debug, Server, Admin, eval workflows, and advanced retrieval controls.',
    'settings.workspace': 'Workspace and server',
    'settings.workspaceNote': 'Connect to a remote backend or inspect the server only when you need to.',
    'settings.chinese': '中文',
    'settings.english': 'English',
    'settings.currentBackend': 'Current backend',
    'settings.backendLocal': 'Bundled local backend',
    'settings.openServer': 'Server connection',
    'settings.openDiagnostics': 'Diagnostics and eval',
    'settings.openAdmin': 'Admin overview',
}

const zhTranslations: Record<string, string> = {
  ...enTranslations,
  'app.subtitle': '项目记忆系统',
  'nav.ask': '问答',
  'nav.library': '知识库',
  'nav.models': '模型',
  'nav.diagnostics': '调试',
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
  'model.localEvidence': '本地检索问答',
  'model.localRag': '本地 RAG',
  'model.openaiCompatible': 'OpenAI 兼容',
  'common.refresh': '刷新',
  'common.dismiss': '关闭',
  'common.enabled': '已启用',
  'common.disabled': '已停用',
  'common.default': '默认',
  'common.save': '保存',
  'common.cancel': '取消',
  'common.retry': '重试',
  'common.close': '关闭',
  'common.view': '查看',
  'common.test': '测试',
  'common.testing': '测试中',
  'onboarding.title': '把你的项目资料变成可问答的知识库',
  'onboarding.body': '按这 4 步完成初始配置：创建项目、添加模型、上传项目文件夹、开始提问。后续也可以切换到远程后端。',
  'onboarding.step.project': '项目空间',
  'onboarding.step.model': '模型配置',
  'onboarding.step.upload': '上传资料',
  'onboarding.step.ask': '开始问答',
  'onboarding.start': '开始配置',
  'onboarding.done': '我知道了',
  'onboarding.progress': '第 {current} / {total} 步',
  'onboarding.previous': '上一步',
  'onboarding.next': '下一步',
  'onboarding.skip': '跳过引导',
  'onboarding.finish': '完成',
  'onboarding.workspace.title': '先确认项目空间',
  'onboarding.workspace.body': '这里决定当前问答、上传和检索使用哪个项目。不同项目建议分开，避免资料混在一起。',
  'onboarding.upload.title': '上传项目文件夹或压缩包',
  'onboarding.upload.body': '把源码、README、需求文档、复盘记录或 zip 压缩包放进来，Kortex 会自动索引成知识库。',
  'onboarding.rag.title': '调整检索方式',
  'onboarding.rag.body': '这里控制切片、Top K、向量或关键词混合检索，也能先跑测试看看问题会命中哪些资料。',
  'onboarding.models.title': '配置模型平台',
  'onboarding.models.body': '先选择平台，再填写 Base URL 和 API Key 拉取模型列表。选中的模型会出现在聊天输入框的切换器里。',
  'onboarding.chat.title': '切换模型并提问',
  'onboarding.chat.body': '这里选择本轮对话使用的模型，输入问题后按 Enter 发送，Shift + Enter 换行。',
  'chat.sessions': '会话',
  'chat.newThread': '新建会话',
  'chat.modelSwitcher': '切换模型',
  'chat.emptyTitle': '向你的项目记忆提问',
  'chat.emptyBody': '上传需求、交付记录、README、设计决策和复盘内容后，Kortex 会先检索证据再回答。',
  'chat.prompt.summary': '总结这个项目',
  'chat.prompt.deploy': '查找部署步骤',
  'chat.prompt.lessons': '提取可复用经验',
  'chat.you': '你',
  'chat.loading': '正在检索证据并生成回答',
  'chat.status.submitting': '正在提交问题',
  'chat.status.retrieving': '查询知识库中',
  'chat.status.thinking': '模型思考中',
  'chat.status.reasoningReceived': 'DeepSeek 思考中，已收到 {count} 段推理信号',
  'chat.status.streaming': '流式输出中',
  'chat.status.finalizing': '正在保存会话',
  'chat.status.failed': '生成失败',
  'chat.answerGrounded': '本次回答基于 {files} 个文件 / {chunks} 条证据',
  'chat.answerUngrounded': '这次回答没有附带知识库证据，请人工核对',
  'chat.costEstimated': '费用为估算值',
  'chat.activeModel': '当前模型',
  'chat.modelSwitched': '已切换到：{name}',
  'chat.noModel': '还没有可用模型',
  'chat.placeholder': '询问项目、决策、模块、部署、问题或经验...',
  'chat.send': '发送',
  'chat.requestFailed': '请求失败',
  'evidence.title': '证据',
  'evidence.summary': '回答依据',
  'evidence.bestMatch': '最佳命中',
  'evidence.sourceFiles': '来源文件',
  'evidence.empty': '回答后，这里会显示引用片段、来源文件和相似度。',
  'evidence.open': '打开引用',
  'evidence.previewTitle': '命中片段预览',
  'evidence.previewBody': '不离开当前对话，直接查看这次命中的片段。',
  'evidence.primaryHit': '主要命中片段',
  'evidence.fullDocument': '去知识库查看全文',
  'evidence.closePreview': '关闭预览',
  'library.ingest': '导入',
  'library.taskCenter': '导入任务',
  'library.fileTree': '文件树',
  'library.documentDetail': '文档详情',
  'library.ragSettings': 'RAG 设置',
  'library.debugQuery': '检索测试台',
  'library.debugPlaceholder': '输入测试问题并查看命中的切片...',
  'library.runDebug': '测试检索',
  'library.noTree': '上传项目文件后，这里会按路径展示文件树。',
  'library.noDetail': '从文件树或引用中选择一个文档查看切片。',
  'library.chunkSize': '切片大小',
  'library.chunkOverlap': '重叠',
  'library.topK': 'Top K',
  'library.threshold': '相似度阈值',
  'library.mode': '检索模式',
  'library.mode.vector': '向量',
  'library.mode.keyword': '关键词',
  'library.mode.hybrid': '混合',
  'library.settingsSaved': 'RAG 参数已保存。',
  'library.importEmpty': '还没有导入任务。',
  'library.openDocument': '打开文档',
  'library.drop': '把项目资料放进记忆库',
  'library.selected': '已选择 {count} 个文件',
  'library.fileTypes': '支持项目文件夹、zip、txt、md、pdf、docx、源码、日志、配置文件',
  'library.pickFolder': '选择项目文件夹',
  'library.pickFiles': '选择文件或压缩包',
  'library.skippedNotice': '已索引 {count} 个文件，跳过 {skipped} 个不可读或依赖文件。',
  'library.index': '开始索引',
  'library.newProject': '新建项目空间',
  'library.projectName': '项目名称',
  'library.projectDescription': '这个项目要放什么内容？',
  'library.createProject': '创建项目',
  'library.indexedFiles': '已索引文件',
  'library.filesCount': '{count} 个文件',
  'library.chunks': '{count} 个切片',
  'library.deleteDocument': '删除文档',
  'library.empty': '这个项目空间还没有已索引文件。',
  'library.documentRemoved': '文档已移除。',
  'library.uploadFailed': '上传失败',
  'library.indexedNotice': '已索引 {count} 个文件。',
  'library.projectCreated': '项目已创建：{name}',
  'library.preview': '切片预览',
  'library.previewReady': '已生成 {count} 个文件的切片预览。',
  'library.previewEmpty': '选择文件后先预览切片、重复内容和元数据。',
  'library.duplicate': '重复',
  'library.version': '版本',
  'library.metadata': '元数据',
  'library.metadataSaved': '文档元数据已保存。',
  'library.reindex': '重新索引',
  'library.reindexed': '已重新索引 {count} 个切片。',
  'library.batchDelete': '批量删除',
  'library.batchDeleted': '已删除 {count} 个文档。',
  'library.retry': '失败重试',
  'library.retryDone': '已重试 {count} 个文档。',
  'library.scope': '上下文范围',
  'library.scope.focused': '聚焦检索',
  'library.scope.full': '全文上下文',
  'library.queryRewrite': '多轮问题改写',
  'library.rerank': '重排',
  'library.agentTools': 'Agent 知识库工具',
  'library.fullContextLimit': '全文上下文上限',
  'library.embeddingModel': 'Embedding 模型',
  'library.rerankModel': 'Rerank 模型',
  'library.metadataFilter': '元数据过滤 JSON',
  'library.overview': '知识库概览',
  'library.documentsIndexed': '已索引文档',
  'library.totalChunks': '已存切片',
  'library.lastImport': '最近导入',
  'library.statusHealthy': '状态正常',
  'library.openTasks': '导入任务与跳过原因',
  'library.openProjectTools': '项目空间工具',
  'library.openAdvancedGuide': '高级检索设置',
  'library.openAdvancedGuideBody': '需要调整切片、Embedding、重排和检索诊断时，再切到专业模式。',
  'library.switchToProfessional': '切换到专业模式',
  'chat.feedback': '反馈',
  'chat.feedbackNote': '补充反馈...',
  'chat.feedbackSaved': '反馈已保存。',
  'chat.regenerate': '重新生成',
  'chat.regenerated': '已重新生成回答。',
  'eval.title': 'RAG 评测',
  'eval.subtitle': '用固定测试问题跟踪检索命中、回答覆盖和模型改动效果。',
  'eval.newCase': '新建测试问题',
  'eval.expectedAnswer': '期望答案关键词',
  'eval.expectedDocument': '期望来源文档',
  'eval.tags': '标签',
  'eval.caseCreated': '测试问题已创建。',
  'eval.run': '运行评测',
  'eval.runDone': '已完成 {count} 条评测。',
  'eval.cases': '测试集',
  'eval.runs': '最近运行',
  'eval.empty': '还没有测试问题。',
  'admin.health': '系统健康',
  'admin.backup': '下载备份',
  'admin.restore': '恢复备份',
  'admin.restoreDone': '备份已恢复。',
  'admin.dbSize': '数据库',
  'admin.uploadsSize': '上传数据',
  'admin.failedJobs': '失败任务',
  'admin.events': '系统事件',
  'models.preset.openai': 'OpenAI API',
  'models.preset.anthropic': 'Claude Messages API',
  'models.preset.google': 'Google AI Studio 密钥',
  'models.preset.compatible': 'OpenAI 兼容',
  'models.preset.qwen': 'DashScope 兼容模式',
  'models.preset.kimi': 'Moonshot 兼容 API',
  'models.preset.openrouter': '聚合多家托管模型',
  'models.preset.ollama': '本地私有模型',
  'models.endpoint': '模型端点',
  'models.displayName': '显示名称',
  'models.providerLabel': '提供商协议',
  'models.provider.local': '本地检索问答',
  'models.provider.ollama': 'Ollama',
  'models.provider.openai': 'OpenAI 兼容',
  'models.provider.anthropic': 'Anthropic Claude',
  'models.provider.google': 'Google Gemini',
  'models.modelId': '模型 ID',
  'models.baseUrl': 'Base URL',
  'models.apiKey': 'API Key',
  'models.temperature': '温度',
  'models.modelType': '模型用途',
  'models.type.chat': '对话',
  'models.type.embedding': '向量化',
  'models.type.rerank': '重排',
  'models.contextWindow': '上下文长度',
  'models.supportsTools': '工具',
  'models.supportsVision': '视觉',
  'models.connectionOk': '连接成功：{latency}ms',
  'models.connectionFailed': '连接失败：{error}',
  'models.lastTest': '最近测试',
  'models.save': '保存模型',
  'models.configured': '已加入问答切换器',
  'models.endpointCount': '{count} 个模型',
  'models.saved': '模型已保存：{name}',
  'models.title': '模型连接',
  'models.subtitle': '通过 Base URL 读取模型列表，再把选中的模型加入聊天切换器。',
  'models.platforms': '平台',
  'models.connection': '连接配置',
  'models.discovery': '可用模型',
  'models.discover': '获取模型列表',
  'models.discovering': '获取中',
  'models.discoveredCount': '发现 {count} 个模型',
  'models.manualModel': '手动输入模型 ID',
  'models.addManual': '加入列表',
  'models.saveSelected': '添加选中模型',
  'models.selectedCount': '已选择 {count} 个',
  'models.defaultStartup': '默认启动模型',
  'models.defaultStartupPlaceholder': '选择一个默认模型',
  'models.noDiscovered': '点击获取模型后会直接请求当前 Base URL；如果端点需要鉴权或没有模型列表接口，也可以手动输入模型 ID。',
  'models.apiKeyHint': '获取模型列表会直接请求 Base URL。需要鉴权时请填写 API Key；保存后不会明文显示。',
  'models.apiKeyRequired': '当前 Base URL 需要鉴权或暂时无法列出模型。已保留推荐模型，可直接勾选或手动输入模型 ID，之后再补 Key。',
  'models.keySet': '密钥已保存',
  'models.keyMissing': '未设置密钥',
  'models.edit': '编辑',
  'models.delete': '删除',
  'models.refreshOne': '重新获取',
  'models.savedBatch': '已加入 {count} 个模型到问答切换器。',
  'models.updated': '模型已更新。',
  'models.deleted': '模型已删除。',
  'models.emptyConfigured': '还没有加入问答切换器的模型。先从平台中选择模型。',
  'models.endpointGroup': '{provider} / {base}',
  'models.tab.config': '模型配置',
  'models.tab.usage': '模型用量',
  'models.activePlatform': '当前平台',
  'models.configuredForPlatform': '该平台已加入',
  'models.emptyConfiguredForPlatform': '这个平台还没有加入问答切换器的模型。',
  'models.usageTitle': '模型用量',
  'models.usageSubtitle': '记录每次对话实际使用的模型、估算 token 和费用，方便确认切换是否生效。',
  'models.usageCalls': '调用次数',
  'models.usageInput': '输入 token',
  'models.usageOutput': '输出 token',
  'models.usageTotal': '总 token',
  'models.usageCost': '预估费用',
  'models.usageLastUsed': '最近使用',
  'models.usageConversation': '所属会话',
  'models.usageEmpty': '还没有模型用量记录。发送一条消息后这里会显示模型、token 和费用。',
  'models.usageCostNote': '费用基于内置估算费率；本地或未知费率模型显示 0。',
  'server.eyebrow': '共享后端模式',
  'server.title': '让每台设备指向同一个知识库。',
  'server.body': '把 FastAPI 后端部署到你的服务器后，这个桌面端只需要填写 API 地址，就能共享文档、模型配置和聊天记录。',
  'server.localMode': '本地内置后端',
  'server.remoteMode': '远程 API 后端',
  'server.endpoint': '后端地址',
  'server.token': '管理令牌',
  'server.placeholder': 'https://kb.your-domain.com，留空则使用本地',
  'server.save': '保存地址',
  'server.test': '测试连接',
  'server.savedRemote': '远程服务器已保存，后续 API 请求会走该后端。',
  'server.savedLocal': '已切回内置本地后端。',
  'server.testOk': '服务器连接成功。',
  'server.testFailed': '服务器测试失败',
  'server.localNote': '这里的地址只保存在当前桌面端，不会改写已安装程序。',
  'server.notes': '部署说明',
  'server.note1': '服务端可用 Docker Compose 或进程管理器运行 FastAPI，并通过 Nginx、Caddy 或云负载均衡提供 HTTPS。',
  'server.note2': '把 KB_DATA_DIR 放在持久化磁盘上，确保上传文件、SQLite 数据和向量不会随部署丢失。',
  'server.note3': '多设备或多人协作时，可升级为 PostgreSQL + pgvector，桌面端不需要大改。',
  'admin.projects': '项目',
  'admin.documents': '文档',
  'admin.chunks': '切片',
  'admin.conversations': '会话',
  'admin.models': '模型',
  'admin.recentDocuments': '最近文档',
  'admin.recentSessions': '最近会话',
  'diagnostics.title': 'RAG 调试',
  'diagnostics.subtitle': '检查每次问答的检索命中、耗时和模型生成耗时。',
  'diagnostics.logs': '调试日志',
  'diagnostics.empty': '还没有调试日志。发送消息或运行检索测试后会出现记录。',
  'settings.title': '设置',
  'settings.language': '界面语言',
  'settings.languageNote': '语言偏好会保存在当前桌面端。',
  'settings.mode': '工作模式',
  'settings.modeNote': '简洁模式只保留你日常高频使用的入口。',
  'settings.simpleMode': '简洁模式',
  'settings.simpleModeBody': '适合上传项目资料、切换模型和直接提问。',
  'settings.proMode': '专业模式',
  'settings.proModeBody': '显示调试、后台、评测和高级检索设置。',
  'settings.proModeEnabled': '专业模式已开启',
  'settings.proModeDisabled': '当前为简洁模式',
  'settings.simpleModeSummary': '一级导航只保留问答、知识库、模型，服务器入口放在设置里。',
  'settings.proModeSummary': '额外显示调试、服务器、后台、评测流程和高级检索设置。',
  'settings.workspace': '工作区与服务器',
  'settings.workspaceNote': '需要时再连接远程后端或查看服务器状态。',
  'settings.chinese': '中文',
  'settings.english': 'English',
  'settings.currentBackend': '当前后端',
  'settings.backendLocal': '内置本地后端',
  'settings.openServer': '服务器连接',
  'settings.openDiagnostics': '调试与评测',
  'settings.openAdmin': '后台概览',
}

const translations: Record<Language, Record<string, string>> = {
  zh: zhTranslations,
  en: enTranslations,
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

function formatCost(value = 0, currency = 'USD') {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: value > 0 && value < 0.01 ? 6 : 4,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 4,
  }).format(value)
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function normalizeApiBase(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function loadServerProfiles() {
  if (typeof window === 'undefined') return [] as ServerProfile[]
  try {
    const raw = localStorage.getItem(SERVER_PROFILES_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item) => ({
          id: String(item?.id || crypto.randomUUID()),
          name: String(item?.name || '连接配置'),
          base_url: String(item?.base_url || ''),
          token: String(item?.token || ''),
          last_checked_at: item?.last_checked_at ? String(item.last_checked_at) : undefined,
          last_status: item?.last_status === 'checking' || item?.last_status === 'online' || item?.last_status === 'offline' ? item.last_status : undefined,
          last_error: item?.last_error ? String(item.last_error) : undefined,
        })) as ServerProfile[]
      }
    }
  } catch {
    // Ignore corrupted local config and fall back to defaults.
  }
  const savedBase = getApiBase()
  const savedToken = getApiToken()
  return [
    { id: 'local', name: '本地', base_url: savedBase, token: savedToken, last_status: savedBase ? 'online' : undefined },
    { id: 'home', name: '家里服务器', base_url: '', token: '' },
    { id: 'cloud', name: '云服务器', base_url: '', token: '' },
  ] as ServerProfile[]
}

function loadUsageBudget() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(USAGE_BUDGET_STORAGE_KEY) || ''
}

function fileExtensionLabel(filename: string) {
  const clean = filename.split('/').pop() || filename
  const dot = clean.lastIndexOf('.')
  if (dot < 0 || dot === clean.length - 1) return 'FILE'
  return clean.slice(dot + 1).toUpperCase()
}

function summarizeCitationTypes(citations: Citation[]) {
  return Array.from(new Set(citations.map((citation) => fileExtensionLabel(citation.filename)))).slice(0, 4)
}

function buildPathTree<T extends { filename: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const normalized = item.filename.replace(/\\/g, '/')
    const root = normalized.includes('/') ? normalized.split('/')[0] : 'root'
    if (!groups[root]) groups[root] = []
    groups[root].push(item)
    return groups
  }, {})
}

function isCorruptedPlaceholder(value?: string) {
  const trimmed = (value || '').trim()
  if (!trimmed || trimmed.length < 4) return false
  const questionMarkCount = (trimmed.match(/[?\uFF1F]/g) || []).length
  return /^[?\uFF1F\s]+$/.test(trimmed) || questionMarkCount >= 4 && questionMarkCount / trimmed.length >= 0.5
}

function displayRecoverableText(value: string | undefined, language: Language, fallback = '') {
  if (!value) return fallback
  if (isCorruptedPlaceholder(value)) {
    return language === 'zh' ? '历史内容已损坏' : 'Historical text was corrupted'
  }
  return value
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function getStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'zh'
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh'
}

function App() {
  const [language, setLanguageState] = useState<Language>(getStoredLanguage)
  const [activeView, setActiveView] = useState<View>('chat')
  const [isProfessionalMode, setIsProfessionalMode] = useState(() => typeof window !== 'undefined' && localStorage.getItem(PROFESSIONAL_MODE_STORAGE_KEY) === '1')
  const [projects, setProjects] = useState<Project[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [documentTree, setDocumentTree] = useState<DocumentTreeNode | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null)
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null)
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([])
  const [documentPreviews, setDocumentPreviews] = useState<DocumentPreview[]>([])
  const [previewSkipped, setPreviewSkipped] = useState<ImportResultItem[]>([])
  const [previewSummary, setPreviewSummary] = useState<ImportSummary | null>(null)
  const [lastImportSnapshot, setLastImportSnapshot] = useState<{ summary: ImportSummary; results: ImportResultItem[] } | null>(null)
  const [importJobs, setImportJobs] = useState<ImportJob[]>([])
  const [expandedImportJobIds, setExpandedImportJobIds] = useState<number[]>([])
  const [knowledgeLayer, setKnowledgeLayer] = useState<KnowledgeLayer>('daily')
  const [ragDebugQuery, setRagDebugQuery] = useState('')
  const [ragDebugResult, setRagDebugResult] = useState<RagDebugResult | null>(null)
  const [isDebuggingRag, setIsDebuggingRag] = useState(false)
  const [ragLogs, setRagLogs] = useState<RagLog[]>([])
  const [evalCases, setEvalCases] = useState<EvalCase[]>([])
  const [evalRuns, setEvalRuns] = useState<EvalRun[]>([])
  const [newEvalCase, setNewEvalCase] = useState({ question: '', expected_answer: '', expected_document: '', tags: '' })
  const [isRunningEval, setIsRunningEval] = useState(false)
  const [searchAllProjects, setSearchAllProjects] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [globalSearchResult, setGlobalSearchResult] = useState<SearchResult | null>(null)
  const [isGlobalSearching, setIsGlobalSearching] = useState(false)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>([])
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([])
  const [usageTotals, setUsageTotals] = useState<ModelUsageTotal[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [adminHealth, setAdminHealth] = useState<AdminHealth | null>(null)
  const [syncSources, setSyncSources] = useState<SyncSource[]>([])
  const [syncSourceDraft, setSyncSourceDraft] = useState<SyncSourceDraft>({
    name: '',
    source_path: '',
    poll_interval_seconds: 60,
    include_globs: '',
    exclude_globs: '',
    delete_missing: false,
  })
  const [scanningSyncSourceId, setScanningSyncSourceId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(1)
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>()
  const [selectedPresetId, setSelectedPresetId] = useState<number | undefined>()
  const [conversationId, setConversationId] = useState<number | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [authSession, setAuthSession] = useState<AuthSessionInfo | null>(null)
  const [deviceSessions, setDeviceSessions] = useState<DeviceSession[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])
  const [authGateMode, setAuthGateMode] = useState<AuthGateMode>('loading')
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [loginForm, setLoginForm] = useState<AuthFormState>({
    email: '',
    display_name: '',
    password: '',
    device_name: typeof window !== 'undefined' ? window.navigator.platform || 'Current device' : 'Current device',
  })
  const [setupForm, setSetupForm] = useState<AuthFormState>({
    email: '',
    display_name: '',
    password: '',
    device_name: typeof window !== 'undefined' ? window.navigator.platform || 'Current device' : 'Current device',
  })
  const [acceptInviteForm, setAcceptInviteForm] = useState<InviteAcceptDraft>({
    invite_token: '',
    display_name: '',
    password: '',
    device_name: typeof window !== 'undefined' ? window.navigator.platform || 'Current device' : 'Current device',
  })
  const [invitePreview, setInvitePreview] = useState<TeamInvitationPreview | null>(null)
  const [isLoadingInvitePreview, setIsLoadingInvitePreview] = useState(false)
  const [teamInviteDraft, setTeamInviteDraft] = useState<TeamInviteDraft>({
    email: '',
    workspace_role: 'member',
    project_role: 'viewer',
    project_ids: [],
    message: '',
    expires_in_days: 7,
  })
  const [projectShareDraft, setProjectShareDraft] = useState<ProjectShareDraft>({
    user_id: undefined,
    role: 'viewer',
  })
  const [chatTimeline, setChatTimeline] = useState<ChatTimelineItem[]>([])
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [citationPreview, setCitationPreview] = useState<CitationPreviewState | null>(null)
  const [, setIsLoading] = useState(true)
  const [chatMachine, dispatchChatMachine] = useReducer(chatMachineReducer, createInitialChatMachineState())
  const [isUploading, setIsUploading] = useState(false)
  const [ingestAction, setIngestAction] = useState<'preview' | 'index' | null>(null)
  const [files, setFiles] = useState<FileList | null>(null)
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase())
  const [apiTokenInput, setApiTokenInput] = useState(getApiToken())
  const [serverProfiles, setServerProfiles] = useState<ServerProfile[]>(loadServerProfiles)
  const [selectedServerProfileId, setSelectedServerProfileId] = useState(() => {
    const profiles = loadServerProfiles()
    const activeBase = normalizeApiBase(getApiBase())
    return profiles.find((profile) => normalizeApiBase(profile.base_url) === activeBase)?.id ?? profiles[0]?.id ?? 'local'
  })
  const [connectionState, setConnectionState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [modelTab, setModelTab] = useState<ModelModuleTab>('config')
  const [configuredModelSort, setConfiguredModelSort] = useState<'default' | 'name' | 'latency'>('default')
  const [usageBudgetInput, setUsageBudgetInput] = useState(loadUsageBudget)
  const [showOnboarding, setShowOnboarding] = useState(() => typeof window !== 'undefined' && localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1')
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [onboardingTargetRect, setOnboardingTargetRect] = useState<TourRect | null>(null)
  const [newProject, setNewProject] = useState({ name: '', description: '' })
  const [projectSettingsDraft, setProjectSettingsDraft] = useState({
    chunk_size: 1200,
    chunk_overlap: 160,
    retrieval_top_k: 5,
    retrieval_mode: 'hybrid' as RetrievalMode,
    retrieval_scope: 'focused' as RetrievalScope,
    similarity_threshold: 0,
    query_rewrite_enabled: false,
    rerank_enabled: false,
    agent_tools_enabled: false,
    full_context_limit: 20,
    metadata_filter_json: '{}',
    embedding_model_id: undefined as number | undefined,
    rerank_model_id: undefined as number | undefined,
  })
  const [modelForm, setModelForm] = useState<ModelFormState>({
    platformId: 'openai',
    provider: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    temperature: 0.2,
    model_type: 'chat',
    context_window: 0,
    supports_tools: false,
    supports_vision: false,
    manual_model: '',
    default_model: '',
  })
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>(() => modelPlatforms[0].models.map((id) => ({ id, name: id })))
  const [selectedDiscoveryIds, setSelectedDiscoveryIds] = useState<string[]>([])
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false)
  const [editingModelId, setEditingModelId] = useState<number | null>(null)
  const [modelDrafts, setModelDrafts] = useState<Record<number, ModelEditDraft>>({})
  const [refreshingModelId, setRefreshingModelId] = useState<number | null>(null)
  const [testingModelId, setTestingModelId] = useState<number | null>(null)
  const [presetDraft, setPresetDraft] = useState<ModelPresetDraft>({
    name: '',
    description: '',
    project_id: 1,
    model_id: undefined,
    system_prompt: '',
    temperature: 0.2,
    retrieval_scope: 'focused',
    retrieval_mode: 'hybrid',
    top_k: 5,
    similarity_threshold: 0,
    use_query_rewrite: false,
    use_rerank: false,
    metadata_filter_json: '{}',
    tools_json: '[]',
    is_default: false,
  })
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<number, string>>({})
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const chatRequestIdRef = useRef(0)
  const visibleOnboardingSteps = useMemo(
    () => (isProfessionalMode ? onboardingSteps : onboardingSteps.filter((step) => step.id !== 'rag')),
    [isProfessionalMode],
  )
  const visibleNavItems = useMemo(
    () => (isProfessionalMode ? navItems : navItems.filter((item) => item.id === 'chat' || item.id === 'knowledge' || item.id === 'models')),
    [isProfessionalMode],
  )

  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => {
      let value = translations[language][key] ?? translations.en[key] ?? key
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

  const setProfessionalMode = useCallback((enabled: boolean) => {
    setIsProfessionalMode(enabled)
    localStorage.setItem(PROFESSIONAL_MODE_STORAGE_KEY, enabled ? '1' : '0')
  }, [])

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ id: Date.now(), message, tone })
  }, [])

  const copyText = useCallback(
    async (value: string, successMessage: string) => {
      if (!value.trim()) return
      try {
        await navigator.clipboard.writeText(value)
        showToast(successMessage, 'success')
      } catch (error) {
        showToast(error instanceof Error ? error.message : successMessage, 'danger')
      }
    },
    [showToast],
  )

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const inviteToken = params.get('invite')?.trim()
    if (!inviteToken) return
    setAcceptInviteForm((current) => (current.invite_token ? current : { ...current, invite_token: inviteToken }))
  }, [])

  useEffect(() => {
    if (isProfessionalMode) return
    if (activeView === 'diagnostics' || activeView === 'admin') {
      setActiveView('chat')
    }
    if (modelTab !== 'config') {
      setModelTab('config')
    }
  }, [activeView, isProfessionalMode, modelTab])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(SERVER_PROFILES_STORAGE_KEY, JSON.stringify(serverProfiles))
  }, [serverProfiles])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const normalized = usageBudgetInput.trim()
    if (normalized) {
      localStorage.setItem(USAGE_BUDGET_STORAGE_KEY, normalized)
    } else {
      localStorage.removeItem(USAGE_BUDGET_STORAGE_KEY)
    }
  }, [usageBudgetInput])

  useEffect(() => {
    if (!citationPreview) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCitationPreview(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [citationPreview])

  useEffect(() => {
    const token = acceptInviteForm.invite_token.trim()
    if (!token || token.length < 8) {
      setInvitePreview(null)
      setIsLoadingInvitePreview(false)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      setIsLoadingInvitePreview(true)
      api.previewTeamInvite(token)
        .then((preview) => {
          if (!active) return
          setInvitePreview(preview)
        })
        .catch(() => {
          if (!active) return
          setInvitePreview(null)
        })
        .finally(() => {
          if (!active) return
          setIsLoadingInvitePreview(false)
        })
    }, 220)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [acceptInviteForm.invite_token])

  useEffect(() => {
    if (!showOnboarding) return
    const step = visibleOnboardingSteps[Math.min(onboardingStep, visibleOnboardingSteps.length - 1)]
    if (!step) return

    if (activeView !== step.view) {
      setActiveView(step.view)
      return
    }

    let frame = 0
    let scrollTimer = 0

    const updateTarget = () => {
      const target = document.querySelector<HTMLElement>(step.target)
      if (!target) {
        setOnboardingTargetRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      setOnboardingTargetRect({
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
    }

    const revealTarget = () => {
      const target = document.querySelector<HTMLElement>(step.target)
      if (!target) {
        setOnboardingTargetRect(null)
        return
      }

      const rect = target.getBoundingClientRect()
      const isOutOfView =
        rect.top < 76 ||
        rect.bottom > window.innerHeight - 24 ||
        rect.left < 16 ||
        rect.right > window.innerWidth - 16

      if (isOutOfView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
        scrollTimer = window.setTimeout(updateTarget, 260)
      }
      updateTarget()
    }

    frame = window.requestAnimationFrame(revealTarget)
    const handleViewportChange = () => updateTarget()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(scrollTimer)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [activeView, onboardingStep, showOnboarding, visibleOnboardingSteps])

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

  const workspaceRoleLabel = useCallback(
    (role?: 'owner' | 'admin' | 'member' | 'viewer' | null) => {
      switch (role) {
        case 'owner':
          return language === 'zh' ? '所有者' : 'Owner'
        case 'admin':
          return language === 'zh' ? '管理员' : 'Admin'
        case 'viewer':
          return language === 'zh' ? '查看者' : 'Viewer'
        default:
          return language === 'zh' ? '成员' : 'Member'
      }
    },
    [language],
  )

  const workspaceRoleDescription = useCallback(
    (role?: 'owner' | 'admin' | 'member' | 'viewer' | null) => {
      switch (role) {
        case 'owner':
          return language === 'zh' ? '可管理团队、项目共享与关键设置。' : 'Can manage the workspace, sharing, and core settings.'
        case 'admin':
          return language === 'zh' ? '可邀请成员、调整角色、管理多个项目。' : 'Can invite members, adjust roles, and manage projects.'
        case 'viewer':
          return language === 'zh' ? '仅查看被共享的项目与回答结果。' : 'Can only read shared projects and answers.'
        default:
          return language === 'zh' ? '可在被授权项目内上传、整理与问答。' : 'Can upload, curate, and chat within granted projects.'
      }
    },
    [language],
  )

  const projectRoleLabel = useCallback(
    (role?: 'owner' | 'editor' | 'viewer' | null) => {
      switch (role) {
        case 'owner':
          return language === 'zh' ? '项目所有者' : 'Project owner'
        case 'editor':
          return language === 'zh' ? '编辑者' : 'Editor'
        default:
          return language === 'zh' ? '查看者' : 'Viewer'
      }
    },
    [language],
  )

  const modelOptionLabel = useCallback(
    (model: ModelConfig) => `${providerLabel(model.provider)} / ${model.model}`,
    [providerLabel],
  )

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  )
  const workspaceRole = authSession?.user?.workspace_role
  const canManageWorkspace = workspaceRole === 'owner' || workspaceRole === 'admin' || authSession?.role === 'open'
  const canWriteProject = selectedProject?.access_role === 'owner' || selectedProject?.access_role === 'editor' || canManageWorkspace
  const canManageProject = selectedProject?.access_role === 'owner' || canManageWorkspace
  const enabledModels = useMemo(() => models.filter((model) => model.enabled), [models])
  const selectedPreset = useMemo(
    () =>
      modelPresets.find((preset) => preset.id === selectedPresetId) ??
      modelPresets.find((preset) => preset.is_default) ??
      modelPresets[0],
    [modelPresets, selectedPresetId],
  )
  const selectedModel = useMemo(
    () => enabledModels.filter((model) => model.model_type === 'chat').find((model) => model.id === selectedModelId) ?? enabledModels.find((model) => model.model_type === 'chat' && model.is_default) ?? enabledModels.find((model) => model.model_type === 'chat'),
    [enabledModels, selectedModelId],
  )
  const activePlatform = useMemo(
    () => modelPlatforms.find((platform) => platform.id === modelForm.platformId) ?? modelPlatforms[0],
    [modelForm.platformId],
  )
  const chatModelOptions = (enabledModels.length ? enabledModels : models).filter((model) => model.model_type === 'chat')
  const isSending = isChatMachineBusy(chatMachine.stage)
  const latestAssistantMessage = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant'), [messages])
  const latestCitations = useMemo(() => {
    return latestAssistantMessage?.citations ?? []
  }, [latestAssistantMessage])
  const latestAssistantDebug = useMemo(
    () => latestAssistantMessage?.debug,
    [latestAssistantMessage],
  )
  const selectedInviteProjects = useMemo(
    () => projects.filter((project) => teamInviteDraft.project_ids.includes(project.id)),
    [projects, teamInviteDraft.project_ids],
  )
  const collaborationMetrics = useMemo(
    () => [
      {
        key: 'members',
        label: language === 'zh' ? '团队成员' : 'Team members',
        value: teamMembers.length.toLocaleString(),
        detail: language === 'zh' ? '已加入工作区的成员数' : 'People in this workspace',
      },
      {
        key: 'invites',
        label: language === 'zh' ? '待处理邀请' : 'Pending invites',
        value: teamInvitations.filter((item) => item.status === 'pending').length.toLocaleString(),
        detail: language === 'zh' ? '还未接受的邀请码' : 'Invites waiting to be accepted',
      },
      {
        key: 'share',
        label: language === 'zh' ? '当前项目成员' : 'Current project members',
        value: projectMembers.length.toLocaleString(),
        detail: selectedProject ? displayProjectName(selectedProject.name) : (language === 'zh' ? '未选择项目' : 'No project selected'),
      },
    ],
    [displayProjectName, language, projectMembers.length, selectedProject, teamInvitations, teamMembers.length],
  )

  const applyAuthPayload = useCallback((session: AuthSessionInfo) => {
    setAuthSession(session)
    if (session.setup_required) {
      setAuthGateMode('setup')
      return
    }
    if (session.auth_required && session.role === 'anonymous') {
      setAuthGateMode('login')
      return
    }
    setAuthGateMode('ready')
  }, [])

  const loadAuthState = useCallback(async () => {
    const session = await api.authSession()
    applyAuthPayload(session)
    if (session.role === 'admin' || session.role === 'user') {
      const sessions = await api.authSessions().catch(() => [])
      setDeviceSessions(sessions)
    } else {
      setDeviceSessions([])
    }
    return session
  }, [applyAuthPayload])

  const refreshAll = useCallback(async (sessionInfo?: AuthSessionInfo | null) => {
    setConnectionState('checking')
    const effectiveSession = sessionInfo ?? authSession
    const includeAdmin = effectiveSession?.role === 'open' || effectiveSession?.user?.workspace_role === 'owner' || effectiveSession?.user?.workspace_role === 'admin'
    const [projectData, modelData, presetData, conversationData, statsData, usageData, healthData, evalCaseData, evalRunData] = await Promise.all([
      api.projects(),
      api.models(),
      api.modelPresets(),
      api.conversations(),
      includeAdmin ? api.stats() : Promise.resolve(null),
      api.modelUsage(),
      includeAdmin ? api.adminHealth() : Promise.resolve(null),
      api.evalCases(),
      api.evalRuns(),
    ])
    setProjects(projectData)
    setModels(modelData)
    setModelPresets(presetData)
    setConversations(conversationData)
    setStats(statsData)
    setAdminHealth(healthData)
    setModelUsage(usageData.items)
    setUsageTotals(usageData.totals)
    setEvalCases(evalCaseData)
    setEvalRuns(evalRunData)
    const defaultProjectId = selectedProjectId || projectData[0]?.id
    setSelectedProjectId(defaultProjectId)
    setSelectedModelId((current) => current ?? modelData.find((model) => model.enabled && model.model_type === 'chat' && model.is_default)?.id ?? modelData.find((model) => model.enabled && model.model_type === 'chat')?.id)
    setSelectedPresetId((current) => current ?? presetData.find((preset) => preset.is_default)?.id ?? presetData[0]?.id)
    if (!defaultProjectId) {
      setDocuments([])
      setDocumentTree(null)
      setImportJobs([])
      setRagLogs([])
      setSyncSources([])
      setConnectionState('online')
      return
    }
    const [documentData, treeData, importData, logData, projectEvalCases, syncSourceData] = await Promise.all([
      api.documents(defaultProjectId),
      api.documentTree(defaultProjectId),
      api.importJobs(defaultProjectId),
      api.ragLogs(defaultProjectId),
      api.evalCases(defaultProjectId),
      api.syncSources(defaultProjectId),
    ])
    setDocuments(documentData)
    setDocumentTree(treeData)
    setImportJobs(importData)
    setRagLogs(logData)
    setEvalCases(projectEvalCases)
    setSyncSources(syncSourceData)
    setConnectionState('online')
  }, [authSession, selectedProjectId])

  useEffect(() => {
    loadAuthState()
      .then((session) => {
        if (session.setup_required || (session.auth_required && session.role === 'anonymous')) {
          setConnectionState('online')
          return
        }
        return refreshAll(session)
      })
      .catch((error) => {
        setConnectionState('offline')
        showToast(error.message, 'danger')
      })
      .finally(() => setIsLoading(false))
  }, [loadAuthState, refreshAll, showToast])

  useEffect(() => {
    if (authGateMode !== 'ready') return
    if (!selectedProjectId) return
    Promise.all([api.documents(selectedProjectId), api.documentTree(selectedProjectId), api.importJobs(selectedProjectId), api.ragLogs(selectedProjectId), api.evalCases(selectedProjectId), api.syncSources(selectedProjectId)])
      .then(([documentData, treeData, importData, logData, evalCaseData, syncSourceData]) => {
        setDocuments(documentData)
        setDocumentTree(treeData)
        setImportJobs(importData)
        setRagLogs(logData)
        setEvalCases(evalCaseData)
        setSyncSources(syncSourceData)
      })
      .catch((error) => showToast(error.message, 'danger'))
  }, [authGateMode, selectedProjectId, showToast])

  useEffect(() => {
    if (!selectedProject) return
    setProjectSettingsDraft({
      chunk_size: selectedProject.chunk_size || 1200,
      chunk_overlap: selectedProject.chunk_overlap || 160,
      retrieval_top_k: selectedProject.retrieval_top_k || 5,
      retrieval_mode: selectedProject.retrieval_mode || 'hybrid',
      retrieval_scope: selectedProject.retrieval_scope || 'focused',
      similarity_threshold: selectedProject.similarity_threshold || 0,
      query_rewrite_enabled: Boolean(selectedProject.query_rewrite_enabled),
      rerank_enabled: Boolean(selectedProject.rerank_enabled),
      agent_tools_enabled: Boolean(selectedProject.agent_tools_enabled),
      full_context_limit: selectedProject.full_context_limit || 20,
      metadata_filter_json: selectedProject.metadata_filter_json || '{}',
      embedding_model_id: selectedProject.embedding_model_id,
      rerank_model_id: selectedProject.rerank_model_id,
    })
    setTeamInviteDraft((current) =>
      current.project_ids.length
        ? current
        : { ...current, project_ids: selectedProject.id ? [selectedProject.id] : [] },
    )
  }, [selectedProject])

  useEffect(() => {
    if (authGateMode !== 'ready') return
    if (!canManageWorkspace) {
      setTeamMembers([])
      setTeamInvitations([])
      return
    }
    Promise.all([api.teamMembers(), api.teamInvitations()])
      .then(([members, invitations]) => {
        setTeamMembers(members)
        setTeamInvitations(invitations)
      })
      .catch((error) => showToast(error.message, 'danger'))
  }, [authGateMode, canManageWorkspace, showToast])

  useEffect(() => {
    if (authGateMode !== 'ready') return
    if (!selectedProject?.id) {
      setProjectMembers([])
      return
    }
    api.projectMembers(selectedProject.id)
      .then((items) => setProjectMembers(items))
      .catch((error) => {
        setProjectMembers([])
        showToast(error.message, 'danger')
      })
  }, [authGateMode, selectedProject?.id, showToast])

  useEffect(() => {
    if (!isProfessionalMode) setKnowledgeLayer('daily')
  }, [isProfessionalMode])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    if (!selectedChunkId) return
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-chunk-id="${selectedChunkId}"]`)
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [selectedChunkId, selectedDocument])

  function pushChatTimeline(stage: string, label: string, detail = '') {
    setChatTimeline((current) => {
      const next: ChatTimelineItem = {
        id: `${Date.now()}-${stage}-${current.length}`,
        stage,
        label,
        detail,
        at: Date.now(),
      }
      const previous = current[current.length - 1]
      if (previous && previous.stage === stage && previous.detail === detail) return current
      return [...current, next]
    })
  }

  function citationWhy(citation: Citation) {
    const reasons: string[] = []
    if ((citation.rerank_score || 0) > 0) reasons.push(`R ${Math.round((citation.rerank_score || 0) * 100)}%`)
    if ((citation.vector_score || 0) > 0) reasons.push(`V ${Math.round((citation.vector_score || 0) * 100)}%`)
    if ((citation.keyword_score || 0) > 0) reasons.push(`K ${Math.round((citation.keyword_score || 0) * 100)}%`)
    return reasons.join(' / ') || `${Math.round((citation.score || 0) * 100)}%`
  }

  function retrievalModeLabel(mode?: string) {
    if (mode === 'vector') return t('library.mode.vector')
    if (mode === 'keyword') return t('library.mode.keyword')
    return t('library.mode.hybrid')
  }

  function retrievalScopeLabel(scope?: string) {
    if (scope === 'full_context') return t('library.scope.full')
    return t('library.scope.focused')
  }

  function documentStatusLabel(status?: string) {
    if (status === 'ready') return language === 'zh' ? '已索引' : 'Indexed'
    if (status === 'failed') return language === 'zh' ? '失败' : 'Failed'
    if (status === 'missing') return language === 'zh' ? '源文件缺失' : 'Missing source'
    if (status === 'running') return language === 'zh' ? '处理中' : 'Running'
    return status || (language === 'zh' ? '未知' : 'Unknown')
  }

  function chatTimelineLabel(status: string) {
    if (status === 'submitting') return language === 'zh' ? '提交问题' : 'Submitting question'
    if (status === 'retrieving') return language === 'zh' ? '检索知识库' : 'Retrieving knowledge'
    if (status === 'thinking') return language === 'zh' ? '模型思考中' : 'Model thinking'
    if (status === 'answering') return language === 'zh' ? '开始生成' : 'Preparing answer'
    if (status === 'reasoning') return language === 'zh' ? '收到推理信号' : 'Reasoning signal'
    if (status === 'streaming') return language === 'zh' ? '流式输出' : 'Streaming answer'
    if (status === 'finalizing') return language === 'zh' ? '保存会话' : 'Saving conversation'
    if (status === 'completed') return language === 'zh' ? '完成' : 'Completed'
    if (status === 'failed') return language === 'zh' ? '失败' : 'Failed'
    return status
  }

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault()
    if (!newProject.name.trim()) return
    const created = await api.createProject(newProject)
    setNewProject({ name: '', description: '' })
    setSelectedProjectId(created.id)
    showToast(t('library.projectCreated', { name: created.name }), 'success')
    await refreshAll()
  }

  async function handleUpload() {
    if (!files?.length || !selectedProject) return
    setIsUploading(true)
    setIngestAction('index')
    try {
      const result = await api.uploadDocuments(selectedProject.id, files)
      setLastImportSnapshot({ summary: result.summary, results: result.results })
      setPreviewSummary(null)
      setFiles(null)
      setDocumentPreviews([])
      setPreviewSkipped([])
      showToast(
        result.summary.failed_files || result.summary.duplicate_files || result.summary.skipped_files
          ? t('library.skippedNotice', { count: result.summary.indexed_files, skipped: result.summary.failed_files + result.summary.duplicate_files + result.summary.skipped_files })
          : t('library.indexedNotice', { count: result.summary.indexed_files }),
        'success',
      )
      await refreshAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('library.uploadFailed'), 'danger')
    } finally {
      setIsUploading(false)
      setIngestAction(null)
    }
  }

  async function handlePreviewDocuments() {
    if (!files?.length || !selectedProject) return
    setIsUploading(true)
    setIngestAction('preview')
    try {
      const result = await api.previewDocuments(selectedProject.id, files)
      setDocumentPreviews(result.items)
      setPreviewSkipped(result.skipped)
      setPreviewSummary(result.summary)
      showToast(t('library.previewReady', { count: result.items.length }), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('library.uploadFailed'), 'danger')
    } finally {
      setIsUploading(false)
      setIngestAction(null)
    }
  }

  async function handleDeleteDocument(id: number) {
    await api.deleteDocument(id)
    showToast(t('library.documentRemoved'), 'success')
    if (selectedDocument?.id === id) {
      setSelectedDocument(null)
      setSelectedChunkId(null)
    }
    await refreshAll()
  }

  async function handleBatchDeleteDocuments() {
    if (!selectedDocumentIds.length) return
    const result = await api.batchDeleteDocuments(selectedDocumentIds)
    showToast(t('library.batchDeleted', { count: result.deleted }), result.failed.length ? 'warning' : 'success')
    setSelectedDocumentIds([])
    if (selectedDocument && selectedDocumentIds.includes(selectedDocument.id)) {
      setSelectedDocument(null)
      setSelectedChunkId(null)
    }
    await refreshAll()
  }

  async function handleReindexDocument(id: number) {
    const result = await api.reindexDocument(id)
    showToast(t('library.reindexed', { count: result.chunks }), 'success')
    await openDocument(id)
    await refreshAll()
  }

  async function handleSaveDocumentMetadata() {
    if (!selectedDocument) return
    try {
      const metadata = JSON.parse(selectedDocument.metadata_json || JSON.stringify(selectedDocument.metadata || {}, null, 2))
      const detail = await api.patchDocumentMetadata(selectedDocument.id, { title: selectedDocument.title, metadata })
      setSelectedDocument(detail)
      showToast(t('library.metadataSaved'), 'success')
      await refreshAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleRetryImportJob(id: number) {
    try {
      const result = await api.retryImportJob(id)
      setLastImportSnapshot({ summary: result.summary, results: result.items.map((item) => ({ ...item, status: 'indexed' as const })) })
      showToast(t('library.retryDone', { count: result.retried }), 'success')
      await refreshAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'warning')
    }
  }

  async function handleSaveFeedback(message: ChatMessage, rating: number) {
    if (!conversationId || !message.id) return
    await api.saveFeedback({ conversation_id: conversationId, message_id: message.id, rating, note: feedbackDrafts[message.id] || '' })
    setFeedbackDrafts((current) => ({ ...current, [message.id!]: '' }))
    showToast(t('chat.feedbackSaved'), 'success')
  }

  async function handleRegenerate() {
    if (!conversationId) return
    try {
      await api.regenerateConversation(conversationId, selectedModel?.id)
      showToast(t('chat.regenerated'), 'success')
      await handleLoadConversation(conversationId)
      await refreshAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleCreateEvalCase(event: FormEvent) {
    event.preventDefault()
    if (!newEvalCase.question.trim()) return
    await api.createEvalCase({ ...newEvalCase, project_id: selectedProject?.id })
    setNewEvalCase({ question: '', expected_answer: '', expected_document: '', tags: '' })
    showToast(t('eval.caseCreated'), 'success')
    await refreshAll()
  }

  async function handleRunEval(caseIds?: number[]) {
    setIsRunningEval(true)
    try {
      const result = await api.runEval({ case_ids: caseIds, project_id: selectedProject?.id, model_id: selectedModel?.id, preset_id: selectedPreset?.id })
      showToast(t('eval.runDone', { count: result.count }), 'success')
      setEvalRuns(await api.evalRuns())
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsRunningEval(false)
    }
  }

  async function handleRestoreBackup(file: File | undefined) {
    if (!file) return
    await api.restoreBackup(file)
    showToast(t('admin.restoreDone'), 'success')
    await refreshAll()
  }

  function completeOnboarding() {
    setShowOnboarding(false)
    setOnboardingStep(0)
    setOnboardingTargetRect(null)
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  }

  function goToOnboardingStep(nextStep: number) {
    const boundedStep = Math.max(0, Math.min(nextStep, visibleOnboardingSteps.length - 1))
    setOnboardingStep(boundedStep)
    setActiveView(visibleOnboardingSteps[boundedStep].view)
  }

  function nextOnboardingStep() {
    if (onboardingStep >= visibleOnboardingSteps.length - 1) {
      completeOnboarding()
      return
    }
    goToOnboardingStep(onboardingStep + 1)
  }

  function getTourPopoverStyle(rect: TourRect | null, placement: TourPlacement): CSSProperties {
    if (typeof window === 'undefined') return {}

    const gap = 16
    const margin = 16
    const popoverWidth = Math.min(380, Math.max(300, window.innerWidth - margin * 2))
    const estimatedHeight = 240
    let top = 96
    let left = (window.innerWidth - popoverWidth) / 2

    if (rect) {
      if (placement === 'right') {
        top = rect.top + rect.height / 2 - estimatedHeight / 2
        left = rect.right + gap
        if (left + popoverWidth + margin > window.innerWidth) left = rect.left - popoverWidth - gap
      }
      if (placement === 'left') {
        top = rect.top + rect.height / 2 - estimatedHeight / 2
        left = rect.left - popoverWidth - gap
        if (left < margin) left = rect.right + gap
      }
      if (placement === 'bottom') {
        top = rect.bottom + gap
        left = rect.left + rect.width / 2 - popoverWidth / 2
        if (top + estimatedHeight + margin > window.innerHeight) top = rect.top - estimatedHeight - gap
      }
      if (placement === 'top') {
        top = rect.top - estimatedHeight - gap
        left = rect.left + rect.width / 2 - popoverWidth / 2
        if (top < margin) top = rect.bottom + gap
      }
    }

    const maxLeft = Math.max(margin, window.innerWidth - popoverWidth - margin)
    const maxTop = Math.max(margin, window.innerHeight - estimatedHeight - margin)
    return {
      width: popoverWidth,
      left: Math.min(Math.max(margin, left), maxLeft),
      top: Math.min(Math.max(margin, top), maxTop),
    }
  }

  function getTourHighlightStyle(rect: TourRect | null): CSSProperties | undefined {
    if (!rect || typeof window === 'undefined') return undefined

    const padding = 9
    const margin = 8
    const left = Math.max(margin, rect.left - padding)
    const top = Math.max(margin, rect.top - padding)
    const right = Math.min(window.innerWidth - margin, rect.right + padding)
    const bottom = Math.min(window.innerHeight - margin, rect.bottom + padding)

    return {
      top,
      left,
      width: Math.max(24, right - left),
      height: Math.max(24, bottom - top),
    }
  }

  function getTourMaskStyles(highlightStyle?: CSSProperties): CSSProperties[] {
    if (!highlightStyle || typeof window === 'undefined') return [{ inset: 0 }]

    const top = Number(highlightStyle.top || 0)
    const left = Number(highlightStyle.left || 0)
    const width = Number(highlightStyle.width || 0)
    const height = Number(highlightStyle.height || 0)
    const right = left + width
    const bottom = top + height
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    return [
      { top: 0, left: 0, width: viewportWidth, height: top },
      { top: bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - bottom) },
      { top, left: 0, width: left, height },
      { top, left: right, width: Math.max(0, viewportWidth - right), height },
    ]
  }

  async function saveProjectSettings(event: FormEvent) {
    event.preventDefault()
    if (!selectedProject) return
    await api.patchProjectSettings(selectedProject.id, projectSettingsDraft)
    showToast(t('library.settingsSaved'), 'success')
    await refreshAll()
  }

  async function runRagDebug(query = ragDebugQuery) {
    const content = query.trim()
    if (!content || !selectedProject) return
    setIsDebuggingRag(true)
    try {
      const result = await api.debugRetrieval({
        query: content,
        project_id: selectedProject.id,
        top_k: projectSettingsDraft.retrieval_top_k,
        retrieval_mode: projectSettingsDraft.retrieval_mode,
        retrieval_scope: projectSettingsDraft.retrieval_scope,
        similarity_threshold: projectSettingsDraft.similarity_threshold,
        use_query_rewrite: projectSettingsDraft.query_rewrite_enabled,
        use_rerank: projectSettingsDraft.rerank_enabled,
        metadata_filter: safeJsonObject(projectSettingsDraft.metadata_filter_json),
      })
      setRagDebugResult(result)
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsDebuggingRag(false)
    }
  }

  async function handleGlobalSearch(event?: FormEvent) {
    event?.preventDefault()
    const content = globalSearchQuery.trim()
    if (!content) return
    setIsGlobalSearching(true)
    try {
      const result = await api.searchKnowledge({
        query: content,
        project_id: searchAllProjects ? undefined : selectedProject?.id,
        top_k: 8,
        retrieval_mode: projectSettingsDraft.retrieval_mode,
        retrieval_scope: 'focused',
        similarity_threshold: projectSettingsDraft.similarity_threshold,
      })
      setGlobalSearchResult(result)
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsGlobalSearching(false)
    }
  }

  async function handleCreateSyncSource(event: FormEvent) {
    event.preventDefault()
    if (!selectedProject) {
      showToast(language === 'zh' ? '先选择一个项目，再添加监听文件夹。' : 'Choose a project first.', 'warning')
      return
    }
    if (!syncSourceDraft.name.trim() || !syncSourceDraft.source_path.trim()) {
      showToast(language === 'zh' ? '请填写同步名称和文件夹路径。' : 'Please enter a name and folder path.', 'warning')
      return
    }
    await api.createSyncSource({
      project_id: selectedProject.id,
      name: syncSourceDraft.name.trim(),
      source_path: syncSourceDraft.source_path.trim(),
      poll_interval_seconds: syncSourceDraft.poll_interval_seconds,
      include_globs: syncSourceDraft.include_globs.trim(),
      exclude_globs: syncSourceDraft.exclude_globs.trim(),
      delete_missing: syncSourceDraft.delete_missing,
      enabled: true,
    })
    setSyncSourceDraft({
      name: '',
      source_path: '',
      poll_interval_seconds: 60,
      include_globs: '',
      exclude_globs: '',
      delete_missing: false,
    })
    showToast(language === 'zh' ? '监听文件夹已添加。' : 'Watched folder added.', 'success')
    await refreshAll()
  }

  async function handleScanSyncSource(sourceId: number) {
    setScanningSyncSourceId(sourceId)
    try {
      await api.scanSyncSource(sourceId)
      showToast(language === 'zh' ? '同步扫描已完成。' : 'Folder sync finished.', 'success')
      await refreshAll()
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setScanningSyncSourceId(null)
    }
  }

  async function openDocument(id: number, chunkId?: number) {
    const detail = await api.document(id)
    setSelectedDocument(detail)
    setSelectedChunkId(chunkId ?? null)
    setActiveView('knowledge')
  }

  async function openCitationPreview(citation: Citation) {
    const detail = await api.document(citation.document_id)
    setCitationPreview({ document: detail, citation })
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault()
    const content = question.trim()
    if (!content || isSending) return
    const assistantTempId = -Date.now()
    const requestId = chatRequestIdRef.current + 1
    chatRequestIdRef.current = requestId
    setQuestion('')
    setChatTimeline([
      {
        id: `${Date.now()}-submitting`,
        stage: 'submitting',
        label: chatTimelineLabel('submitting'),
        at: Date.now(),
      },
    ])
    dispatchChatMachine({ type: 'SUBMIT', requestId, assistantMessageId: assistantTempId })
    setMessages((current) => [...current, { role: 'user', content }, { id: assistantTempId, role: 'assistant', content: '' }])
    try {
      let streamError = ''
      await api.chatStream(
        {
          message: content,
          project_id: searchAllProjects ? undefined : selectedProject?.id,
          model_id: selectedModel?.id,
          preset_id: selectedPreset?.id,
          conversation_id: conversationId,
          retrieval_mode: projectSettingsDraft.retrieval_mode,
          retrieval_scope: projectSettingsDraft.retrieval_scope,
          similarity_threshold: projectSettingsDraft.similarity_threshold,
          use_query_rewrite: projectSettingsDraft.query_rewrite_enabled,
          use_rerank: projectSettingsDraft.rerank_enabled,
          metadata_filter: safeJsonObject(projectSettingsDraft.metadata_filter_json),
        },
        {
          onStatus: (status) => {
            dispatchChatMachine({ type: 'BACKEND_STATUS', requestId, status })
            pushChatTimeline(status, chatTimelineLabel(status))
          },
          onMeta: (meta) => {
            setConversationId(meta.conversation_id)
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantTempId
                  ? {
                      ...message,
                      citations: meta.citations as Citation[],
                      model_id: meta.model.id,
                      model_name: meta.model.name,
                      model_model: meta.model.model,
                      model_provider: meta.model.provider,
                      model_preset_id: meta.preset?.id,
                      debug: meta.debug as ChatDebug,
                      usage: meta.usage,
                    }
                  : message,
              ),
            )
          },
          onReasoning: () => {
            dispatchChatMachine({ type: 'REASONING', requestId })
            pushChatTimeline('reasoning', chatTimelineLabel('reasoning'))
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantTempId ? { ...message, reasoning_count: (message.reasoning_count || 0) + 1 } : message,
              ),
            )
          },
          onChunk: (text) => {
            dispatchChatMachine({ type: 'CHUNK', requestId })
            pushChatTimeline('streaming', chatTimelineLabel('streaming'))
            setMessages((current) =>
              current.map((message) => (message.id === assistantTempId ? { ...message, content: `${message.content}${text}` } : message)),
            )
          },
          onDone: (response) => {
            dispatchChatMachine({ type: 'FINALIZE', requestId })
            pushChatTimeline('finalizing', chatTimelineLabel('finalizing'))
            setConversationId(response.conversation_id)
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantTempId
                  ? {
                      ...message,
                      id: response.assistant_message_id || message.id,
                      content: response.answer,
                      citations: response.citations as Citation[],
                      model_id: response.model.id,
                      model_name: response.model.name,
                      model_model: response.model.model,
                      model_provider: response.model.provider,
                      model_preset_id: response.preset?.id,
                      debug: response.debug as ChatDebug,
                      usage: response.usage,
                    }
                  : message,
              ),
            )
          },
          onError: (message) => {
            streamError = message
            dispatchChatMachine({ type: 'FAIL', requestId, error: message })
          },
        },
      )
      if (streamError) throw new Error(streamError)
      try {
        await refreshAll()
      } catch (error) {
        showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'warning')
      }
      dispatchChatMachine({ type: 'COMPLETE', requestId })
      pushChatTimeline('completed', chatTimelineLabel('completed'))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('chat.requestFailed')
      dispatchChatMachine({ type: 'FAIL', requestId, error: errorMessage })
      pushChatTimeline('failed', chatTimelineLabel('failed'), errorMessage)
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantTempId
            ? {
                ...message,
                content: `${t('chat.requestFailed')}: ${errorMessage}`,
              }
            : message,
        ),
      )
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void handleSend()
  }

  function handleSelectChatModel(modelId: number) {
    setSelectedModelId(modelId)
    const model = chatModelOptions.find((item) => item.id === modelId)
    if (model) showToast(t('chat.modelSwitched', { name: modelOptionLabel(model) }), 'success')
  }

  async function handleLoadConversation(id: number) {
    const detail = await api.conversation(id)
    setConversationId(id)
    setMessages(detail.messages)
    setChatTimeline([])
    dispatchChatMachine({ type: 'RESET' })
    if (detail.project_id) setSelectedProjectId(detail.project_id)
    if ('model_preset_id' in detail && detail.model_preset_id) setSelectedPresetId(detail.model_preset_id as number)
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
      model_type: 'chat',
      context_window: 0,
      supports_tools: false,
      supports_vision: false,
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
      showToast(t('models.discoveredCount', { count: found.length }), 'success')
    } catch {
      const fallback = seedPlatformModels(activePlatform)
      if (fallback.length) {
        setDiscoveredModels(fallback)
        setModelForm((current) => ({ ...current, default_model: fallback[0]?.id ?? '' }))
      }
      showToast(t('models.apiKeyRequired'), 'warning')
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
        model_type: modelForm.model_type,
        context_window: modelForm.context_window,
        supports_tools: modelForm.supports_tools,
        supports_vision: modelForm.supports_vision,
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

    showToast(t('models.savedBatch', { count: selectedDiscoveryIds.length }), 'success')
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
        model_type: model.model_type,
        context_window: model.context_window || 0,
        supports_tools: model.supports_tools,
        supports_vision: model.supports_vision,
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
      showToast(t('models.discoveredCount', { count: response.models.length }), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
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
      model_type: draft.model_type,
      context_window: draft.context_window,
      supports_tools: draft.supports_tools,
      supports_vision: draft.supports_vision,
    }
    if (draft.api_key.trim()) payload.api_key = draft.api_key.trim()
    await api.patchModel(model.id, payload)
    setEditingModelId(null)
    showToast(t('models.updated'), 'success')
    await refreshAll()
  }

  async function deleteModel(id: number) {
    await api.deleteModel(id)
    showToast(t('models.deleted'), 'success')
    await refreshAll()
  }

  async function testModel(id: number) {
    setTestingModelId(id)
    try {
      const result = await api.testModel(id)
      showToast(result.ok ? t('models.connectionOk', { latency: result.latency_ms }) : t('models.connectionFailed', { error: result.error }), result.ok ? 'success' : 'danger')
      await refreshAll()
    } finally {
      setTestingModelId(null)
    }
  }

  async function handleSavePreset(event: FormEvent) {
    event.preventDefault()
    if (!presetDraft.name.trim()) return
    await api.createModelPreset({
      ...presetDraft,
      name: presetDraft.name.trim(),
      description: presetDraft.description.trim(),
      project_id: presetDraft.project_id ?? selectedProject?.id,
      model_id: presetDraft.model_id ?? selectedModel?.id,
    })
    setPresetDraft({
      name: '',
      description: '',
      project_id: selectedProject?.id,
      model_id: selectedModel?.id,
      system_prompt: '',
      temperature: 0.2,
      retrieval_scope: 'focused',
      retrieval_mode: 'hybrid',
      top_k: 5,
      similarity_threshold: 0,
      use_query_rewrite: false,
      use_rerank: false,
      metadata_filter_json: '{}',
      tools_json: '[]',
      is_default: false,
    })
    showToast('Preset saved.', 'success')
    await refreshAll()
  }

  async function handleApplyPreset(preset: ModelPreset) {
    setSelectedPresetId(preset.id)
    if (preset.project_id) setSelectedProjectId(preset.project_id)
    if (preset.model_id) setSelectedModelId(preset.model_id)
    showToast(`${preset.name}`, 'success')
  }

  async function deletePreset(id: number) {
    await api.deleteModelPreset(id)
    if (selectedPresetId === id) setSelectedPresetId(undefined)
    showToast('Preset deleted.', 'success')
    await refreshAll()
  }

  function syncSelectedServerProfile(patch?: Partial<ServerProfile>) {
    setServerProfiles((current) =>
      current.map((profile) =>
        profile.id === selectedServerProfileId
          ? {
              ...profile,
              base_url: apiBaseInput.trim(),
              token: apiTokenInput.trim(),
              ...patch,
            }
          : profile,
      ),
    )
  }

  function handleSelectServerProfile(profileId: string) {
    const profile = serverProfiles.find((item) => item.id === profileId)
    if (!profile) return
    setSelectedServerProfileId(profileId)
    setApiBaseInput(profile.base_url)
    setApiTokenInput(profile.token)
  }

  async function handleSaveServer(event: FormEvent) {
    event.preventDefault()
    setApiBase(apiBaseInput)
    setApiToken(apiTokenInput)
    syncSelectedServerProfile()
    showToast(apiBaseInput.trim() ? t('server.savedRemote') : t('server.savedLocal'), 'success')
    const session = await loadAuthState()
    if (!session.setup_required && (!session.auth_required || session.role !== 'anonymous')) {
      await refreshAll()
    }
  }

  async function handleTestServer() {
    const base = normalizeApiBase(apiBaseInput)
    const checkedAt = new Date().toISOString()
    try {
      const headers: Record<string, string> = {}
      if (apiTokenInput.trim()) headers['x-kortex-token'] = apiTokenInput.trim()
      const response = await fetch(`${base}/api/health`, { headers })
      if (!response.ok) throw new Error(response.statusText)
      syncSelectedServerProfile({ last_checked_at: checkedAt, last_status: 'online', last_error: undefined })
      showToast(t('server.testOk'), 'success')
    } catch (error) {
      syncSelectedServerProfile({
        last_checked_at: checkedAt,
        last_status: 'offline',
        last_error: error instanceof Error ? error.message : 'health check failed',
      })
      showToast(error instanceof Error ? `${t('server.testFailed')}: ${error.message}` : `${t('server.testFailed')}.`, 'danger')
    }
  }

  async function handleBootstrap(event: FormEvent) {
    event.preventDefault()
    setIsSubmittingAuth(true)
    try {
      const result = await api.authBootstrap({
        email: setupForm.email,
        display_name: setupForm.display_name,
        password: setupForm.password,
        device_name: setupForm.device_name,
      })
      setApiToken(result.token)
      setApiTokenInput(result.token)
      syncSelectedServerProfile({ token: result.token })
      applyAuthPayload(result.auth)
      const sessions = await api.authSessions().catch(() => [])
      setDeviceSessions(sessions)
      await refreshAll()
      showToast(language === 'zh' ? '管理员账号已创建。' : 'Admin account created.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setIsSubmittingAuth(true)
    try {
      const result = await api.authLogin({
        email: loginForm.email,
        password: loginForm.password,
        device_name: loginForm.device_name,
      })
      setApiToken(result.token)
      setApiTokenInput(result.token)
      syncSelectedServerProfile({ token: result.token })
      applyAuthPayload(result.auth)
      const sessions = await api.authSessions().catch(() => [])
      setDeviceSessions(sessions)
      await refreshAll()
      showToast(language === 'zh' ? '登录成功。' : 'Signed in.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  async function handleLogout() {
    try {
      await api.authLogout().catch(() => ({ ok: true }))
    } finally {
      setApiToken('')
      setApiTokenInput('')
      syncSelectedServerProfile({ token: '' })
      setAuthSession(null)
      setDeviceSessions([])
      const session = await loadAuthState().catch(() => null)
      if (session && !session.setup_required && (!session.auth_required || session.role !== 'anonymous')) {
        await refreshAll().catch(() => undefined)
      }
    }
  }

  async function handleRevokeDeviceSession(sessionId: number) {
    try {
      await api.revokeAuthSession(sessionId)
      const sessions = await api.authSessions()
      setDeviceSessions(sessions)
      showToast(language === 'zh' ? '设备会话已移除。' : 'Device session revoked.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleAcceptInvite(event: FormEvent) {
    event.preventDefault()
    setIsSubmittingAuth(true)
    try {
      const result = await api.acceptTeamInvite({
        invite_token: acceptInviteForm.invite_token,
        display_name: acceptInviteForm.display_name,
        password: acceptInviteForm.password,
        device_name: acceptInviteForm.device_name,
      })
      setApiToken(result.token)
      setApiTokenInput(result.token)
      syncSelectedServerProfile({ token: result.token })
      applyAuthPayload(result.auth)
      const sessions = await api.authSessions().catch(() => [])
      setDeviceSessions(sessions)
      await refreshAll()
      showToast(language === 'zh' ? '邀请已接受，已进入共享工作区。' : 'Invitation accepted.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  async function refreshTeamData() {
    if (!canManageWorkspace) return
    const [members, invitations] = await Promise.all([api.teamMembers(), api.teamInvitations()])
    setTeamMembers(members)
    setTeamInvitations(invitations)
  }

  async function refreshProjectMembers(projectId = selectedProject?.id) {
    if (!projectId) return
    const members = await api.projectMembers(projectId)
    setProjectMembers(members)
  }

  async function handleCreateTeamInvitation(event: FormEvent) {
    event.preventDefault()
    try {
      await api.createTeamInvitation(teamInviteDraft)
      setTeamInviteDraft({ email: '', workspace_role: 'member', project_role: 'viewer', project_ids: selectedProject?.id ? [selectedProject.id] : [], message: '', expires_in_days: 7 })
      await refreshTeamData()
      showToast(language === 'zh' ? '邀请已创建，可以把邀请码发给成员。' : 'Invitation created.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handlePatchTeamMember(userId: number, workspace_role: 'owner' | 'admin' | 'member' | 'viewer') {
    try {
      await api.patchTeamMember(userId, { workspace_role })
      await refreshTeamData()
      showToast(language === 'zh' ? '成员角色已更新。' : 'Member role updated.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleRevokeInvitation(inviteId: number) {
    try {
      await api.revokeTeamInvitation(inviteId)
      await refreshTeamData()
      showToast(language === 'zh' ? '邀请已撤销。' : 'Invitation revoked.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleAddProjectMember(event: FormEvent) {
    event.preventDefault()
    if (!selectedProject?.id || !projectShareDraft.user_id) {
      showToast(language === 'zh' ? '先选择要加入项目的成员。' : 'Select a member first.', 'warning')
      return
    }
    try {
      await api.addProjectMember(selectedProject.id, { user_id: projectShareDraft.user_id, role: projectShareDraft.role })
      setProjectShareDraft({ user_id: undefined, role: 'viewer' })
      await refreshProjectMembers(selectedProject.id)
      showToast(language === 'zh' ? '项目共享已更新。' : 'Project access updated.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handlePatchProjectMember(userId: number, role: 'owner' | 'editor' | 'viewer') {
    if (!selectedProject?.id) return
    try {
      await api.patchProjectMember(selectedProject.id, userId, { role })
      await refreshProjectMembers(selectedProject.id)
      await refreshAll()
      showToast(language === 'zh' ? '项目角色已更新。' : 'Project role updated.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  async function handleRemoveProjectMember(userId: number) {
    if (!selectedProject?.id) return
    try {
      await api.removeProjectMember(selectedProject.id, userId)
      await refreshProjectMembers(selectedProject.id)
      showToast(language === 'zh' ? '已移出项目。' : 'Removed from project.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('chat.requestFailed'), 'danger')
    }
  }

  const activeApiBase = getApiBase()
  const connectionLabel = connectionState === 'online' ? t('status.online') : connectionState === 'checking' ? t('status.checking') : t('status.offline')
  const activeViewLabel = activeView === 'settings' ? t('nav.settings') : t(navItems.find((item) => item.id === activeView)?.labelKey || 'nav.ask')

  if (authGateMode !== 'ready') {
    return renderAuthGate()
  }

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
          {visibleNavItems.map((item) => {
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

      <main className={`workspace workspace-${activeView}`}>
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <div className="topbar-breadcrumb-line">
              <span>{t('topbar.workspace')}</span>
              <i>/</i>
              <strong>{activeViewLabel}</strong>
            </div>
          </div>
          <div className="topbar-controls">
            <label className="topbar-workspace-picker" data-tour="workspace-selector">
              <span>{t('topbar.workspace')}</span>
              <select value={selectedProject?.id ?? ''} onChange={(event) => setSelectedProjectId(Number(event.target.value))}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {displayProjectName(project.name)}
                  </option>
                ))}
              </select>
            </label>
            {selectedProject ? (
              <div className="topbar-status-pill neutral">
                <Shield size={14} />
                <span>{projectRoleLabel(selectedProject.access_role)}</span>
              </div>
            ) : null}
            <div className="topbar-status-pill">
              <Bot size={15} />
              <span>{connectionLabel}</span>
            </div>
            <button className="icon-button" title={t('common.refresh')} onClick={() => refreshAll()}>
              <RefreshCcw size={17} />
            </button>
          </div>
        </header>

        {toast && (
          <div className={`toast toast-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}>{t('common.dismiss')}</button>
          </div>
        )}

        {citationPreview && renderCitationPreview()}

        {showOnboarding && renderOnboarding()}

        {activeView === 'chat' && renderChat()}
        {activeView === 'knowledge' && renderKnowledge()}
        {activeView === 'models' && renderModels()}
        {activeView === 'diagnostics' && isProfessionalMode && renderDiagnostics()}
        {activeView === 'server' && renderServer()}
        {activeView === 'admin' && isProfessionalMode && renderAdmin()}
        {activeView === 'settings' && renderSettings()}
      </main>
    </div>
  )

  function renderAuthGate() {
    const isLoading = authGateMode === 'loading'
    const isSetup = authGateMode === 'setup'
    const isTokenMode = authSession?.auth_mode === 'env_token'

    return (
      <div className="auth-shell">
        {toast && (
          <div className={`toast toast-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}>{t('common.dismiss')}</button>
          </div>
        )}

        <div className="auth-card">
          <div className="auth-card-brand">
            <div className="brand-mark" aria-hidden="true">
              <Sparkles size={22} />
            </div>
            <div>
              <strong>{PRODUCT_NAME}</strong>
              <span>{language === 'zh' ? '个人项目大脑' : 'Project memory OS'}</span>
            </div>
          </div>

          <div className="auth-card-copy">
            <h1>
              {isLoading
                ? language === 'zh'
                  ? '正在连接工作区'
                  : 'Connecting to workspace'
                : isSetup
                  ? language === 'zh'
                    ? '创建你的管理员账号'
                    : 'Create your admin account'
                  : language === 'zh'
                    ? '登录到同一套项目记忆'
                    : 'Sign in to your shared project memory'}
            </h1>
            <p>
              {isLoading
                ? language === 'zh'
                  ? '正在检查当前后端的认证状态。'
                  : 'Checking the backend authentication state.'
                : isSetup
                  ? language === 'zh'
                    ? '首次启动后，先创建一个管理员账号。后面你在别的设备上登录后，也会看到同一套知识库和会话。'
                    : 'Create the first admin account, then every device can sign in to the same knowledge base and chats.'
                  : isTokenMode
                    ? language === 'zh'
                      ? '当前后端启用了环境变量令牌鉴权。请在“服务器连接”里填入令牌后再继续。'
                      : 'This backend uses environment token auth. Enter the token in server settings to continue.'
                    : language === 'zh'
                      ? '登录后你可以在设置里管理当前设备和其它已登录设备。'
                      : 'After signing in, manage this device and your other signed-in devices from Settings.'}
            </p>
          </div>

          {isLoading ? (
            <div className="auth-loading">
              <Loader2 size={18} className="spin" />
              <span>{language === 'zh' ? '连接中...' : 'Loading...'}</span>
            </div>
          ) : isSetup ? (
            <form className="auth-form" onSubmit={handleBootstrap}>
              <label>
                <span>{language === 'zh' ? '显示名称' : 'Display name'}</span>
                <input value={setupForm.display_name} onChange={(event) => setSetupForm((current) => ({ ...current, display_name: event.target.value }))} placeholder={language === 'zh' ? '例如：我的项目库' : 'For example: Personal project brain'} />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={setupForm.email} onChange={(event) => setSetupForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" />
              </label>
              <label>
                <span>{language === 'zh' ? '密码' : 'Password'}</span>
                <input type="password" value={setupForm.password} onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))} placeholder={language === 'zh' ? '至少 8 位' : 'At least 8 characters'} />
              </label>
              <label>
                <span>{language === 'zh' ? '设备名称' : 'Device name'}</span>
                <input value={setupForm.device_name} onChange={(event) => setSetupForm((current) => ({ ...current, device_name: event.target.value }))} placeholder={language === 'zh' ? '例如：办公室电脑' : 'For example: Office desktop'} />
              </label>
              <button className="primary-button full-width" type="submit" disabled={isSubmittingAuth}>
                {isSubmittingAuth ? <Loader2 size={16} className="spin" /> : <Shield size={16} />}
                {language === 'zh' ? '创建并进入' : 'Create account'}
              </button>
            </form>
          ) : (
            <div className="auth-form-block">
              <form className="auth-form" onSubmit={handleLogin}>
                {!isTokenMode && (
                  <>
                    <label>
                      <span>Email</span>
                      <input type="email" value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@example.com" />
                    </label>
                    <label>
                      <span>{language === 'zh' ? '密码' : 'Password'}</span>
                      <input type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder={language === 'zh' ? '输入你的密码' : 'Enter your password'} />
                    </label>
                    <label>
                      <span>{language === 'zh' ? '设备名称' : 'Device name'}</span>
                      <input value={loginForm.device_name} onChange={(event) => setLoginForm((current) => ({ ...current, device_name: event.target.value }))} placeholder={language === 'zh' ? '例如：MacBook / 办公室电脑' : 'For example: MacBook / Office desktop'} />
                    </label>
                    <button className="primary-button full-width" type="submit" disabled={isSubmittingAuth}>
                      {isSubmittingAuth ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
                      {language === 'zh' ? '登录' : 'Sign in'}
                    </button>
                  </>
                )}
              </form>

              {!isTokenMode && (
                <form className="auth-form auth-invite-form" onSubmit={handleAcceptInvite}>
                  <div className="auth-inline-heading">
                    <strong>{language === 'zh' ? '接受团队邀请' : 'Accept invite'}</strong>
                    <span>{language === 'zh' ? '新成员可用邀请码直接创建账号并加入共享项目。' : 'New teammates can use an invite token to create an account and join shared projects.'}</span>
                  </div>
                  <label>
                    <span>{language === 'zh' ? '邀请码' : 'Invite token'}</span>
                    <input value={acceptInviteForm.invite_token} onChange={(event) => setAcceptInviteForm((current) => ({ ...current, invite_token: event.target.value }))} placeholder={language === 'zh' ? '粘贴管理员发来的邀请码' : 'Paste the invite token'} />
                  </label>
                  {(isLoadingInvitePreview || invitePreview) && (
                    <div className="invite-preview-card">
                      <div className="invite-preview-header">
                        <strong>{language === 'zh' ? '邀请预览' : 'Invite preview'}</strong>
                        <span>{isLoadingInvitePreview ? (language === 'zh' ? '读取中...' : 'Loading...') : invitePreview?.email}</span>
                      </div>
                      {invitePreview ? (
                        <>
                          <div className="invite-preview-summary">
                            <span className="meta-chip">{workspaceRoleLabel(invitePreview.workspace_role)}</span>
                            <span className="meta-chip">{projectRoleLabel(invitePreview.project_role)}</span>
                            {invitePreview.expires_at ? (
                              <span className="meta-chip subtle">
                                {language === 'zh' ? `有效期至 ${formatDate(invitePreview.expires_at)}` : `Expires ${formatDate(invitePreview.expires_at)}`}
                              </span>
                            ) : null}
                          </div>
                          {!!invitePreview.project_names.length && (
                            <div className="invite-preview-projects">
                              {invitePreview.project_names.map((name) => (
                                <span className="meta-chip" key={`invite-preview-${name}`}>{displayProjectName(name)}</span>
                              ))}
                            </div>
                          )}
                          {invitePreview.message ? <p>{invitePreview.message}</p> : null}
                        </>
                      ) : null}
                    </div>
                  )}
                  <label>
                    <span>{language === 'zh' ? '显示名称' : 'Display name'}</span>
                    <input value={acceptInviteForm.display_name} onChange={(event) => setAcceptInviteForm((current) => ({ ...current, display_name: event.target.value }))} placeholder={language === 'zh' ? '例如：设计 / 前端 / 运维' : 'For example: Design / Frontend / Ops'} />
                  </label>
                  <div className="form-grid two-columns">
                    <label>
                      <span>{language === 'zh' ? '密码' : 'Password'}</span>
                      <input type="password" value={acceptInviteForm.password} onChange={(event) => setAcceptInviteForm((current) => ({ ...current, password: event.target.value }))} placeholder={language === 'zh' ? '设置登录密码' : 'Create a password'} />
                    </label>
                    <label>
                      <span>{language === 'zh' ? '设备名称' : 'Device name'}</span>
                      <input value={acceptInviteForm.device_name} onChange={(event) => setAcceptInviteForm((current) => ({ ...current, device_name: event.target.value }))} placeholder={language === 'zh' ? '例如：同事笔记本' : 'For example: Team laptop'} />
                    </label>
                  </div>
                  <button className="secondary-button full-width" type="submit" disabled={isSubmittingAuth || !acceptInviteForm.invite_token.trim()}>
                    <Check size={16} />
                    {language === 'zh' ? '接受邀请并加入' : 'Accept and join'}
                  </button>
                </form>
              )}

              <div className="auth-gate-server">
                <div>
                  <strong>{language === 'zh' ? '当前后端' : 'Current backend'}</strong>
                  <span>{activeApiBase || (language === 'zh' ? '内置本地后端' : 'Bundled local backend')}</span>
                </div>
                <div className="button-row">
                  <button className="secondary-button" type="button" onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>
                    <Languages size={16} />
                    {language === 'zh' ? 'English' : '中文'}
                  </button>
                </div>
              </div>

              <form className="auth-server-form" onSubmit={handleSaveServer}>
                <label>
                  <span>{language === 'zh' ? '后端地址' : 'Backend URL'}</span>
                  <input value={apiBaseInput} onChange={(event) => setApiBaseInput(event.target.value)} placeholder="http://127.0.0.1:8010" />
                </label>
                <label>
                  <span>{language === 'zh' ? '访问令牌（可选）' : 'Access token (optional)'}</span>
                  <input type="password" value={apiTokenInput} onChange={(event) => setApiTokenInput(event.target.value)} placeholder={language === 'zh' ? '后端启用了令牌时再填写' : 'Needed only when the backend requires a token'} />
                </label>
                <div className="button-row">
                  <button className="secondary-button" type="submit">
                    <Check size={16} />
                    {language === 'zh' ? '保存连接' : 'Save connection'}
                  </button>
                  <button className="secondary-button" type="button" onClick={handleTestServer}>
                    <Wifi size={16} />
                    {language === 'zh' ? '测试连接' : 'Test connection'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderOnboarding() {
    const step = visibleOnboardingSteps[Math.min(onboardingStep, visibleOnboardingSteps.length - 1)]
    const targetStyle = getTourHighlightStyle(onboardingTargetRect)
    const maskStyles = getTourMaskStyles(targetStyle)
    const isLastStep = onboardingStep >= visibleOnboardingSteps.length - 1

    return (
      <div className="tour-layer" aria-live="polite">
        <div className="tour-masks" aria-hidden="true">
          {maskStyles.map((style, index) => (
            <div className="tour-mask" style={style} key={index} />
          ))}
        </div>
        {targetStyle && <div className="tour-highlight" style={targetStyle} />}
        <div className={`tour-popover tour-${step.placement}`} style={getTourPopoverStyle(onboardingTargetRect, step.placement)} role="dialog" aria-modal="false" aria-label={t(step.titleKey)}>
          <div className="tour-progress">
            <span>{t('onboarding.progress', { current: onboardingStep + 1, total: visibleOnboardingSteps.length })}</span>
            <button className="icon-button" type="button" title={t('onboarding.skip')} onClick={completeOnboarding}>
              <X size={16} />
            </button>
          </div>
          <h3>{t(step.titleKey)}</h3>
          <p>{t(step.bodyKey)}</p>
          <div className="tour-step-dots" aria-hidden="true">
            {visibleOnboardingSteps.map((item, index) => (
              <span key={item.id} className={index === onboardingStep ? 'active' : index < onboardingStep ? 'done' : ''} />
            ))}
          </div>
          <div className="tour-actions">
            <button className="secondary-button" type="button" onClick={completeOnboarding}>
              <X size={15} />
              {t('onboarding.skip')}
            </button>
            <div>
              <button className="secondary-button" type="button" onClick={() => goToOnboardingStep(onboardingStep - 1)} disabled={onboardingStep === 0}>
                <ArrowLeft size={15} />
                {t('onboarding.previous')}
              </button>
              <button className="primary-button" type="button" onClick={nextOnboardingStep}>
                {isLastStep ? <Check size={15} /> : <ArrowRight size={15} />}
                {isLastStep ? t('onboarding.finish') : t('onboarding.next')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderCitationPreview() {
    if (!citationPreview) return null
    const { document, citation } = citationPreview
    const focusIndex = document.chunks.findIndex((chunk) => chunk.id === citation.chunk_id)
    const contextChunks: DocumentChunk[] =
      focusIndex >= 0
        ? document.chunks.slice(Math.max(0, focusIndex - 1), Math.min(document.chunks.length, focusIndex + 2))
        : document.chunks.slice(0, Math.min(document.chunks.length, 2))

    return (
      <div className="citation-preview-overlay" role="dialog" aria-modal="true" aria-label={t('evidence.previewTitle')} onClick={() => setCitationPreview(null)}>
        <div className="citation-preview-modal" onClick={(event) => event.stopPropagation()}>
          <div className="citation-preview-header">
            <div className="citation-preview-header-copy">
              <div className="page-kicker">{t('evidence.previewTitle')}</div>
              <h3>{document.title || document.filename}</h3>
              <div className="citation-preview-subline">
                <span>{document.filename}</span>
                <span>{t('evidence.previewBody')}</span>
              </div>
            </div>
            <button className="icon-button" type="button" title={t('evidence.closePreview')} onClick={() => setCitationPreview(null)}>
              <X size={17} />
            </button>
          </div>

          <div className="citation-preview-meta">
            <span className="meta-chip good">{Math.round((citation.score || 0) * 100)}%</span>
            <span className="meta-chip subtle">{citationWhy(citation)}</span>
            {citation.section_path ? <span className="meta-chip subtle">{citation.section_path}</span> : null}
          </div>

          <div className="citation-preview-primary-hit">
            <strong>{t('evidence.primaryHit')}</strong>
            <p>{citation.snippet}</p>
          </div>

          <div className="citation-preview-context">
            {contextChunks.map((chunk) => (
              <div className={`citation-preview-chunk ${chunk.id === citation.chunk_id ? 'active' : ''}`} key={`preview-${chunk.id}`}>
                <small>
                  #{chunk.chunk_index + 1} / {chunk.char_count} chars{chunk.section_path ? ` / ${chunk.section_path}` : ''}
                </small>
                <p>{chunk.content}</p>
              </div>
            ))}
          </div>

          <div className="citation-preview-actions">
            <button className="secondary-button" type="button" onClick={() => setCitationPreview(null)}>
              {t('evidence.closePreview')}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={async () => {
                setCitationPreview(null)
                await openDocument(citation.document_id, citation.chunk_id)
              }}
            >
              <FileText size={16} />
              {t('evidence.fullDocument')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderChat() {
    const promptCards = [
      {
        key: 'retrospective',
        title: language === 'zh' ? '生成项目复盘' : 'Project retrospective',
        prompt:
          language === 'zh'
            ? '请基于当前知识库生成这个项目的完整复盘，包含项目目标、核心模块、关键决策、结果、遗留问题和下一步建议。'
            : 'Generate a full retrospective for this project, including goals, modules, decisions, outcomes, open issues, and next steps.',
      },
      {
        key: 'reuse',
        title: language === 'zh' ? '提取可复用经验' : 'Reusable lessons',
        prompt:
          language === 'zh'
            ? '请提取这个项目里可复用的经验，按技术方案、流程方法、组件资产和协作经验分别整理。'
            : 'Extract reusable lessons from this project across implementation, process, reusable assets, and collaboration.',
      },
      {
        key: 'resume',
        title: language === 'zh' ? '输出面试/简历表述' : 'Resume phrasing',
        prompt:
          language === 'zh'
            ? '请把这个项目整理成适合面试和简历的项目表述，包含一句话概述、个人职责、技术亮点和结果。'
            : 'Turn this project into interview- and resume-ready phrasing with a summary, responsibilities, technical highlights, and outcomes.',
      },
      {
        key: 'deploy',
        title: language === 'zh' ? '汇总部署步骤' : 'Deployment steps',
        prompt:
          language === 'zh'
            ? '请汇总这个项目的部署、启动、环境变量、依赖安装和常见排障步骤，尽量按先后顺序整理。'
            : 'Summarize deployment, startup, env vars, dependency installation, and common troubleshooting steps in order.',
      },
      {
        key: 'risks',
        title: language === 'zh' ? '提炼风险与踩坑' : 'Risks and pitfalls',
        prompt:
          language === 'zh'
            ? '请提炼这个项目里最关键的风险、踩坑点和规避建议，并说明这些问题通常出现在哪个阶段。'
            : 'Extract the main risks, pitfalls, and mitigation advice, and note when each tends to appear.',
      },
      {
        key: 'delivery',
        title: language === 'zh' ? '输出交付清单' : 'Delivery checklist',
        prompt:
          language === 'zh'
            ? '请整理这个项目的交付清单，包含代码、文档、部署项、配置项、账号权限和验收注意事项。'
            : 'Create a delivery checklist covering code, docs, deployment items, config, credentials, and acceptance notes.',
      },
    ]
    const currentModelLabel = selectedModel ? modelOptionLabel(selectedModel) : t('chat.noModel')
    const effectivePresetLabel = selectedPreset?.name || (language === 'zh' ? '未使用预设' : 'No preset')
    const presetModeLabel = selectedPresetId ? (language === 'zh' ? '已固定' : 'Pinned') : language === 'zh' ? '跟随默认' : 'Follow default'
    const selectedProjectLabel = searchAllProjects ? t('project.all') : displayProjectName(selectedProject?.name, 'project.all')
    const presetSummaryChips = selectedPreset
      ? [
          t(
            selectedPreset.retrieval_mode === 'vector'
              ? 'library.mode.vector'
              : selectedPreset.retrieval_mode === 'keyword'
                ? 'library.mode.keyword'
                : 'library.mode.hybrid',
          ),
          t(selectedPreset.retrieval_scope === 'focused' ? 'library.scope.focused' : 'library.scope.full'),
          `Top ${selectedPreset.top_k}`,
        ]
      : []

    function chatStageLabel(stage: ChatMachineStage) {
      switch (stage) {
        case 'submitting':
          return t('chat.status.submitting')
        case 'retrieving':
          return t('chat.status.retrieving')
        case 'thinking':
        case 'reasoning':
          return t('chat.status.thinking')
        case 'streaming':
          return t('chat.status.streaming')
        case 'finalizing':
          return t('chat.status.finalizing')
        case 'failed':
          return t('chat.status.failed')
        default:
          return t('chat.loading')
      }
    }

    const statusLabel = chatStageLabel(chatMachine.stage)
    const composerHint =
      isSending
        ? statusLabel
        : language === 'zh'
          ? 'Enter 发送，Shift + Enter 换行'
          : 'Press Enter to send, Shift + Enter for a new line'
    const showInspector = messages.length > 0 && latestCitations.length > 0
    const latestCitationDocuments = new Set(latestCitations.map((citation) => citation.document_id)).size
    const latestCitationTypes = summarizeCitationTypes(latestCitations)
    const bestCitation = latestCitations.reduce<Citation | null>((best, citation) => {
      if (!best) return citation
      return (citation.score || 0) > (best.score || 0) ? citation : best
    }, null)

    function groundingMode(message: ChatMessage) {
      const citations = message.citations ?? []
      if (!citations.length) return language === 'zh' ? '未命中知识库，以下内容包含模型补充' : 'No KB hit, answer contains model supplementation'
      if (message.model_provider === 'local') return language === 'zh' ? '严格基于知识库回答' : 'Strictly grounded in the knowledge base'
      return language === 'zh' ? '知识库证据 + 模型生成' : 'Knowledge-base evidence plus model generation'
    }

    function assistantLabel(message: ChatMessage) {
      if (message.role === 'user') return t('chat.you')
      const rawModel = message.model_model || message.model_name || selectedModel?.model || selectedModel?.name
      if (!rawModel) return PRODUCT_NAME
      if (/^deepseek/i.test(rawModel)) return rawModel.replace(/^deepseek/i, 'DeepSeek')
      if (/^qwen/i.test(rawModel)) return rawModel.replace(/^qwen/i, 'Qwen')
      if (/^claude/i.test(rawModel)) return rawModel.replace(/^claude/i, 'Claude')
      if (/^gemini/i.test(rawModel)) return rawModel.replace(/^gemini/i, 'Gemini')
      if (/^gpt/i.test(rawModel)) return rawModel.replace(/^gpt/i, 'GPT')
      return displayModelName(rawModel)
    }

    function messageTrustChips(message: ChatMessage) {
      if (message.role !== 'assistant') return []
      const chips: Array<{ label: string; tone?: 'good' | 'warn' | 'subtle' }> = []
      const citations = message.citations ?? []
      const citedFiles = new Set(citations.map((citation) => citation.document_id)).size
      if (citations.length) {
        chips.push({ label: t('chat.answerGrounded', { files: citedFiles, chunks: citations.length }), tone: 'good' })
        const hitTypes = summarizeCitationTypes(citations)
        if (hitTypes.length) chips.push({ label: `${language === 'zh' ? '命中文档类型' : 'Hit types'}: ${hitTypes.join(' / ')}`, tone: 'subtle' })
      } else if (message.content.trim()) {
        chips.push({ label: t('chat.answerUngrounded'), tone: 'warn' })
      }
      chips.push({ label: groundingMode(message), tone: citations.length ? 'subtle' : 'warn' })
      if (message.debug?.retrieval_mode) {
        chips.push({ label: retrievalModeLabel(message.debug.retrieval_mode), tone: 'subtle' })
      }
      if (message.debug?.retrieval_scope) {
        chips.push({ label: retrievalScopeLabel(message.debug.retrieval_scope), tone: 'subtle' })
      }
      if (message.usage?.is_estimated) {
        chips.push({ label: t('chat.costEstimated'), tone: 'subtle' })
      }
      return chips
    }

    return (
      <section className={showInspector ? 'chat-layout' : 'chat-layout chat-layout-wide'}>
        <aside className="conversation-rail">
          <div className="conversation-rail-header">
            <div className="section-heading">
              <History size={17} />
              <span>{t('chat.sessions')}</span>
            </div>
            <span className="conversation-count">{conversations.length}</span>
          </div>
          <button
            className="secondary-button full-width compact-create-button"
            onClick={() => {
              setConversationId(undefined)
              setMessages([])
              setChatTimeline([])
              dispatchChatMachine({ type: 'RESET' })
            }}
          >
            <Plus size={16} />
            {t('chat.newThread')}
          </button>
          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div className="conversation-empty">
                <strong>{language === 'zh' ? '还没有会话' : 'No conversations yet'}</strong>
                <span>{language === 'zh' ? '上传资料后，从右侧输入框开始你的第一轮提问。' : 'Upload project material and start the first question from the composer.'}</span>
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={conversation.id === conversationId ? 'conversation-item active' : 'conversation-item'}
                  onClick={() => handleLoadConversation(conversation.id)}
                >
                  <div className="conversation-item-title">
                    <strong>{displayRecoverableText(conversation.title, language, t('chat.newThread'))}</strong>
                  </div>
                  <span className="conversation-item-meta">
                    {conversation.preset_name ? `${conversation.preset_name} / ` : ''}
                    {formatDate(conversation.updated_at)}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className={messages.length === 0 ? 'chat-main chat-main-empty' : 'chat-main'}>
          <div className="chat-stream">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-header">
                  <div className="empty-state-copy">
                    <div className="page-kicker">PROJECT MEMORY / CHAT</div>
                    <h2>{t('chat.emptyTitle')}</h2>
                    <p>{t('chat.emptyBody')}</p>
                  </div>
                </div>
                <div className="empty-state-inline-meta">
                  <span className="meta-chip">{selectedProjectLabel}</span>
                  <span className="meta-chip">{currentModelLabel}</span>
                  {searchAllProjects ? <span className="meta-chip good">{language === 'zh' ? '跨项目检索' : 'Cross-project'}</span> : null}
                  {isProfessionalMode ? <span className="meta-chip">{effectivePresetLabel}</span> : null}
                </div>
                <div className="empty-state-section-label">{language === 'zh' ? '项目记忆动作' : 'Project memory actions'}</div>
                <div className="prompt-row prompt-chip-row">
                  {promptCards.map((item) => (
                    <button key={item.key} className="empty-prompt-pill" onClick={() => setQuestion(item.prompt)}>
                      <strong>{item.title}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => {
              const isActiveAssistantMessage = message.role === 'assistant' && message.id === chatMachine.assistantMessageId && isSending
              const reasoningCount = isActiveAssistantMessage ? chatMachine.reasoningCount : message.reasoning_count
              return (
                <article key={`${message.role}-${index}`} className={`message ${message.role}`} data-chat-state={isActiveAssistantMessage ? chatMachine.stage : undefined}>
                  <div className="message-role">{assistantLabel(message)}</div>
                  <div className={isActiveAssistantMessage && !message.content ? 'message-content loading-line' : 'message-content'}>
                    {isActiveAssistantMessage && !message.content ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        {reasoningCount ? t('chat.status.reasoningReceived', { count: reasoningCount }) : statusLabel}
                      </>
                    ) : (
                      message.content
                    )}
                  </div>
                  {message.role === 'assistant' && (
                    <div className="message-trust-row">
                      {messageTrustChips(message).map((chip) => (
                        <span key={`${message.id || index}-${chip.label}`} className={`meta-chip ${chip.tone || 'subtle'}`}>
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.role === 'assistant' && !(message.citations?.length) && message.content.trim() && (
                    <div className="message-trust-note">
                      {language === 'zh'
                        ? '本轮没有从知识库命中可引用资料，请把这次回答视为模型补充结果。'
                        : 'No citable knowledge-base evidence was retrieved for this answer.'}
                    </div>
                  )}
                  {message.role === 'assistant' && message.usage && (
                    <div className={isProfessionalMode ? 'message-usage' : 'message-usage compact'}>
                      {t('models.usageTotal')}: {message.usage.total_tokens.toLocaleString()} / {t('models.usageCost')}: {formatCost(message.usage.estimated_cost, message.usage.currency)}
                    </div>
                  )}
                  {!!message.citations?.length && (
                    <div className="inline-citations">
                      {message.citations.slice(0, 3).map((citation) => (
                        <button type="button" key={citation.chunk_id} onClick={() => openCitationPreview(citation)} title={t('evidence.open')}>
                          [{citation.rank}] {citation.document_title}
                          {citation.section_path ? ` / ${citation.section_path}` : ''} / {citationWhy(citation)}
                        </button>
                      ))}
                    </div>
                  )}
                  {message.role === 'assistant' && message.id && message.id > 0 && isProfessionalMode && (
                    <div className="feedback-row">
                      <span>{t('chat.feedback')}</span>
                      <button className="chip" type="button" onClick={() => handleSaveFeedback(message, 1)}>
                        <Check size={13} />
                      </button>
                      <button className="chip" type="button" onClick={() => handleSaveFeedback(message, -1)}>
                        <X size={13} />
                      </button>
                      <input
                        value={feedbackDrafts[message.id] || ''}
                        onChange={(event) => setFeedbackDrafts((current) => ({ ...current, [message.id!]: event.target.value }))}
                        placeholder={t('chat.feedbackNote')}
                      />
                    </div>
                  )}
                </article>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          <form className="composer" onSubmit={handleSend} data-tour="chat-composer">
            <div className="composer-topline">
              <div className="composer-inline-meta">
                <span className="meta-chip">{currentModelLabel}</span>
                <span className="meta-chip">{effectivePresetLabel}</span>
                <span className="meta-chip">{selectedProjectLabel}</span>
                <button type="button" className={searchAllProjects ? 'chip active' : 'chip'} onClick={() => setSearchAllProjects((current) => !current)}>
                  {language === 'zh' ? '跨项目检索' : 'Cross-project'}
                </button>
              </div>
              <div className={`composer-status-pill ${isSending ? 'busy' : ''}`}>
                {isSending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                <span>{composerHint}</span>
              </div>
            </div>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={t('chat.placeholder')}
              rows={3}
            />
            <div className="composer-toolbar">
              <div className="composer-select-stack">
                {isProfessionalMode ? (
                  <label className="composer-select-field">
                    <span>{language === 'zh' ? '预设' : 'Preset'}</span>
                    <select
                      className="composer-model-select"
                      value={selectedPresetId ?? ''}
                      onChange={(event) => setSelectedPresetId(event.target.value ? Number(event.target.value) : undefined)}
                      title={effectivePresetLabel}
                      disabled={!modelPresets.length}
                    >
                      <option value="">{language === 'zh' ? '跟随默认预设' : 'Follow default preset'}</option>
                      {modelPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="composer-select-field">
                  <span>{language === 'zh' ? '模型' : 'Model'}</span>
                  <select
                    className="composer-model-select"
                    value={selectedModel?.id ?? ''}
                    onChange={(event) => handleSelectChatModel(Number(event.target.value))}
                    title={t('chat.modelSwitcher')}
                    disabled={!chatModelOptions.length}
                  >
                    {!chatModelOptions.length && <option value="">{t('chat.noModel')}</option>}
                    {chatModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelOptionLabel(model)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="composer-action-row">
                <button className="send-button" type="submit" disabled={isSending || !question.trim()} title={t('chat.send')}>
                  {isSending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                </button>
                <button className="secondary-button compact-regenerate" type="button" disabled={!conversationId || isSending} onClick={handleRegenerate}>
                  <RefreshCcw size={16} />
                  {t('chat.regenerate')}
                </button>
              </div>
            </div>
            {(!!presetSummaryChips.length || searchAllProjects) && (
              <div className="composer-aux-chips">
                {presetSummaryChips.map((chip) => (
                  <span className="meta-chip" key={chip}>
                    {chip}
                  </span>
                ))}
                <span className="meta-chip subtle">{presetModeLabel}</span>
                {searchAllProjects ? <span className="meta-chip good">{language === 'zh' ? '本轮会跨项目检索全部资料' : 'This chat searches across all projects'}</span> : null}
              </div>
            )}
            {!!chatTimeline.length && (isProfessionalMode || isSending) && (
              <div className="chat-timeline">
                {chatTimeline.map((item) => (
                  <div className={`timeline-step ${item.stage === chatMachine.stage ? 'active' : ''}`} key={item.id}>
                    <strong>{item.label}</strong>
                    <span>{new Date(item.at).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </div>
                ))}
              </div>
            )}
          </form>
        </section>

        {showInspector && (
        <aside className="inspector">
          <div className="section-heading">
            <FileText size={17} />
            <span>{t('evidence.title')}</span>
          </div>
          <div className="evidence-summary-card">
            <div className="evidence-summary-row">
              <strong>{t('evidence.summary')}</strong>
              <span>{t('chat.answerGrounded', { files: latestCitationDocuments, chunks: latestCitations.length })}</span>
            </div>
            {latestAssistantMessage && (
              <div className="evidence-summary-row">
                <strong>{language === 'zh' ? '回答方式' : 'Grounding mode'}</strong>
                <span>{groundingMode(latestAssistantMessage)}</span>
              </div>
            )}
            <div className="evidence-summary-row">
              <strong>{t('evidence.sourceFiles')}</strong>
              <span>{latestCitationDocuments}</span>
            </div>
            {!!latestCitationTypes.length && (
              <div className="evidence-summary-row">
                <strong>{language === 'zh' ? '文档类型' : 'Document types'}</strong>
                <span>{latestCitationTypes.join(' / ')}</span>
              </div>
            )}
            {bestCitation && (
              <div className="evidence-summary-row">
                <strong>{t('evidence.bestMatch')}</strong>
                <span>{bestCitation.document_title} / {Math.round((bestCitation.score || 0) * 100)}%</span>
              </div>
            )}
            {latestAssistantDebug && (
              <div className="evidence-summary-row">
                <strong>{language === 'zh' ? '检索方式' : 'Retrieval'}</strong>
                <span>{retrievalModeLabel(latestAssistantDebug.retrieval_mode)} / {retrievalScopeLabel(latestAssistantDebug.retrieval_scope)}</span>
              </div>
            )}
          </div>
          {latestCitations.length === 0 ? (
            <p className="muted">{t('evidence.empty')}</p>
          ) : (
            <div className="citation-list">
              {latestCitations.map((citation) => (
                <button className="citation-item as-button" key={citation.chunk_id} onClick={() => openCitationPreview(citation)} title={t('evidence.open')}>
                  <div className="citation-title">
                    <span>[{citation.rank}] {citation.document_title}</span>
                    <small>{Math.round(citation.score * 100)}%</small>
                  </div>
                  <div className="citation-metrics">
                    <span>{citation.filename}</span>
                    <span>{citationWhy(citation)}</span>
                  </div>
                  <p>{citation.snippet}</p>
                </button>
              ))}
            </div>
          )}
          {latestAssistantDebug && isProfessionalMode && (
            <div className="evidence-debug">
              <div className="section-heading compact">
                <Gauge size={16} />
                <span>{language === 'zh' ? '本次检索说明' : 'Retrieval explanation'}</span>
              </div>
              <div className="table-list">
                <div className="table-row">
                  <div>
                    <strong>{language === 'zh' ? '模式' : 'Mode'}</strong>
                    <span>{retrievalModeLabel(latestAssistantDebug.retrieval_mode)} / {retrievalScopeLabel(latestAssistantDebug.retrieval_scope)}</span>
                  </div>
                </div>
                <div className="table-row">
                  <div>
                    <strong>{language === 'zh' ? '命中数量' : 'Hits'}</strong>
                    <span>top {latestAssistantDebug.top_k} / {latestAssistantDebug.retrieved_count} hit(s)</span>
                  </div>
                </div>
                <div className="table-row">
                  <div>
                    <strong>{language === 'zh' ? '耗时' : 'Latency'}</strong>
                    <span>{latestAssistantDebug.retrieval_ms}ms / {latestAssistantDebug.generation_ms}ms</span>
                  </div>
                </div>
                {latestAssistantDebug.effective_query ? (
                  <div className="table-row">
                    <div>
                      <strong>{language === 'zh' ? '实际检索问题' : 'Effective query'}</strong>
                      <span>{latestAssistantDebug.effective_query}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </aside>
        )}
      </section>
    )
  }

  function renderKnowledge() {
    const folderPickerProps = { webkitdirectory: '', directory: '' } as Record<string, string>
    const treeChildren = documentTree?.children ?? []
    const selectedFiles = files ? Array.from(files) : []
    const selectedFileCount = selectedFiles.length
    const selectedFileBytes = selectedFiles.reduce((sum, file) => sum + Number(file.size || 0), 0)
    const selectedFileLabels = selectedFiles.slice(0, 4).map((file) => {
      const relativePath = 'webkitRelativePath' in file ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : ''
      return relativePath || file.name
    })
    const duplicatePreviewCount = documentPreviews.filter((item) => item.duplicate_document_id).length
    const previewReadyCount = documentPreviews.length
    const ingestPhaseLabel = isUploading
      ? ingestAction === 'preview'
        ? language === 'zh'
          ? '正在分析文件与切片'
          : 'Analyzing files and chunks'
        : language === 'zh'
          ? '正在写入知识库'
          : 'Indexing into the knowledge base'
      : selectedFileCount
        ? language === 'zh'
          ? '文件已就绪，可以先预览再入库'
          : 'Files are ready. Preview first, then index.'
        : language === 'zh'
          ? '选择项目文件夹、压缩包或资料文件开始导入'
          : 'Choose a folder, archive, or project files to begin.'
    const previewResultCount = previewReadyCount || previewSkipped.length
    const selectedChunkIndex = selectedDocument?.chunks.findIndex((chunk) => chunk.id === selectedChunkId) ?? -1
    const focusedChunks =
      selectedDocument && selectedChunkIndex >= 0
        ? selectedDocument.chunks.slice(Math.max(0, selectedChunkIndex - 1), Math.min(selectedDocument.chunks.length, selectedChunkIndex + 2))
        : []
    const latestImportJob = importJobs[0]
    const totalChunkCount = documents.reduce((sum, document) => sum + Number(document.chunk_count || 0), 0)
    const indexedDocumentCount = documents.filter((document) => document.status === 'ready').length || documents.length
    const failedDocumentCount = documents.filter((document) => document.status === 'failed').length
    const latestImportLabel = latestImportJob
      ? `${latestImportJob.indexed_files}/${latestImportJob.total_files || latestImportJob.indexed_files} ${language === 'zh' ? '个文件' : 'files'}`
      : language === 'zh'
        ? '还没有导入记录'
        : 'No import yet'
    const activeKnowledgeLayer: KnowledgeLayer = isProfessionalMode ? knowledgeLayer : 'daily'
    const previewReadyItems = documentPreviews.filter((item) => !item.duplicate_document_id)
    const previewDuplicateItems = documentPreviews.filter((item) => item.duplicate_document_id)
    const previewSkippedItems = previewSkipped.filter((item) => item.status === 'skipped')
    const previewFailedItems = previewSkipped.filter((item) => item.status === 'failed')
    const previewByRoot = buildPathTree(documentPreviews)
    const latestImportSummary = lastImportSnapshot?.summary ?? latestImportJob?.summary ?? null
    const latestImportResults = lastImportSnapshot?.results ?? latestImportJob?.results ?? []

    function importStatusLabel(status: ImportJob['status']) {
      if (status === 'running') return language === 'zh' ? '处理中' : 'Running'
      if (status === 'failed') return language === 'zh' ? '失败' : 'Failed'
      return language === 'zh' ? '已完成' : 'Completed'
    }

    function importCompletion(job: ImportJob) {
      if (!job.total_files) return 0
      const handled = job.indexed_files + job.skipped_files + job.failed_files
      return Math.max(0, Math.min(100, Math.round((handled / job.total_files) * 100)))
    }

    function importResultTone(status: ImportResultItem['status']) {
      if (status === 'indexed') return 'good'
      if (status === 'duplicate') return 'warning'
      if (status === 'failed') return 'danger'
      return 'subtle'
    }

    function importResultLabel(status: ImportResultItem['status']) {
      if (status === 'indexed') return language === 'zh' ? '新增' : 'Indexed'
      if (status === 'duplicate') return language === 'zh' ? '重复' : 'Duplicate'
      if (status === 'failed') return language === 'zh' ? '失败' : 'Failed'
      return language === 'zh' ? '跳过' : 'Skipped'
    }

    function renderTreeNode(node: DocumentTreeNode, depth = 0): JSX.Element {
      if (node.type === 'file' && node.document) {
        return (
          <div
            key={node.path}
            className={selectedDocument?.id === node.document.id ? 'tree-node file active' : 'tree-node file'}
            style={{ paddingLeft: 10 + depth * 14 }}
          >
            <input
              type="checkbox"
              checked={selectedDocumentIds.includes(node.document.id)}
              onChange={(event) =>
                setSelectedDocumentIds((current) =>
                  event.target.checked ? [...current, node.document!.id] : current.filter((id) => id !== node.document!.id),
                )
              }
            />
            <FileText size={14} />
            <button type="button" onClick={() => openDocument(node.document!.id)}>
              <span>{node.name}</span>
            </button>
            <span className={`tree-node-status ${node.document.status || 'unknown'}`}>{documentStatusLabel(node.document.status)}</span>
            <small>{node.document.chunk_count}</small>
          </div>
        )
      }

      return (
        <div className="tree-folder" key={node.path || 'root'}>
          {node.path && (
            <div className="tree-node folder" style={{ paddingLeft: 10 + depth * 14 }}>
              <FolderTree size={14} />
              <span>{node.name}</span>
            </div>
          )}
          {node.children?.map((child) => renderTreeNode(child, node.path ? depth + 1 : depth))}
        </div>
      )
    }

    function renderResultNotes(item: ImportResultItem) {
      if (item.status === 'indexed') {
        return (
          <span>
            {language === 'zh' ? `已新增 ${item.chunks || 0} 个切片` : `${item.chunks || 0} chunks added`}
          </span>
        )
      }
      if (item.status === 'duplicate') {
        return (
          <span>
            {language === 'zh' ? '与已索引内容重复' : 'Matches an indexed document'}
            {item.last_indexed_at ? ` / ${formatDate(item.last_indexed_at)}` : ''}
          </span>
        )
      }
      return <span>{item.reason || (language === 'zh' ? '未提供原因' : 'No reason provided')}</span>
    }

    function renderImportResultList(items: ImportResultItem[], emptyLabel: string) {
      if (!items.length) return <p className="muted">{emptyLabel}</p>
      return (
        <div className="import-result-list">
          {items.map((item) => (
            <div className="import-result-item" key={`${item.status}-${item.filename}`}>
              <div className="import-result-header">
                <strong>{item.filename}</strong>
                <span className={`meta-chip ${importResultTone(item.status)}`}>{importResultLabel(item.status)}</span>
              </div>
              <div className="import-result-meta">
                {renderResultNotes(item)}
                {item.duplicate_filename && item.duplicate_filename !== item.filename ? <small>{item.duplicate_filename}</small> : null}
              </div>
              {item.document_id ? (
                <button type="button" className="detail-link" onClick={() => openDocument(item.document_id!)}>
                  {language === 'zh' ? '查看来源文档' : 'Open source document'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )
    }

    return (
      <section className={isProfessionalMode ? 'knowledge-workbench' : 'knowledge-workbench simple'}>
        <div className="knowledge-page-header">
          <div>
            <h2>{language === 'zh' ? '知识库' : 'Knowledge base'}</h2>
            <p>
              {activeKnowledgeLayer === 'daily'
                ? language === 'zh'
                  ? '先看导入结果、文件状态和来源，再决定是否调整检索。'
                  : 'Start with imports, document state, and sources before touching retrieval controls.'
                : language === 'zh'
                  ? '这里放切片、Embedding、Rerank、过滤器和评测，不打扰日常使用。'
                  : 'Chunking, embedding, rerank, filters, and eval stay here so daily use stays calm.'}
            </p>
          </div>
          {isProfessionalMode ? (
            <div className="segmented-control knowledge-layer-toggle" aria-label={language === 'zh' ? '知识库层级' : 'Knowledge layers'}>
              <button className={activeKnowledgeLayer === 'daily' ? 'active' : ''} onClick={() => setKnowledgeLayer('daily')}>
                {language === 'zh' ? '日常' : 'Daily'}
              </button>
              <button className={activeKnowledgeLayer === 'advanced' ? 'active' : ''} onClick={() => setKnowledgeLayer('advanced')}>
                {language === 'zh' ? '高级' : 'Advanced'}
              </button>
            </div>
          ) : null}
        </div>

        <div className="knowledge-overview-strip">
          <div className="overview-metric">
            <span>{t('library.documentsIndexed')}</span>
            <strong>{indexedDocumentCount.toLocaleString()}</strong>
          </div>
          <div className="overview-metric">
            <span>{t('library.totalChunks')}</span>
            <strong>{totalChunkCount.toLocaleString()}</strong>
          </div>
          <div className="overview-metric">
            <span>{t('library.lastImport')}</span>
            <strong>{latestImportLabel}</strong>
          </div>
          <div className="overview-metric">
            <span>{language === 'zh' ? '异常文档' : 'Problem documents'}</span>
            <strong>{failedDocumentCount ? failedDocumentCount.toLocaleString() : t('library.statusHealthy')}</strong>
          </div>
        </div>

        <div className="knowledge-global-tools">
          <form className="panel knowledge-search-panel" onSubmit={handleGlobalSearch}>
            <div className="section-heading split">
              <span>{language === 'zh' ? '全局搜索 / 跨项目检索' : 'Global search / cross-project retrieval'}</span>
              <small>{searchAllProjects ? t('project.all') : displayProjectName(selectedProject?.name, 'project.all')}</small>
            </div>
            <div className="manual-model-row">
              <input
                value={globalSearchQuery}
                onChange={(event) => setGlobalSearchQuery(event.target.value)}
                placeholder={language === 'zh' ? '搜索需求、模块、部署步骤、技术决策或文件名' : 'Search requirements, modules, deployment steps, decisions, or filenames'}
              />
              <button className="primary-button" type="submit" disabled={isGlobalSearching || !globalSearchQuery.trim()}>
                {isGlobalSearching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                {language === 'zh' ? '搜索' : 'Search'}
              </button>
            </div>
            <div className="button-row compact-row">
              <button type="button" className={searchAllProjects ? 'chip active' : 'chip'} onClick={() => setSearchAllProjects((current) => !current)}>
                {language === 'zh' ? '跨全部项目' : 'Across all projects'}
              </button>
              {globalSearchResult ? <span className="meta-chip subtle">{language === 'zh' ? `检索耗时 ${globalSearchResult.retrieval_ms}ms` : `${globalSearchResult.retrieval_ms}ms`}</span> : null}
            </div>
            <div className="search-result-list">
              {globalSearchResult?.items.length ? (
                globalSearchResult.items.slice(0, 6).map((item) => (
                  <button className="search-result-item" type="button" key={`search-${item.chunk_id}`} onClick={() => openCitationPreview(item)}>
                    <div className="search-result-title">
                      <strong>{item.document_title}</strong>
                      <span>{Math.round((item.score || 0) * 100)}%</span>
                    </div>
                    <div className="search-result-meta">
                      <span>{item.project_name ? `${displayProjectName(item.project_name)} / ` : ''}{item.filename}</span>
                      <span>{citationWhy(item)}</span>
                    </div>
                    <p>{item.snippet}</p>
                  </button>
                ))
              ) : globalSearchResult ? (
                <p className="muted">{language === 'zh' ? '没有找到匹配内容。' : 'No matching content found.'}</p>
              ) : (
                <p className="muted">{language === 'zh' ? '你可以先搜某个功能、某次部署、一个报错词，或者直接搜文件名。' : 'Try a feature, a deployment step, an error string, or a filename.'}</p>
              )}
            </div>
          </form>

          <div className="panel knowledge-sync-panel">
            <div className="section-heading split">
              <span>{language === 'zh' ? '文件夹监听同步' : 'Folder sync'}</span>
              <small>{syncSources.length}</small>
            </div>
            <form className="stacked-form" onSubmit={handleCreateSyncSource}>
              <input value={syncSourceDraft.name} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, name: event.target.value })} placeholder={language === 'zh' ? '同步名称，例如：项目源码目录' : 'Sync name'} />
              <input value={syncSourceDraft.source_path} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, source_path: event.target.value })} placeholder={language === 'zh' ? '输入后端所在机器上的文件夹路径' : 'Folder path on the backend machine'} />
              <div className="form-grid two-columns">
                <label>
                  <span>{language === 'zh' ? '扫描间隔（秒）' : 'Interval (seconds)'}</span>
                  <input type="number" min={15} max={3600} value={syncSourceDraft.poll_interval_seconds} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, poll_interval_seconds: Number(event.target.value) || 60 })} />
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={syncSourceDraft.delete_missing} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, delete_missing: event.target.checked })} />
                  <span>{language === 'zh' ? '源文件删除时同步移除索引' : 'Delete index when source disappears'}</span>
                </label>
              </div>
              <input value={syncSourceDraft.include_globs} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, include_globs: event.target.value })} placeholder={language === 'zh' ? '仅包含这些 glob，例如：src/**,docs/**' : 'Include globs'} />
              <input value={syncSourceDraft.exclude_globs} onChange={(event) => setSyncSourceDraft({ ...syncSourceDraft, exclude_globs: event.target.value })} placeholder={language === 'zh' ? '排除这些 glob，例如：dist/**,*.png' : 'Exclude globs'} />
              <button className="primary-button" type="submit">
                <Plus size={16} />
                {language === 'zh' ? '添加监听文件夹' : 'Add watched folder'}
              </button>
            </form>
            <div className="sync-source-list">
              {syncSources.length === 0 ? (
                <p className="muted">{language === 'zh' ? '还没有监听目录。适合放你正在持续更新的项目文件夹。' : 'No watched folders yet.'}</p>
              ) : (
                syncSources.map((source) => (
                  <div className="sync-source-item" key={source.id}>
                    <div className="sync-source-header">
                      <div>
                        <strong>{source.name}</strong>
                        <span>{source.source_path}</span>
                      </div>
                      <div className="row-actions">
                        <button className={source.enabled ? 'chip active' : 'chip'} type="button" onClick={async () => { await api.patchSyncSource(source.id, { enabled: !source.enabled }); await refreshAll() }}>
                          {source.enabled ? t('common.enabled') : t('common.disabled')}
                        </button>
                        <button className="chip" type="button" onClick={() => handleScanSyncSource(source.id)} disabled={scanningSyncSourceId === source.id}>
                          {scanningSyncSourceId === source.id ? <Loader2 size={13} className="spin" /> : <RefreshCcw size={13} />}
                          {language === 'zh' ? '立即扫描' : 'Scan now'}
                        </button>
                        <button className="icon-button danger" type="button" title={t('models.delete')} onClick={async () => { await api.deleteSyncSource(source.id); await refreshAll() }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="sync-source-meta">
                      <span>{language === 'zh' ? `最近扫描：${source.last_scan_at ? formatDate(source.last_scan_at) : '未执行'}` : `Last scan: ${source.last_scan_at ? formatDate(source.last_scan_at) : 'Never'}`}</span>
                      <span>{language === 'zh' ? `已跟踪 ${source.document_count} 个文件` : `${source.document_count} tracked file(s)`}</span>
                      <span>{language === 'zh' ? `待处理 ${source.pending_count}` : `${source.pending_count} pending`}</span>
                    </div>
                    {source.last_summary ? (
                      <div className="preview-overview">
                        <span className="meta-chip good">{language === 'zh' ? `新增 ${source.last_summary.indexed_files || 0}` : `Added ${source.last_summary.indexed_files || 0}`}</span>
                        <span className="meta-chip">{language === 'zh' ? `更新 ${source.last_summary.updated_files || 0}` : `Updated ${source.last_summary.updated_files || 0}`}</span>
                        <span className="meta-chip warning">{language === 'zh' ? `缺失 ${source.last_summary.missing_files || 0}` : `Missing ${source.last_summary.missing_files || 0}`}</span>
                        <span className="meta-chip subtle">{language === 'zh' ? `未变更 ${source.last_summary.unchanged_files || 0}` : `Unchanged ${source.last_summary.unchanged_files || 0}`}</span>
                      </div>
                    ) : null}
                    {source.last_error ? <p className="message-trust-note">{source.last_error}</p> : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel knowledge-share-panel">
            <div className="section-heading split">
              <span>{language === 'zh' ? '项目共享' : 'Project sharing'}</span>
              <small>{projectRoleLabel(selectedProject?.access_role)}</small>
            </div>
            <p className="muted">
              {language === 'zh'
                ? '这里看当前项目有哪些成员、他们在项目里的角色，以及谁还能编辑知识库内容。'
                : 'See who is in this project and which role they have here.'}
            </p>
            <div className="knowledge-share-summary">
              <span className="meta-chip">{language === 'zh' ? `成员 ${projectMembers.length}` : `${projectMembers.length} members`}</span>
              {selectedProject?.member_count ? <span className="meta-chip subtle">{language === 'zh' ? `已共享 ${selectedProject.member_count} 人` : `Shared with ${selectedProject.member_count}`}</span> : null}
              <span className="meta-chip subtle">{workspaceRoleLabel(authSession?.user?.workspace_role)}</span>
            </div>
            {canManageProject && teamMembers.length > 0 ? (
              <form className="stacked-form" onSubmit={handleAddProjectMember}>
                <div className="form-grid two-columns">
                  <label>
                    <span>{language === 'zh' ? '加入成员' : 'Add member'}</span>
                    <select value={projectShareDraft.user_id ?? ''} onChange={(event) => setProjectShareDraft((current) => ({ ...current, user_id: event.target.value ? Number(event.target.value) : undefined }))}>
                      <option value="">{language === 'zh' ? '选择已有成员' : 'Select member'}</option>
                      {teamMembers
                        .filter((member) => !projectMembers.some((projectMember) => projectMember.user_id === member.user_id))
                        .map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.display_name || member.email}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span>{language === 'zh' ? '项目角色' : 'Project role'}</span>
                    <select value={projectShareDraft.role} onChange={(event) => setProjectShareDraft((current) => ({ ...current, role: event.target.value as 'owner' | 'editor' | 'viewer' }))}>
                      <option value="viewer">{language === 'zh' ? '查看者' : 'Viewer'}</option>
                      <option value="editor">{language === 'zh' ? '编辑者' : 'Editor'}</option>
                      <option value="owner">{language === 'zh' ? '项目所有者' : 'Owner'}</option>
                    </select>
                  </label>
                </div>
                <button className="secondary-button" type="submit">
                  <Plus size={16} />
                  {language === 'zh' ? '加入当前项目' : 'Add to project'}
                </button>
              </form>
            ) : null}
            <div className="member-card-list">
              {projectMembers.length === 0 ? (
                <p className="muted">{language === 'zh' ? '当前项目还没有共享给其他成员。' : 'This project has not been shared yet.'}</p>
              ) : (
                projectMembers.map((member) => (
                  <div className="member-card" key={`project-member-${member.user_id}`}>
                    <div className="member-card-main">
                      <strong>{member.display_name || member.email}</strong>
                      <span>{member.email}</span>
                      <small>{language === 'zh' ? `工作区角色：${workspaceRoleLabel(member.workspace_role)}` : `Workspace: ${workspaceRoleLabel(member.workspace_role)}`}</small>
                    </div>
                    <div className="member-card-side">
                      <span className="meta-chip">{projectRoleLabel(member.role)}</span>
                      {canManageProject ? (
                        <select value={member.role} onChange={(event) => void handlePatchProjectMember(member.user_id, event.target.value as 'owner' | 'editor' | 'viewer')}>
                          <option value="viewer">{language === 'zh' ? '查看者' : 'Viewer'}</option>
                          <option value="editor">{language === 'zh' ? '编辑者' : 'Editor'}</option>
                          <option value="owner">{language === 'zh' ? '所有者' : 'Owner'}</option>
                        </select>
                      ) : (
                        <span className="chip">{projectRoleLabel(member.role)}</span>
                      )}
                      {canManageProject && member.role !== 'owner' ? (
                        <button className="icon-button danger" type="button" onClick={() => void handleRemoveProjectMember(member.user_id)}>
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {activeKnowledgeLayer === 'daily' ? (
          <>
            <div className="knowledge-daily-grid">
              <div className="panel knowledge-ingest-panel">
                <div className="section-heading">
                  <Upload size={17} />
                  <span>{t('library.ingest')}</span>
                </div>
                <label className="file-drop" data-tour="knowledge-upload">
                  <input type="file" multiple onChange={(event) => setFiles(event.target.files)} />
                  <Upload size={22} />
                  <strong>{files?.length ? t('library.selected', { count: files.length }) : t('library.drop')}</strong>
                  <span>{t('library.fileTypes')}</span>
                </label>
                <div className="ingest-summary">
                  <div className="ingest-summary-header">
                    <div>
                      <strong>{language === 'zh' ? `导入到 ${displayProjectName(selectedProject?.name)}` : `Import into ${displayProjectName(selectedProject?.name)}`}</strong>
                      <span>{ingestPhaseLabel}</span>
                    </div>
                    <span className={`status-badge ${isUploading ? 'running' : selectedFileCount ? 'ready' : 'idle'}`}>
                      {isUploading ? (language === 'zh' ? '进行中' : 'Working') : selectedFileCount ? (language === 'zh' ? '待处理' : 'Ready') : language === 'zh' ? '未选择' : 'Idle'}
                    </span>
                  </div>
                  <div className="ingest-summary-metrics">
                    <div className="summary-metric">
                      <span>{language === 'zh' ? '待导入文件' : 'Queued files'}</span>
                      <strong>{selectedFileCount.toLocaleString()}</strong>
                    </div>
                    <div className="summary-metric">
                      <span>{language === 'zh' ? '总大小' : 'Total size'}</span>
                      <strong>{formatBytes(selectedFileBytes)}</strong>
                    </div>
                    <div className="summary-metric">
                      <span>{language === 'zh' ? '预览可入库' : 'Preview ready'}</span>
                      <strong>{previewSummary?.indexed_files ?? previewReadyCount}</strong>
                    </div>
                    <div className="summary-metric">
                      <span>{language === 'zh' ? '重复与跳过' : 'Duplicates and skipped'}</span>
                      <strong>{previewSummary ? previewSummary.duplicate_files + previewSummary.skipped_files + previewSummary.failed_files : previewSkipped.length}</strong>
                    </div>
                  </div>
                  {selectedFileLabels.length > 0 && (
                    <div className="selected-file-list">
                      {selectedFileLabels.map((name) => (
                        <span key={name}>{name}</span>
                      ))}
                      {selectedFileCount > selectedFileLabels.length && (
                        <span>{language === 'zh' ? `还有 ${selectedFileCount - selectedFileLabels.length} 个文件` : `${selectedFileCount - selectedFileLabels.length} more files`}</span>
                      )}
                    </div>
                  )}
                  {previewResultCount > 0 && (
                    <div className="preview-overview">
                      <span className="meta-chip">{language === 'zh' ? `可入库 ${previewReadyItems.length} 个` : `${previewReadyItems.length} ready`}</span>
                      {duplicatePreviewCount > 0 && (
                        <span className="meta-chip warning">{language === 'zh' ? `重复 ${duplicatePreviewCount} 个` : `${duplicatePreviewCount} duplicate`}</span>
                      )}
                      {previewSkipped.length > 0 && (
                        <span className="meta-chip danger">{language === 'zh' ? `异常 ${previewSkipped.length} 个` : `${previewSkipped.length} issues`}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="file-action-row">
                  <label className="secondary-button">
                    <input type="file" multiple onChange={(event) => setFiles(event.target.files)} />
                    <FileText size={16} />
                    {t('library.pickFiles')}
                  </label>
                  <label className="secondary-button">
                    <input type="file" multiple {...folderPickerProps} onChange={(event) => setFiles(event.target.files)} />
                    <Upload size={16} />
                    {t('library.pickFolder')}
                  </label>
                </div>
                <div className="knowledge-ingest-actions">
                  <button className="secondary-button full-width" onClick={handlePreviewDocuments} disabled={!files?.length || isUploading}>
                    {isUploading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                    {t('library.preview')}
                  </button>
                  <button className="primary-button full-width" onClick={handleUpload} disabled={!files?.length || isUploading}>
                    {isUploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
                    {t('library.index')}
                  </button>
                </div>

                {(latestImportSummary || previewSummary) && (
                  <div className="knowledge-import-summary">
                    <div className="section-heading compact">
                      <ClipboardList size={16} />
                      <span>{language === 'zh' ? '本次新增了什么' : 'What changed in this import'}</span>
                    </div>
                    <div className="preview-overview">
                      <span className="meta-chip good">{language === 'zh' ? `新增 ${latestImportSummary?.indexed_files ?? previewSummary?.indexed_files ?? 0}` : `Added ${latestImportSummary?.indexed_files ?? previewSummary?.indexed_files ?? 0}`}</span>
                      <span className="meta-chip warning">{language === 'zh' ? `重复 ${latestImportSummary?.duplicate_files ?? previewSummary?.duplicate_files ?? 0}` : `Duplicate ${latestImportSummary?.duplicate_files ?? previewSummary?.duplicate_files ?? 0}`}</span>
                      <span className="meta-chip danger">{language === 'zh' ? `失败 ${latestImportSummary?.failed_files ?? previewSummary?.failed_files ?? 0}` : `Failed ${latestImportSummary?.failed_files ?? previewSummary?.failed_files ?? 0}`}</span>
                    </div>
                    {!!latestImportSummary?.new_files?.length && (
                      <p className="muted">
                        {language === 'zh' ? '新增文件' : 'New files'}: {latestImportSummary.new_files.slice(0, 4).join(' / ')}
                        {latestImportSummary.new_files.length > 4 ? ` +${latestImportSummary.new_files.length - 4}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="panel knowledge-preview-panel">
                <div className="section-heading split">
                  <span>{language === 'zh' ? '导入解释' : 'Import explanation'}</span>
                  <small>{language === 'zh' ? '为什么成功、重复、跳过或失败' : 'Why each file was added, duplicated, skipped, or failed'}</small>
                </div>
                {!documentPreviews.length && !previewSkipped.length && !latestImportResults.length ? (
                  <p className="muted">{t('library.previewEmpty')}</p>
                ) : (
                  <>
                    {!!documentPreviews.length && (
                      <div className="knowledge-preview-groups">
                        {Object.entries(previewByRoot).map(([root, items]) => (
                          <div className="preview-root-group" key={root}>
                            <div className="preview-root-title">{root === 'root' ? (language === 'zh' ? '当前目录' : 'Current folder') : root}</div>
                            <div className="preview-list">
                              {items.map((preview) => (
                                <div className={`preview-item ${preview.duplicate_document_id ? 'warning' : ''}`} key={preview.checksum + preview.filename}>
                                  <div className="preview-item-header">
                                    <strong>{preview.filename}</strong>
                                    <span className={`meta-chip ${preview.duplicate_document_id ? 'warning' : 'good'}`}>
                                      {preview.duplicate_document_id ? (language === 'zh' ? '重复内容' : 'Duplicate') : language === 'zh' ? '可入库' : 'Ready'}
                                    </span>
                                  </div>
                                  <span>
                                    {t('library.chunks', { count: preview.chunk_count })}
                                    {preview.last_indexed_at ? ` / ${language === 'zh' ? '上次索引' : 'Last indexed'} ${formatDate(preview.last_indexed_at)}` : ''}
                                  </span>
                                  {preview.duplicate_filename ? <small>{language === 'zh' ? `已存在来源：${preview.duplicate_filename}` : `Existing source: ${preview.duplicate_filename}`}</small> : null}
                                  {preview.chunks.slice(0, 2).map((chunk) => (
                                    <p key={chunk.chunk_index}>{chunk.section_path ? `${chunk.section_path}: ` : ''}{chunk.content}</p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {!!previewSkippedItems.length && (
                      <div className="knowledge-inline-group">
                        <div className="section-heading compact">
                          <Layers3 size={16} />
                          <span>{language === 'zh' ? '跳过文件' : 'Skipped files'}</span>
                        </div>
                        {renderImportResultList(previewSkippedItems, '')}
                      </div>
                    )}
                    {!!previewFailedItems.length && (
                      <div className="knowledge-inline-group">
                        <div className="section-heading compact">
                          <AlertTriangle size={16} />
                          <span>{language === 'zh' ? '失败文件' : 'Failed files'}</span>
                        </div>
                        {renderImportResultList(previewFailedItems, '')}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="knowledge-content-grid">
              <div className="panel knowledge-tree-panel">
                <div className="section-heading split">
                  <span>{t('library.fileTree')}</span>
                  <small>{t('library.filesCount', { count: documents.length })}</small>
                </div>
                <div className="button-row compact-row">
                  <button className="secondary-button" type="button" disabled={!selectedDocumentIds.length} onClick={handleBatchDeleteDocuments}>
                    <Trash2 size={15} />
                    {t('library.batchDelete')} ({selectedDocumentIds.length})
                  </button>
                </div>
                <div className="tree-list">
                  {treeChildren.length === 0 ? <p className="muted">{t('library.noTree')}</p> : treeChildren.map((node) => renderTreeNode(node))}
                </div>
              </div>

              <div className="panel knowledge-detail-panel">
                <div className="section-heading compact split">
                  <span>{t('library.documentDetail')}</span>
                  {selectedDocument && (
                    <div className="row-actions">
                      <button className="icon-button" title={t('library.reindex')} onClick={() => handleReindexDocument(selectedDocument.id)}>
                        <RefreshCcw size={16} />
                      </button>
                      <button className="icon-button danger" title={t('library.deleteDocument')} onClick={() => handleDeleteDocument(selectedDocument.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
                {selectedDocument ? (
                  <div className="document-detail">
                    <strong>{selectedDocument.filename}</strong>
                    <span>
                      {t('library.chunks', { count: selectedDocument.chunk_count })} / {t('library.version')} {selectedDocument.version || 1} / {formatDate(selectedDocument.last_indexed_at || selectedDocument.created_at)}
                    </span>
                    <div className="document-meta-strip">
                      <span>{language === 'zh' ? `状态: ${documentStatusLabel(selectedDocument.status)}` : `Status: ${documentStatusLabel(selectedDocument.status)}`}</span>
                      <span>{language === 'zh' ? `大小: ${formatBytes(selectedDocument.size || 0)}` : `Size: ${formatBytes(selectedDocument.size || 0)}`}</span>
                      <span>{language === 'zh' ? `校验: ${(selectedDocument.checksum || '').slice(0, 12) || '-'}` : `Checksum: ${(selectedDocument.checksum || '').slice(0, 12) || '-'}`}</span>
                    </div>
                    <pre>{selectedDocument.preview}</pre>
                    {focusedChunks.length > 0 && (
                      <div className="focused-chunks">
                        <div className="section-heading compact">
                          <Sparkles size={16} />
                          <span>{language === 'zh' ? '引用定位上下文' : 'Citation context'}</span>
                        </div>
                        {focusedChunks.map((chunk) => (
                          <div className={`chunk-item ${chunk.id === selectedChunkId ? 'active' : ''}`} key={`focus-${chunk.id}`}>
                            <small>
                              #{chunk.chunk_index + 1} / {chunk.char_count} chars{chunk.section_path ? ` / ${chunk.section_path}` : ''}
                            </small>
                            <p>{chunk.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="chunk-list">
                      {selectedDocument.chunks.map((chunk) => (
                        <div
                          className={`chunk-item ${chunk.id === selectedChunkId ? 'active' : ''}`}
                          key={chunk.id}
                          data-chunk-id={chunk.id}
                          onClick={() => setSelectedChunkId(chunk.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedChunkId(chunk.id)
                            }
                          }}
                        >
                          <small>#{chunk.chunk_index + 1} / {chunk.char_count} chars{chunk.section_path ? ` / ${chunk.section_path}` : ''}</small>
                          <p>{chunk.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">{t('library.noDetail')}</p>
                )}
              </div>
            </div>

            <div className="panel knowledge-task-panel">
              <div className="section-heading compact">
                <ClipboardList size={16} />
                <span>{t('library.taskCenter')}</span>
              </div>
              <div className="import-job-list">
                {importJobs.length === 0 && <p className="muted">{t('library.importEmpty')}</p>}
                {importJobs.slice(0, 5).map((job) => (
                  <div className="import-job" key={job.id}>
                    <div>
                      <div className="import-job-heading">
                        <strong>{job.source_name || displayProjectName(job.project_name)}</strong>
                        <span className={`status-badge ${job.status}`}>{importStatusLabel(job.status)}</span>
                      </div>
                      <span>{formatDate(job.finished_at || job.started_at)} / {job.summary?.total_files || job.total_files} {language === 'zh' ? '个条目' : 'items'}</span>
                    </div>
                    <div className="import-job-progress" aria-hidden="true">
                      <span style={{ width: `${importCompletion(job)}%` }} />
                    </div>
                    <div className="import-job-stats">
                      <div>
                        <strong>{job.summary?.indexed_files ?? job.indexed_files}</strong>
                        <span>{language === 'zh' ? '新增' : 'Indexed'}</span>
                      </div>
                      <div>
                        <strong>{job.summary?.duplicate_files ?? 0}</strong>
                        <span>{language === 'zh' ? '重复' : 'Duplicate'}</span>
                      </div>
                      <div>
                        <strong>{(job.summary?.skipped_files ?? 0) + (job.summary?.failed_files ?? job.failed_files)}</strong>
                        <span>{language === 'zh' ? '异常' : 'Issues'}</span>
                      </div>
                      <div>
                        <strong>{job.summary?.indexed_chunks ?? 0}</strong>
                        <span>{language === 'zh' ? '新增切片' : 'Chunks added'}</span>
                      </div>
                    </div>
                    <div className="job-action-row">
                      <button className="chip" type="button" onClick={() => handleRetryImportJob(job.id)}>
                        <RefreshCcw size={13} />
                        {t('library.retry')}
                      </button>
                      <button
                        className="chip"
                        type="button"
                        onClick={() =>
                          setExpandedImportJobIds((current) => (current.includes(job.id) ? current.filter((id) => id !== job.id) : [...current, job.id]))
                        }
                      >
                        <ListTree size={13} />
                        {expandedImportJobIds.includes(job.id) ? (language === 'zh' ? '收起' : 'Collapse') : language === 'zh' ? '查看明细' : 'Details'}
                      </button>
                    </div>
                    {!!job.error && (
                      <div className="detail-note danger">
                        <span>{language === 'zh' ? '任务错误' : 'Task error'}</span>
                        <small>{job.error}</small>
                      </div>
                    )}
                    {expandedImportJobIds.includes(job.id) && (
                      <div className="import-job-detail">
                        <div className="job-detail-group">
                          <strong>{language === 'zh' ? '逐文件结果' : 'Per-file results'}</strong>
                          {renderImportResultList(job.results, language === 'zh' ? '当前任务没有明细。' : 'No detail is available for this task.')}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="knowledge-advanced-grid">
            <aside className="panel knowledge-rag-panel" data-tour="rag-settings">
              <form className="stacked-form" onSubmit={saveProjectSettings}>
                <div className="section-heading">
                  <Gauge size={17} />
                  <span>{t('library.ragSettings')}</span>
                </div>
                <label>
                  <span>{t('library.chunkSize')}</span>
                  <input type="number" min={300} max={6000} value={projectSettingsDraft.chunk_size} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, chunk_size: Number(event.target.value) })} />
                </label>
                <label>
                  <span>{t('library.chunkOverlap')}</span>
                  <input type="number" min={0} max={1200} value={projectSettingsDraft.chunk_overlap} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, chunk_overlap: Number(event.target.value) })} />
                </label>
                <label>
                  <span>{t('library.topK')}</span>
                  <input type="number" min={1} max={24} value={projectSettingsDraft.retrieval_top_k} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, retrieval_top_k: Number(event.target.value) })} />
                </label>
                <label>
                  <span>{t('library.mode')}</span>
                  <select value={projectSettingsDraft.retrieval_mode} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, retrieval_mode: event.target.value as RetrievalMode })}>
                    <option value="hybrid">{t('library.mode.hybrid')}</option>
                    <option value="vector">{t('library.mode.vector')}</option>
                    <option value="keyword">{t('library.mode.keyword')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('library.scope')}</span>
                  <select value={projectSettingsDraft.retrieval_scope} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, retrieval_scope: event.target.value as RetrievalScope })}>
                    <option value="focused">{t('library.scope.focused')}</option>
                    <option value="full_context">{t('library.scope.full')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('library.fullContextLimit')}</span>
                  <input type="number" min={5} max={80} value={projectSettingsDraft.full_context_limit} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, full_context_limit: Number(event.target.value) })} />
                </label>
                <label>
                  <span>{t('library.embeddingModel')}</span>
                  <select value={projectSettingsDraft.embedding_model_id ?? ''} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, embedding_model_id: event.target.value ? Number(event.target.value) : undefined })}>
                    <option value="">{t('model.localRag')}</option>
                    {models.filter((model) => model.model_type === 'embedding').map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelOptionLabel(model)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('library.rerankModel')}</span>
                  <select value={projectSettingsDraft.rerank_model_id ?? ''} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, rerank_model_id: event.target.value ? Number(event.target.value) : undefined })}>
                    <option value="">{t('model.localRag')}</option>
                    {models.filter((model) => model.model_type === 'rerank').map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelOptionLabel(model)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t('library.threshold')}</span>
                  <input type="number" min={0} max={1} step={0.01} value={projectSettingsDraft.similarity_threshold} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, similarity_threshold: Number(event.target.value) })} />
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={projectSettingsDraft.query_rewrite_enabled} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, query_rewrite_enabled: event.target.checked })} />
                  <span>{t('library.queryRewrite')}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={projectSettingsDraft.rerank_enabled} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, rerank_enabled: event.target.checked })} />
                  <span>{t('library.rerank')}</span>
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={projectSettingsDraft.agent_tools_enabled} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, agent_tools_enabled: event.target.checked })} />
                  <span>{t('library.agentTools')}</span>
                </label>
                <label>
                  <span>{t('library.metadataFilter')}</span>
                  <textarea value={projectSettingsDraft.metadata_filter_json} onChange={(event) => setProjectSettingsDraft({ ...projectSettingsDraft, metadata_filter_json: event.target.value })} rows={4} />
                </label>
                <button className="primary-button" type="submit">
                  <Check size={16} />
                  {t('common.save')}
                </button>
              </form>
            </aside>

            <div className="knowledge-advanced-side">
              <div className="panel debug-bench">
                <div className="section-heading compact">
                  <FlaskConical size={16} />
                  <span>{t('library.debugQuery')}</span>
                </div>
                <textarea value={ragDebugQuery} onChange={(event) => setRagDebugQuery(event.target.value)} placeholder={t('library.debugPlaceholder')} rows={3} />
                <button className="secondary-button full-width" onClick={() => runRagDebug()} disabled={!ragDebugQuery.trim() || isDebuggingRag}>
                  {isDebuggingRag ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                  {t('library.runDebug')}
                </button>
                <div className="debug-result-list">
                  {ragDebugResult?.items.map((item) => (
                    <button className="debug-result" key={item.chunk_id} onClick={() => openDocument(item.document_id, item.chunk_id)}>
                      <strong>{item.document_title}</strong>
                      <span>{item.filename} / score {Math.round(item.score * 100)}% / v {Math.round(item.vector_score * 100)}% / k {Math.round(item.keyword_score * 100)}%{item.rerank_score ? ` / r ${Math.round(item.rerank_score * 100)}%` : ''}</span>
                      <p>{item.snippet}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel knowledge-advanced-card">
                <div className="section-heading compact">
                  <Database size={16} />
                  <span>{language === 'zh' ? 'RAG 评测台' : 'RAG eval bench'}</span>
                </div>
                <div className="ingest-summary-metrics">
                  <div className="summary-metric">
                    <span>{language === 'zh' ? '测试问题' : 'Test cases'}</span>
                    <strong>{evalCases.length}</strong>
                  </div>
                  <div className="summary-metric">
                    <span>{language === 'zh' ? '最近运行' : 'Recent runs'}</span>
                    <strong>{evalRuns.length}</strong>
                  </div>
                </div>
                <p className="muted">
                  {language === 'zh'
                    ? '用固定问题验证改动后是否真的更准，而不是只看主观感觉。'
                    : 'Use fixed questions to validate retrieval quality after each change.'}
                </p>
                <button className="secondary-button" type="button" onClick={() => setActiveView('diagnostics')}>
                  <FlaskConical size={16} />
                  {language === 'zh' ? '打开调试与评测' : 'Open debug and eval'}
                </button>
              </div>

              <div className="panel knowledge-advanced-card">
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
            </div>
          </div>
        )}

        {!isProfessionalMode && (
          <div className="panel knowledge-simple-guide">
            <div className="section-heading">
              <Gauge size={17} />
              <span>{t('library.openAdvancedGuide')}</span>
            </div>
            <p>{t('library.openAdvancedGuideBody')}</p>
            <button className="secondary-button" type="button" onClick={() => setProfessionalMode(true)}>
              <Sparkles size={16} />
              {t('library.switchToProfessional')}
            </button>
          </div>
        )}
      </section>
    )
  }

  function renderModels() {
    const activeModelTab = isProfessionalMode ? modelTab : 'config'
    const knownPlatformBaseUrls = modelPlatforms
      .filter((platform) => platform.id !== 'compatible')
      .map((platform) => normalizeApiBase(platform.base_url))
      .filter(Boolean)
    const activePlatformModels = models.filter((model) => {
      if (activePlatform.id === 'compatible') {
        return model.provider === 'openai_compatible' && !knownPlatformBaseUrls.includes(normalizeApiBase(model.base_url))
      }
      return model.provider === activePlatform.provider && normalizeApiBase(model.base_url) === normalizeApiBase(activePlatform.base_url)
    })
    const sortModelList = (items: ModelConfig[]) =>
      [...items].sort((left, right) => {
        if (configuredModelSort === 'name') {
          return displayModelName(left.name).localeCompare(displayModelName(right.name), language === 'zh' ? 'zh-CN' : 'en-US')
        }
        if (configuredModelSort === 'latency') {
          const leftOk = left.last_test_status === 'ok'
          const rightOk = right.last_test_status === 'ok'
          if (leftOk !== rightOk) return leftOk ? -1 : 1
          return Number(left.last_test_latency_ms || 999999) - Number(right.last_test_latency_ms || 999999)
        }
        if (left.is_default !== right.is_default) return left.is_default ? -1 : 1
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
        if (left.model_type !== right.model_type) return left.model_type === 'chat' ? -1 : 1
        return displayModelName(left.name).localeCompare(displayModelName(right.name), language === 'zh' ? 'zh-CN' : 'en-US')
      })
    const sortedActivePlatformModels = sortModelList(activePlatformModels)
    const modelGroups = Object.values(
      sortedActivePlatformModels.reduce<Record<string, { provider: ModelProvider; baseUrl: string; items: ModelConfig[] }>>((groups, model) => {
        const baseUrl = model.base_url || t('status.local')
        const key = `${model.provider}:${baseUrl}`
        if (!groups[key]) groups[key] = { provider: model.provider, baseUrl, items: [] }
        groups[key].items.push(model)
        return groups
      }, {}),
    )
    const enabledPlatformModels = sortedActivePlatformModels.filter((model) => model.enabled)
    const enabledPlatformChatModels = enabledPlatformModels.filter((model) => model.model_type === 'chat')
    const defaultPlatformModel = sortedActivePlatformModels.find((model) => model.is_default)
    const lastHealthyPlatformModel = sortedActivePlatformModels.find((model) => model.last_test_status === 'ok')

    return (
      <section className="models-page">
        <div className="model-page-title">
          <div>
            <h2>{t('models.title')}</h2>
            <p>{t('models.subtitle')}</p>
          </div>
          <div className="model-title-actions">
            {isProfessionalMode ? (
              <>
                <div className="segmented-control" aria-label={t('nav.models')}>
                  <button className={activeModelTab === 'config' ? 'active' : ''} onClick={() => setModelTab('config')}>
                    {t('models.tab.config')}
                  </button>
                  <button className={activeModelTab === 'presets' ? 'active' : ''} onClick={() => setModelTab('presets')}>
                    {language === 'zh' ? '预设包' : 'Presets'}
                  </button>
                  <button className={activeModelTab === 'usage' ? 'active' : ''} onClick={() => setModelTab('usage')}>
                    {t('models.tab.usage')}
                  </button>
                </div>
                <span>{t('models.selectedCount', { count: selectedDiscoveryIds.length })}</span>
              </>
            ) : (
              <span>{t('settings.simpleMode')}</span>
            )}
          </div>
        </div>

        {activeModelTab === 'usage' ? (
          renderModelUsage()
        ) : activeModelTab === 'presets' ? (
          renderModelPresets()
        ) : (
          <>
          <section className="model-flow-strip" aria-label="Model setup flow">
            <div className="model-flow-step active">
              <span>1</span>
              <div>
                <strong>{language === 'zh' ? '选择平台' : 'Choose platform'}</strong>
                <small>{language === 'zh' ? '先确定来源平台或本地 Ollama。' : 'Pick a provider or local Ollama first.'}</small>
              </div>
            </div>
            <div className="model-flow-step">
              <span>2</span>
              <div>
                <strong>{language === 'zh' ? '拉取模型' : 'Fetch models'}</strong>
                <small>{language === 'zh' ? '根据 Base URL 直接读取可用模型列表。' : 'Fetch available models directly from the Base URL.'}</small>
              </div>
            </div>
            <div className="model-flow-step">
              <span>3</span>
              <div>
                <strong>{language === 'zh' ? '加入对话切换器' : 'Add to switcher'}</strong>
                <small>{language === 'zh' ? '勾选后，这些模型会出现在问答输入框里。' : 'Checked models will appear in the chat switcher.'}</small>
              </div>
            </div>
          </section>
          <section className="model-platform-panel top-platforms" data-tour="model-platforms">
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
          </section>

        <div className="model-workbench">

          <section className="model-builder-panel">
            <div className="model-connection-bar">
              <div className="section-heading">
                <Settings2 size={17} />
                <span>{t('models.connection')}</span>
              </div>
              <div className="model-active-platform">
                <div className="model-active-platform-copy">
                  <strong>{activePlatform.name}</strong>
                  <span>{providerLabel(activePlatform.provider)}</span>
                </div>
                <div className="model-active-platform-note">
                  {language === 'zh' ? '平台选好以后，只需要填写地址和密钥即可。' : 'Once the platform is chosen, fill in the endpoint and key.'}
                </div>
              </div>
              <div className="model-form-grid">
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
                {isProfessionalMode && (
                  <>
                    <label>
                      <span>{t('models.modelType')}</span>
                      <select value={modelForm.model_type} onChange={(event) => setModelForm({ ...modelForm, model_type: event.target.value as ModelType })}>
                        <option value="chat">{t('models.type.chat')}</option>
                        <option value="embedding">{t('models.type.embedding')}</option>
                        <option value="rerank">{t('models.type.rerank')}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t('models.contextWindow')}</span>
                      <input type="number" min={0} value={modelForm.context_window} onChange={(event) => setModelForm({ ...modelForm, context_window: Number(event.target.value) })} />
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={modelForm.supports_tools} onChange={(event) => setModelForm({ ...modelForm, supports_tools: event.target.checked })} />
                      <span>{t('models.supportsTools')}</span>
                    </label>
                    <label className="toggle-row">
                      <input type="checkbox" checked={modelForm.supports_vision} onChange={(event) => setModelForm({ ...modelForm, supports_vision: event.target.checked })} />
                      <span>{t('models.supportsVision')}</span>
                    </label>
                  </>
                )}
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
                <small>{language === 'zh' ? `已勾选 ${selectedDiscoveryIds.length} / ${discoveredModels.length}` : `${selectedDiscoveryIds.length} selected / ${discoveredModels.length}`}</small>
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
              <div className="model-discovery-hint">
                {language === 'zh'
                  ? '勾选你真正会在问答中切换的模型，保持列表精简。'
                  : 'Only pick the models you actually want in the chat switcher.'}
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
            <div className="model-configured-summary">
              <div className="model-summary-card">
                <span>{language === 'zh' ? '已拉取可选' : 'Discovered'}</span>
                <strong>{discoveredModels.length}</strong>
              </div>
              <div className="model-summary-card">
                <span>{language === 'zh' ? '已加入平台' : 'Added on platform'}</span>
                <strong>{activePlatformModels.length}</strong>
              </div>
              <div className="model-summary-card">
                <span>{language === 'zh' ? '聊天切换器' : 'In chat switcher'}</span>
                <strong>{enabledPlatformChatModels.length}</strong>
              </div>
              <div className="model-summary-card">
                <span>{language === 'zh' ? '默认启动' : 'Default'}</span>
                <strong>{defaultPlatformModel ? displayModelName(defaultPlatformModel.name) : '-'}</strong>
              </div>
            </div>
            <div className="switcher-overview-panel">
              <div className="section-heading split">
                <span>{language === 'zh' ? '已启用聊天切换器' : 'Enabled in chat switcher'}</span>
                <small>{enabledPlatformChatModels.length || 0}</small>
              </div>
              <div className="switcher-chip-list">
                {enabledPlatformChatModels.length === 0 ? (
                  <p className="muted">{language === 'zh' ? '这个平台还没有加入聊天切换器的模型。' : 'No chat-switcher model has been enabled on this platform yet.'}</p>
                ) : (
                  enabledPlatformChatModels.map((model) => (
                    <button key={`switcher-${model.id}`} type="button" className={selectedModel?.id === model.id ? 'switcher-model-chip active' : 'switcher-model-chip'} onClick={() => handleSelectChatModel(model.id)}>
                      <strong>{displayModelName(model.name)}</strong>
                      <span>{model.is_default ? (language === 'zh' ? '默认' : 'Default') : providerLabel(model.provider)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="section-heading split">
              <span>{t('models.configuredForPlatform')}</span>
              <div className="model-section-tools">
                <small>{t('models.endpointCount', { count: activePlatformModels.length })}</small>
                <select value={configuredModelSort} onChange={(event) => setConfiguredModelSort(event.target.value as 'default' | 'name' | 'latency')}>
                  <option value="default">{language === 'zh' ? '默认排序' : 'Default sort'}</option>
                  <option value="name">{language === 'zh' ? '按名称' : 'By name'}</option>
                  <option value="latency">{language === 'zh' ? '按测试状态' : 'By test status'}</option>
                </select>
              </div>
            </div>
            <div className="configured-panel-note">
              {language === 'zh'
                ? `右侧这一列就是聊天页模型切换器的来源。${lastHealthyPlatformModel ? ` 最近一次测试通过：${displayModelName(lastHealthyPlatformModel.name)}` : ' 还没有测试通过记录。'}`
                : `This panel is the source of truth for the chat switcher.${lastHealthyPlatformModel ? ` Last healthy test: ${displayModelName(lastHealthyPlatformModel.name)}.` : ' No healthy test recorded yet.'}`}
            </div>
            <div className="configured-models">
              {modelGroups.length === 0 && <p className="muted">{t('models.emptyConfiguredForPlatform')}</p>}
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
                            <select value={draft.model_type} onChange={(event) => updateModelDraft(model.id, { model_type: event.target.value as ModelType })}>
                              <option value="chat">{t('models.type.chat')}</option>
                              <option value="embedding">{t('models.type.embedding')}</option>
                              <option value="rerank">{t('models.type.rerank')}</option>
                            </select>
                            <input type="number" value={draft.context_window} onChange={(event) => updateModelDraft(model.id, { context_window: Number(event.target.value) })} placeholder={t('models.contextWindow')} />
                            <label className="toggle-row compact-toggle">
                              <input type="checkbox" checked={draft.supports_tools} onChange={(event) => updateModelDraft(model.id, { supports_tools: event.target.checked })} />
                              <span>{t('models.supportsTools')}</span>
                            </label>
                            <label className="toggle-row compact-toggle">
                              <input type="checkbox" checked={draft.supports_vision} onChange={(event) => updateModelDraft(model.id, { supports_vision: event.target.checked })} />
                              <span>{t('models.supportsVision')}</span>
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
                          <div className="model-row-header">
                            <strong>{displayModelName(model.name)}</strong>
                            <span>{modelOptionLabel(model)}</span>
                          </div>
                          <div className="model-row-badges">
                            <span className={model.api_key_set ? 'key-state active' : 'key-state'}>{model.api_key_set ? t('models.keySet') : t('models.keyMissing')}</span>
                            <span className={model.enabled ? 'chip active static-chip' : 'chip static-chip'}>{model.enabled ? t('common.enabled') : t('common.disabled')}</span>
                            {model.is_default && (
                              <span className="chip active static-chip">
                                <Check size={13} />
                                {t('common.default')}
                              </span>
                            )}
                          </div>
                          <small>
                            {t(`models.type.${model.model_type}`)} / {model.context_window ? `${model.context_window.toLocaleString()} ctx / ` : ''}{model.supports_tools ? t('models.supportsTools') : ''}{model.supports_tools && model.supports_vision ? ' / ' : ''}{model.supports_vision ? t('models.supportsVision') : ''}{!model.supports_tools && !model.supports_vision ? model.base_url || t('status.local') : ''}
                          </small>
                          <small>
                            {t('models.lastTest')}: {model.last_test_status === 'ok' ? `OK ${model.last_test_latency_ms || 0}ms` : model.last_test_status === 'failed' ? model.last_test_error || 'failed' : 'untested'}
                          </small>
                        </div>
                        <div className="row-actions model-row-actions">
                          <div className="model-row-toggles">
                            <button className={model.enabled ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { enabled: !model.enabled })}>
                              {model.enabled ? t('common.enabled') : t('common.disabled')}
                            </button>
                            <button className={model.is_default ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { is_default: true, enabled: true })}>
                              <Check size={14} />
                              {t('common.default')}
                            </button>
                          </div>
                          <div className="model-row-tools">
                            <button className="icon-button" type="button" title={testingModelId === model.id ? t('common.testing') : t('common.test')} onClick={() => testModel(model.id)} disabled={testingModelId === model.id}>
                            {testingModelId === model.id ? <Loader2 size={14} className="spin" /> : <Wifi size={14} />}
                            </button>
                            <button className="icon-button" type="button" title={t('models.edit')} onClick={() => startEditModel(model)}>
                              <Pencil size={16} />
                            </button>
                            <button className="icon-button danger" type="button" title={t('models.delete')} onClick={() => deleteModel(model.id)}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        </div>
          </>
        )}
      </section>
    )
  }

  function renderModelUsage() {
    const summarizeUsage = (items: ModelUsage[]) =>
      items.reduce(
        (summary, item) => ({
          calls: summary.calls + 1,
          input: summary.input + Number(item.input_tokens || 0),
          output: summary.output + Number(item.output_tokens || 0),
          total: summary.total + Number(item.total_tokens || 0),
          cost: summary.cost + Number(item.estimated_cost || 0),
        }),
        { calls: 0, input: 0, output: 0, total: 0, cost: 0 },
      )
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(todayStart)
    weekStart.setDate(todayStart.getDate() - 6)
    const currency = modelUsage.find((item) => item.currency)?.currency || 'USD'
    const totalSummary = summarizeUsage(modelUsage)
    const todayUsage = modelUsage.filter((item) => new Date(item.created_at).getTime() >= todayStart.getTime())
    const weekUsage = modelUsage.filter((item) => new Date(item.created_at).getTime() >= weekStart.getTime())
    const todaySummary = summarizeUsage(todayUsage)
    const weekSummary = summarizeUsage(weekUsage)
    const budgetValue = Number(usageBudgetInput)
    const hasBudget = Number.isFinite(budgetValue) && budgetValue > 0
    const budgetExceeded = hasBudget && weekSummary.cost > budgetValue
    const budgetNearLimit = hasBudget && !budgetExceeded && weekSummary.cost >= budgetValue * 0.8
    const conversationUsage = Object.values(
      modelUsage.reduce<
        Record<
          string,
          {
            conversation_id: number
            conversation_title?: string
            project_name?: string
            preset_name?: string
            model_name?: string
            call_count: number
            total_tokens: number
            estimated_cost: number
            last_used_at: string
          }
        >
      >((groups, item) => {
        const key = String(item.conversation_id || item.id)
        if (!groups[key]) {
          groups[key] = {
            conversation_id: item.conversation_id,
            conversation_title: item.conversation_title,
            project_name: item.project_name,
            preset_name: item.preset_name,
            model_name: item.model_name || item.model,
            call_count: 0,
            total_tokens: 0,
            estimated_cost: 0,
            last_used_at: item.created_at,
          }
        }
        groups[key].call_count += 1
        groups[key].total_tokens += Number(item.total_tokens || 0)
        groups[key].estimated_cost += Number(item.estimated_cost || 0)
        if (new Date(item.created_at).getTime() > new Date(groups[key].last_used_at).getTime()) {
          groups[key].last_used_at = item.created_at
          groups[key].model_name = item.model_name || item.model
          groups[key].preset_name = item.preset_name
        }
        return groups
      }, {}),
    ).sort((left, right) => Number(right.estimated_cost || 0) - Number(left.estimated_cost || 0))
    const expensiveCalls = [...modelUsage]
      .sort((left, right) => Number(right.estimated_cost || 0) - Number(left.estimated_cost || 0))
      .slice(0, 8)

    return (
      <section className="usage-page">
        <div className="usage-hero">
          <div>
            <h3>{t('models.usageTitle')}</h3>
            <p>{t('models.usageSubtitle')}</p>
          </div>
          <div className="usage-hero-actions">
            <label className="usage-budget-input">
              <span>{language === 'zh' ? '本周预算' : 'Weekly budget'}</span>
              <input type="number" min="0" step="0.1" value={usageBudgetInput} onChange={(event) => setUsageBudgetInput(event.target.value)} placeholder="0" />
            </label>
            <p className="muted">{t('models.usageCostNote')}</p>
          </div>
        </div>

        <div className="usage-summary usage-summary-rich">
          <div className="metric">
            <span>{language === 'zh' ? '总调用' : 'All calls'}</span>
            <strong>{totalSummary.calls}</strong>
            <small>{formatCost(totalSummary.cost, currency)}</small>
          </div>
          <div className="metric">
            <span>{language === 'zh' ? '今日' : 'Today'}</span>
            <strong>{formatCost(todaySummary.cost, currency)}</strong>
            <small>{todaySummary.calls} {language === 'zh' ? '次调用' : 'calls'} / {todaySummary.total.toLocaleString()} token</small>
          </div>
          <div className="metric">
            <span>{language === 'zh' ? '本周' : 'This week'}</span>
            <strong>{formatCost(weekSummary.cost, currency)}</strong>
            <small>{weekSummary.calls} {language === 'zh' ? '次调用' : 'calls'} / {weekSummary.total.toLocaleString()} token</small>
          </div>
          <div className={`metric budget-metric ${budgetExceeded ? 'danger' : budgetNearLimit ? 'warning' : ''}`}>
            <span>{language === 'zh' ? '预算提醒' : 'Budget watch'}</span>
            <strong>{hasBudget ? formatCost(Math.max(budgetValue - weekSummary.cost, 0), currency) : language === 'zh' ? '未设置' : 'Not set'}</strong>
            <small>
              {hasBudget
                ? budgetExceeded
                  ? language === 'zh'
                    ? '本周成本已超过预算'
                    : 'This week has exceeded budget'
                  : budgetNearLimit
                    ? language === 'zh'
                      ? '本周成本接近预算上限'
                      : 'This week is close to the limit'
                    : language === 'zh'
                      ? '本周成本仍在预算范围内'
                      : 'This week is still within budget'
                : language === 'zh'
                  ? '填一个金额后，这里会自动提醒你'
                  : 'Add a value to enable budget alerts'}
            </small>
          </div>
        </div>

        <div className="usage-grid usage-grid-rich">
          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '按模型统计' : 'By model'}</span>
              <small>{t('models.endpointCount', { count: usageTotals.length })}</small>
            </div>
            <div className="table-list usage-records">
              {usageTotals.length === 0 && <p className="muted">{t('models.usageEmpty')}</p>}
              {usageTotals.map((total) => (
                <div className="table-row usage-row" key={`${total.provider}-${total.model}-${total.model_preset_id || 0}`}>
                  <div>
                    <strong>{providerLabel(total.provider)} / {total.model}</strong>
                    <span>
                      {total.preset_name ? `${total.preset_name} / ` : ''}{t('models.usageCalls')}: {Number(total.call_count || 0).toLocaleString()} / {t('models.usageTotal')}: {Number(total.total_tokens || 0).toLocaleString()}
                    </span>
                  </div>
                  <small>{formatCost(Number(total.estimated_cost || 0), currency)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '按会话统计' : 'By conversation'}</span>
              <small>{conversationUsage.length}</small>
            </div>
            <div className="table-list usage-records">
              {conversationUsage.length === 0 && <p className="muted">{t('models.usageEmpty')}</p>}
              {conversationUsage.map((item) => (
                <div className="table-row usage-row" key={`conversation-usage-${item.conversation_id}`}>
                  <div>
                    <strong>{displayRecoverableText(item.conversation_title, language, t('chat.newThread'))}</strong>
                    <span>
                      {displayProjectName(item.project_name, 'project.all')}
                      {item.preset_name ? ` / ${item.preset_name}` : ''}
                      {item.model_name ? ` / ${item.model_name}` : ''}
                    </span>
                    <small>
                      {t('models.usageCalls')}: {item.call_count} / {t('models.usageTotal')}: {item.total_tokens.toLocaleString()}
                    </small>
                  </div>
                  <small>{formatCost(item.estimated_cost, currency)} / {formatDate(item.last_used_at)}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="usage-grid usage-grid-rich">
          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '单次回答成本排行' : 'Most expensive calls'}</span>
              <small>{expensiveCalls.length}</small>
            </div>
            <div className="table-list usage-records">
              {expensiveCalls.length === 0 && <p className="muted">{t('models.usageEmpty')}</p>}
              {expensiveCalls.map((item) => (
                <div className="table-row usage-row" key={`usage-top-${item.id}`}>
                  <div>
                    <strong>{item.model_name || item.model}</strong>
                    <span>
                      {displayRecoverableText(item.conversation_title, language, t('chat.newThread'))}
                      {item.project_name ? ` / ${displayProjectName(item.project_name, 'project.all')}` : ''}
                    </span>
                    <small>
                      {t('models.usageInput')}: {Number(item.input_tokens || 0).toLocaleString()} / {t('models.usageOutput')}: {Number(item.output_tokens || 0).toLocaleString()}
                    </small>
                  </div>
                  <small>{formatCost(Number(item.estimated_cost || 0), item.currency)} / {formatDate(item.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '调用明细' : 'Call records'}</span>
              <small>{t('models.usageLastUsed')}</small>
            </div>
            <div className="table-list usage-records">
              {modelUsage.length === 0 && <p className="muted">{t('models.usageEmpty')}</p>}
              {modelUsage.map((item) => (
                <div className="table-row usage-row" key={item.id}>
                  <div>
                    <strong>{item.model_name || item.model}</strong>
                    <span>
                      {displayProjectName(item.project_name, 'project.all')} / {displayRecoverableText(item.conversation_title, language, t('chat.newThread'))}{item.preset_name ? ` / ${item.preset_name}` : ''}
                    </span>
                    <small>
                      {t('models.usageInput')}: {Number(item.input_tokens || 0).toLocaleString()} / {t('models.usageOutput')}: {Number(item.output_tokens || 0).toLocaleString()} / {t('models.usageCost')}: {formatCost(Number(item.estimated_cost || 0), item.currency)}
                    </small>
                  </div>
                  <small>{formatDate(item.created_at)}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderModelPresets() {
    return (
      <section className="usage-page">
        <div className="usage-hero">
          <div>
            <h3>{language === 'zh' ? '模型预设' : 'Model presets'}</h3>
            <p>{language === 'zh' ? '把模型、系统提示词、知识库和检索参数打包成可复用的对话模板。' : 'Package model, system prompt, project, and retrieval settings into reusable chat presets.'}</p>
          </div>
        </div>

        <div className="diagnostics-grid eval-grid">
          <form className="panel stacked-form" onSubmit={handleSavePreset}>
            <div className="section-heading">
              <Sparkles size={17} />
              <span>{language === 'zh' ? '新建预设' : 'Create preset'}</span>
            </div>
            <input value={presetDraft.name} onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })} placeholder={language === 'zh' ? '预设名称' : 'Preset name'} />
            <input value={presetDraft.description} onChange={(event) => setPresetDraft({ ...presetDraft, description: event.target.value })} placeholder={language === 'zh' ? '预设说明' : 'Description'} />
            <select value={presetDraft.project_id ?? ''} onChange={(event) => setPresetDraft({ ...presetDraft, project_id: event.target.value ? Number(event.target.value) : undefined })}>
              <option value="">{t('project.all')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {displayProjectName(project.name)}
                </option>
              ))}
            </select>
            <select value={presetDraft.model_id ?? ''} onChange={(event) => setPresetDraft({ ...presetDraft, model_id: event.target.value ? Number(event.target.value) : undefined })}>
              <option value="">{t('chat.noModel')}</option>
              {chatModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelOptionLabel(model)}
                </option>
              ))}
            </select>
            <textarea value={presetDraft.system_prompt} onChange={(event) => setPresetDraft({ ...presetDraft, system_prompt: event.target.value })} placeholder={language === 'zh' ? '系统提示词' : 'System prompt'} rows={4} />
            <div className="form-grid two-columns">
              <label>
                <span>{language === 'zh' ? '检索模式' : 'Retrieval mode'}</span>
                <select value={presetDraft.retrieval_mode} onChange={(event) => setPresetDraft({ ...presetDraft, retrieval_mode: event.target.value as RetrievalMode })}>
                  <option value="hybrid">Hybrid</option>
                  <option value="vector">Vector</option>
                  <option value="keyword">Keyword</option>
                </select>
              </label>
              <label>
                <span>{language === 'zh' ? '上下文范围' : 'Context scope'}</span>
                <select value={presetDraft.retrieval_scope} onChange={(event) => setPresetDraft({ ...presetDraft, retrieval_scope: event.target.value as RetrievalScope })}>
                  <option value="focused">Focused</option>
                  <option value="full_context">Full context</option>
                </select>
              </label>
              <label>
                <span>Top K</span>
                <input type="number" min={1} max={24} value={presetDraft.top_k} onChange={(event) => setPresetDraft({ ...presetDraft, top_k: Number(event.target.value) })} />
              </label>
              <label>
                <span>{t('models.temperature')}</span>
                <input type="number" min={0} max={2} step={0.1} value={presetDraft.temperature} onChange={(event) => setPresetDraft({ ...presetDraft, temperature: Number(event.target.value) })} />
              </label>
            </div>
            <textarea value={presetDraft.metadata_filter_json} onChange={(event) => setPresetDraft({ ...presetDraft, metadata_filter_json: event.target.value })} placeholder="Metadata filter JSON" rows={3} />
            <textarea value={presetDraft.tools_json} onChange={(event) => setPresetDraft({ ...presetDraft, tools_json: event.target.value })} placeholder='["search","rag"]' rows={2} />
            <label className="toggle-row">
              <input type="checkbox" checked={presetDraft.use_query_rewrite} onChange={(event) => setPresetDraft({ ...presetDraft, use_query_rewrite: event.target.checked })} />
              <span>{t('library.queryRewrite')}</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={presetDraft.use_rerank} onChange={(event) => setPresetDraft({ ...presetDraft, use_rerank: event.target.checked })} />
              <span>{t('library.rerank')}</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={presetDraft.is_default} onChange={(event) => setPresetDraft({ ...presetDraft, is_default: event.target.checked })} />
              <span>{t('common.default')}</span>
            </label>
            <button className="primary-button" type="submit">
              <Plus size={16} />
              {language === 'zh' ? '保存预设' : 'Save preset'}
            </button>
          </form>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '已有预设' : 'Saved presets'}</span>
              <small>{modelPresets.length}</small>
            </div>
            <div className="table-list usage-records">
              {modelPresets.length === 0 && <p className="muted">{language === 'zh' ? '还没有预设。' : 'No presets yet.'}</p>}
              {modelPresets.map((preset) => (
                <div className="table-row usage-row" key={preset.id}>
                  <div>
                    <strong>{preset.name}</strong>
                    <span>
                      {preset.model_name || t('chat.noModel')} / {displayProjectName(preset.project_name, 'project.all')}
                    </span>
                    <small>
                      {preset.retrieval_mode} / {preset.retrieval_scope} / top {preset.top_k}
                    </small>
                  </div>
                  <div className="row-actions">
                    <button className={selectedPreset?.id === preset.id ? 'chip active' : 'chip'} onClick={() => void handleApplyPreset(preset)}>
                      {selectedPreset?.id === preset.id ? t('common.enabled') : language === 'zh' ? '应用' : 'Apply'}
                    </button>
                    <button className="icon-button danger" type="button" title={t('models.delete')} onClick={() => void deletePreset(preset.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderDiagnostics() {
    return (
      <section className="diagnostics-page">
        <div className="usage-hero">
          <div>
            <h3>{t('diagnostics.title')}</h3>
            <p>{t('diagnostics.subtitle')}</p>
          </div>
          <div className="button-row">
            <button className="secondary-button" onClick={() => handleRunEval()} disabled={isRunningEval || !evalCases.length}>
              {isRunningEval ? <Loader2 size={16} className="spin" /> : <FlaskConical size={16} />}
              {t('eval.run')}
            </button>
            <button className="secondary-button" onClick={() => refreshAll()}>
              <RefreshCcw size={16} />
              {t('common.refresh')}
            </button>
          </div>
        </div>

        <div className="diagnostics-grid">
          <div className="panel">
            <div className="section-heading">
              <FlaskConical size={17} />
              <span>{t('library.debugQuery')}</span>
            </div>
            <textarea value={ragDebugQuery} onChange={(event) => setRagDebugQuery(event.target.value)} placeholder={t('library.debugPlaceholder')} rows={4} />
            <button className="primary-button full-width" onClick={() => runRagDebug()} disabled={!ragDebugQuery.trim() || isDebuggingRag}>
              {isDebuggingRag ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
              {t('library.runDebug')}
            </button>
            <div className="debug-result-list">
              {ragDebugResult?.items.map((item) => (
                <button className="debug-result" key={item.chunk_id} onClick={() => openDocument(item.document_id, item.chunk_id)}>
                  <strong>{item.document_title}</strong>
                  <span>{item.filename} / score {Math.round(item.score * 100)}%</span>
                  <p>{item.snippet}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{t('diagnostics.logs')}</span>
              <small>{ragLogs.length}</small>
            </div>
            <div className="table-list">
              {ragLogs.length === 0 && <p className="muted">{t('diagnostics.empty')}</p>}
              {ragLogs.map((log) => (
                <div className="table-row diagnostic-log" key={log.id}>
                  <div>
                    <strong>{displayRecoverableText(log.query, language, language === 'zh' ? '历史查询已损坏' : 'Historical query unavailable')}</strong>
                    <span>
                      {log.retrieval_mode} / top {log.top_k} / hits {log.retrieved_count} / retrieve {log.retrieval_ms}ms / model {log.generation_ms}ms
                    </span>
                    <small>{log.model_name || '-'} / {formatDate(log.created_at)}</small>
                  </div>
                  {!!log.citations.length && (
                    <button className="secondary-button" onClick={() => openDocument(log.citations[0].document_id, log.citations[0].chunk_id)}>
                      <ListTree size={15} />
                      {t('common.view')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="diagnostics-grid eval-grid">
          <form className="panel stacked-form" onSubmit={handleCreateEvalCase}>
            <div className="section-heading">
              <ClipboardList size={17} />
              <span>{t('eval.newCase')}</span>
            </div>
            <textarea value={newEvalCase.question} onChange={(event) => setNewEvalCase({ ...newEvalCase, question: event.target.value })} placeholder={t('library.debugPlaceholder')} rows={3} />
            <textarea value={newEvalCase.expected_answer} onChange={(event) => setNewEvalCase({ ...newEvalCase, expected_answer: event.target.value })} placeholder={t('eval.expectedAnswer')} rows={3} />
            <input value={newEvalCase.expected_document} onChange={(event) => setNewEvalCase({ ...newEvalCase, expected_document: event.target.value })} placeholder={t('eval.expectedDocument')} />
            <input value={newEvalCase.tags} onChange={(event) => setNewEvalCase({ ...newEvalCase, tags: event.target.value })} placeholder={t('eval.tags')} />
            <button className="primary-button" type="submit">
              <Plus size={16} />
              {t('eval.newCase')}
            </button>
          </form>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{t('eval.cases')}</span>
              <small>{evalCases.length}</small>
            </div>
            <div className="table-list">
              {evalCases.length === 0 && <p className="muted">{t('eval.empty')}</p>}
              {evalCases.map((item) => (
                <div className="table-row diagnostic-log" key={item.id}>
                  <div>
                    <strong>{item.question}</strong>
                    <span>{item.expected_document || item.tags || '-'}</span>
                  </div>
                  <div className="row-actions">
                    <button className="secondary-button" type="button" onClick={() => handleRunEval([item.id])} disabled={isRunningEval}>
                      <FlaskConical size={15} />
                      {t('eval.run')}
                    </button>
                    <button className="icon-button danger" type="button" onClick={async () => { await api.deleteEvalCase(item.id); await refreshAll() }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{t('eval.runs')}</span>
              <small>{evalRuns.length}</small>
            </div>
            <div className="table-list">
              {evalRuns.map((run) => (
                <div className="table-row diagnostic-log" key={run.id}>
                  <div>
                    <strong>{run.question}</strong>
                    <span>
                      retrieval {Math.round(run.retrieval_score * 100)}% / answer {Math.round(run.answer_score * 100)}% / {run.latency_ms}ms
                    </span>
                    <small>{run.model_name || '-'} / {formatDate(run.created_at)}</small>
                  </div>
                  {!!run.citations.length && (
                    <button className="secondary-button" type="button" onClick={() => openDocument(run.citations[0].document_id, run.citations[0].chunk_id)}>
                      <ListTree size={15} />
                      {t('common.view')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderServer() {
    const totalDataSize = Number(adminHealth?.db_size || 0) + Number(adminHealth?.uploads_size || 0)
    const lastBackupEvent =
      adminHealth?.recent_events.find((event) => /backup|restore|备份|恢复/i.test(`${event.area} ${event.message}`)) ?? adminHealth?.recent_events[0]
    const activeProfile = serverProfiles.find((profile) => profile.id === selectedServerProfileId)
    const compatibilityLabel =
      connectionState === 'online' && adminHealth?.status === 'ok'
        ? language === 'zh'
          ? '接口兼容正常'
          : 'API compatibility looks good'
        : language === 'zh'
          ? '等待健康检查'
          : 'Waiting for health check'

    return (
      <section className="server-page">
        <div className="server-hero server-hero-ops">
          <div>
            <div className="eyebrow">
              <Wifi size={15} />
              {t('server.eyebrow')}
            </div>
            <h2>{t('server.title')}</h2>
            <p>{t('server.body')}</p>
          </div>
          <div className="server-hero-metrics">
            <div className="server-hero-card">
              <span>{language === 'zh' ? '当前连接' : 'Current mode'}</span>
              <strong>{activeApiBase ? t('server.remoteMode') : t('server.localMode')}</strong>
            </div>
            <div className="server-hero-card">
              <span>{language === 'zh' ? '最近检查' : 'Last check'}</span>
              <strong>{activeProfile?.last_checked_at ? formatDate(activeProfile.last_checked_at) : '-'}</strong>
            </div>
            <div className="server-hero-card">
              <span>{language === 'zh' ? '数据目录占用' : 'Data footprint'}</span>
              <strong>{formatBytes(totalDataSize)}</strong>
            </div>
            <div className="server-hero-card">
              <span>{language === 'zh' ? '向量后端' : 'Vector backend'}</span>
              <strong>{adminHealth?.vector_backend || 'sqlite'}</strong>
            </div>
          </div>
        </div>

        <div className="server-profile-strip">
          {serverProfiles.map((profile) => (
            <button key={profile.id} type="button" className={profile.id === selectedServerProfileId ? 'server-profile-chip active' : 'server-profile-chip'} onClick={() => handleSelectServerProfile(profile.id)}>
              <strong>{profile.name}</strong>
              <span>
                {profile.base_url ? profile.base_url : language === 'zh' ? '尚未配置' : 'Not configured'}
              </span>
            </button>
          ))}
        </div>

        <div className="two-column-page flush server-ops-grid">
          <form className="panel stacked-form server-config-panel" onSubmit={handleSaveServer}>
            <div className="section-heading">
              <Server size={17} />
              <span>{language === 'zh' ? '连接配置档案' : 'Connection profile'}</span>
            </div>
            <div className="server-profile-active">
              <strong>{activeProfile?.name || (language === 'zh' ? '当前配置' : 'Current profile')}</strong>
              <span>{activeProfile?.last_status === 'offline' ? t('status.offline') : activeProfile?.last_status === 'online' ? t('status.online') : t('status.checking')}</span>
            </div>
            <input value={apiBaseInput} onChange={(event) => setApiBaseInput(event.target.value)} placeholder={t('server.placeholder')} />
            <input type="password" value={apiTokenInput} onChange={(event) => setApiTokenInput(event.target.value)} placeholder={t('server.token')} />
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
            <div className="server-inline-note">
              <p className="muted">{t('server.localNote')}</p>
              <p className="muted">
                {language === 'zh'
                  ? '这三个档案可分别指向本地、家里服务器和云服务器，你之后在任何设备上都能切换同一套后端。'
                  : 'Use these profiles for local, home, and cloud backends so every device can point to the same server later.'}
              </p>
            </div>
          </form>

          <div className="panel wide server-health-panel">
            <div className="section-heading split">
              <span>{language === 'zh' ? '远程状态' : 'Remote status'}</span>
              <small>{connectionLabel}</small>
            </div>
            <div className="server-status-grid">
              <div className="server-status-card">
                <span>{language === 'zh' ? '接口兼容' : 'API compatibility'}</span>
                <strong>{compatibilityLabel}</strong>
              </div>
              <div className="server-status-card">
                <span>{language === 'zh' ? '最近同步/事件' : 'Latest sync/event'}</span>
                <strong>{adminHealth?.recent_events[0] ? formatDate(adminHealth.recent_events[0].created_at) : '-'}</strong>
              </div>
              <div className="server-status-card">
                <span>{language === 'zh' ? '最近备份' : 'Last backup'}</span>
                <strong>{lastBackupEvent ? formatDate(lastBackupEvent.created_at) : '-'}</strong>
              </div>
              <div className="server-status-card">
                <span>Qdrant</span>
                <strong>{adminHealth?.qdrant?.enabled ? (adminHealth.qdrant.reachable ? 'OK' : 'Down') : 'Off'}</strong>
              </div>
            </div>
            <div className="section-heading compact">
              <Shield size={16} />
              <span>{language === 'zh' ? '最近连接与同步' : 'Recent connection activity'}</span>
            </div>
            <div className="table-list">
              {adminHealth?.recent_events.slice(0, 6).map((event) => (
                <div className="table-row" key={`server-event-${event.id}`}>
                  <div>
                    <strong>{event.area || event.level}</strong>
                    <span>{event.message}</span>
                  </div>
                  <small>{formatDate(event.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide server-notes-panel">
            <div className="section-heading">
              <Cloud size={17} />
              <span>{language === 'zh' ? '部署与运维提示' : 'Deployment notes'}</span>
            </div>
            <div className="note-list">
              <p>{t('server.note1')}</p>
              <p>{t('server.note2')}</p>
              <p>{t('server.note3')}</p>
              <p>
                {language === 'zh'
                  ? `当前数据目录：${adminHealth?.data_dir || '-'} / 数据库：${adminHealth?.database_path || '-'}`
                  : `Current data dir: ${adminHealth?.data_dir || '-'} / database: ${adminHealth?.database_path || '-'}`}
              </p>
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderAdmin() {
    const failedJobs = importJobs.filter((job) => job.status === 'failed')
    const unhealthyDocuments = documents.filter((document) => document.status !== 'ready')
    const backupEvents = adminHealth?.recent_events.filter((event) => /backup|restore|备份|恢复/i.test(`${event.area} ${event.message}`)) ?? []

    return (
      <section className="admin-page">
        <div className="usage-hero">
          <div>
            <h3>{language === 'zh' ? '管理中心' : 'Management center'}</h3>
            <p>
              {language === 'zh'
                ? '把失败任务、异常文档、备份和最近改动集中到一页，方便长期维护。'
                : 'Bring failed jobs, problem documents, backups, and recent changes into one place for long-term maintenance.'}
            </p>
          </div>
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={() => refreshAll()}>
              <RefreshCcw size={16} />
              {t('common.refresh')}
            </button>
            <button className="secondary-button" type="button" onClick={() => api.downloadBackup().catch((error) => showToast(error.message, 'danger'))}>
              <Database size={16} />
              {t('admin.backup')}
            </button>
            <label className="secondary-button">
              <input type="file" accept=".zip" onChange={(event) => handleRestoreBackup(event.target.files?.[0])} />
              <Upload size={16} />
              {t('admin.restore')}
            </label>
          </div>
        </div>

        <div className="admin-overview-grid">
          <div className="metric">
            <span>{language === 'zh' ? '失败任务' : 'Failed jobs'}</span>
            <strong>{failedJobs.length || adminHealth?.failed_import_jobs || 0}</strong>
            <small>{language === 'zh' ? '可直接重试索引' : 'Retry indexing directly'}</small>
          </div>
          <div className="metric">
            <span>{language === 'zh' ? '异常文档' : 'Problem documents'}</span>
            <strong>{unhealthyDocuments.length}</strong>
            <small>{language === 'zh' ? '查看跳过、失败和待处理内容' : 'See skipped, failed, and pending items'}</small>
          </div>
          <div className="metric">
            <span>{language === 'zh' ? '最近改动' : 'Recent changes'}</span>
            <strong>{adminHealth?.recent_events.length || 0}</strong>
            <small>{language === 'zh' ? '导入、恢复和系统事件' : 'Imports, restores, and system events'}</small>
          </div>
          <div className="metric">
            <span>{language === 'zh' ? '存储占用' : 'Storage usage'}</span>
            <strong>{formatBytes(Number(adminHealth?.db_size || 0) + Number(adminHealth?.uploads_size || 0))}</strong>
            <small>{adminHealth?.vector_backend || 'sqlite'}</small>
          </div>
        </div>

        <div className="two-column-page flush admin-management-grid">
          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '失败任务入口' : 'Failed jobs'}</span>
              <small>{failedJobs.length}</small>
            </div>
            <div className="table-list">
              {failedJobs.length === 0 ? (
                <p className="muted">{language === 'zh' ? '当前项目没有失败任务。' : 'No failed jobs for this project.'}</p>
              ) : (
                failedJobs.map((job) => (
                  <div className="table-row" key={`failed-job-${job.id}`}>
                    <div>
                      <strong>{job.source_name || displayProjectName(job.project_name)}</strong>
                      <span>{job.error || (language === 'zh' ? '索引失败' : 'Indexing failed')}</span>
                    </div>
                    <div className="row-actions">
                      <small>{formatDate(job.finished_at || job.started_at)}</small>
                      <button className="chip" type="button" onClick={() => handleRetryImportJob(job.id)}>
                        {t('common.retry')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '异常文档入口' : 'Problem documents'}</span>
              <small>{unhealthyDocuments.length}</small>
            </div>
            <div className="table-list">
              {unhealthyDocuments.length === 0 ? (
                <p className="muted">{language === 'zh' ? '当前项目文档状态正常。' : 'Documents in this project look healthy.'}</p>
              ) : (
                unhealthyDocuments.slice(0, 8).map((document) => (
                  <button className="table-row as-button" key={`problem-doc-${document.id}`} onClick={() => openDocument(document.id)}>
                    <div>
                      <strong>{document.filename}</strong>
                      <span>{displayProjectName(document.project_name)} / {documentStatusLabel(document.status)}</span>
                    </div>
                    <small>{document.last_indexed_at ? formatDate(document.last_indexed_at) : formatDate(document.created_at)}</small>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '系统健康' : 'System health'}</span>
              <small>{adminHealth?.status || '-'}</small>
            </div>
            <div className="metric-strip compact-metrics">
              <div className="metric">
                <span>{t('admin.dbSize')}</span>
                <strong>{formatBytes(adminHealth?.db_size || 0)}</strong>
              </div>
              <div className="metric">
                <span>{t('admin.uploadsSize')}</span>
                <strong>{formatBytes(adminHealth?.uploads_size || 0)}</strong>
              </div>
              <div className="metric">
                <span>{t('admin.failedJobs')}</span>
                <strong>{adminHealth?.failed_import_jobs || 0}</strong>
              </div>
              <div className="metric">
                <span>Vector</span>
                <strong>{adminHealth?.vector_backend || 'sqlite'}</strong>
              </div>
              <div className="metric">
                <span>Qdrant</span>
                <strong>{adminHealth?.qdrant?.enabled ? (adminHealth.qdrant.reachable ? 'OK' : 'Down') : 'Off'}</strong>
              </div>
            </div>
            <div className="section-heading compact">
              <span>{t('admin.events')}</span>
            </div>
            <div className="table-list">
              {adminHealth?.recent_events.slice(0, 5).map((event) => (
                <div className="table-row" key={event.id}>
                  <div>
                    <strong>{event.area || event.level}</strong>
                    <span>{event.message}</span>
                  </div>
                  <small>{formatDate(event.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading split">
              <span>{language === 'zh' ? '备份与恢复日志' : 'Backup and restore log'}</span>
              <small>{backupEvents.length}</small>
            </div>
            <div className="table-list">
              {backupEvents.length === 0 ? (
                <p className="muted">{language === 'zh' ? '还没有备份或恢复事件。' : 'No backup or restore events yet.'}</p>
              ) : (
                backupEvents.slice(0, 6).map((event) => (
                  <div className="table-row" key={`backup-event-${event.id}`}>
                    <div>
                      <strong>{event.area || event.level}</strong>
                      <span>{event.message}</span>
                    </div>
                    <small>{formatDate(event.created_at)}</small>
                  </div>
                ))
              )}
            </div>
          </div>

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
                    <strong>{displayRecoverableText(conversation.title, language, t('chat.newThread'))}</strong>
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
        <div className="settings-page-header">
          <div className="page-kicker">WORKSPACE / CONFIG</div>
          <div>
            <h2>{t('settings.title')}</h2>
            <p>{t('settings.workspaceNote')}</p>
          </div>
        </div>

        <div className="settings-group-block">
          <div className="settings-group-label">{t('settings.mode')}</div>
          <div className="panel settings-panel">
            <div className="settings-row">
              <div>
                <strong>{t('settings.mode')}</strong>
                <span>{t('settings.modeNote')}</span>
              </div>
              <div className="segmented-control" aria-label={t('settings.mode')}>
                <button className={!isProfessionalMode ? 'active' : ''} onClick={() => setProfessionalMode(false)}>
                  {t('settings.simpleMode')}
                </button>
                <button className={isProfessionalMode ? 'active' : ''} onClick={() => setProfessionalMode(true)}>
                  {t('settings.proMode')}
                </button>
              </div>
            </div>
            <div className="settings-row settings-stack">
              <div>
                <strong>{isProfessionalMode ? t('settings.proModeEnabled') : t('settings.proModeDisabled')}</strong>
                <span>{isProfessionalMode ? t('settings.proModeBody') : t('settings.simpleModeBody')}</span>
              </div>
            </div>
            <div className="settings-row settings-stack">
              <div>
                <strong>{language === 'zh' ? '当前导航层级' : 'Current navigation level'}</strong>
                <span>{isProfessionalMode ? t('settings.proModeSummary') : t('settings.simpleModeSummary')}</span>
              </div>
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
          </div>
        </div>

        <div className="settings-group-block">
          <div className="settings-group-label">{t('settings.workspace')}</div>
          <div className="panel settings-panel">
            <div className="settings-row">
              <div>
                <strong>{t('settings.workspace')}</strong>
                <span>{t('settings.workspaceNote')}</span>
              </div>
              <div className="button-row">
                <button className="secondary-button" onClick={() => setActiveView('server')}>
                  <Server size={16} />
                  {t('settings.openServer')}
                </button>
                {isProfessionalMode && (
                  <>
                    <button className="secondary-button" onClick={() => setActiveView('diagnostics')}>
                      <FlaskConical size={16} />
                      {t('settings.openDiagnostics')}
                    </button>
                    <button className="secondary-button" onClick={() => setActiveView('admin')}>
                      <Activity size={16} />
                      {t('settings.openAdmin')}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="settings-row settings-stack">
              <div>
                <strong>{t('settings.currentBackend')}</strong>
                <span>{activeApiBase || t('settings.backendLocal')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-group-block">
          <div className="settings-group-label">{language === 'zh' ? '账号与设备' : 'Account and devices'}</div>
          <div className="panel settings-panel">
            <div className="settings-row">
              <div>
                <strong>{language === 'zh' ? '当前账号' : 'Current account'}</strong>
                <span>
                  {authSession?.user?.display_name
                    ? `${authSession.user.display_name}${authSession.user.email ? ` / ${authSession.user.email}` : ''}`
                    : authSession?.auth_mode === 'env_token'
                      ? language === 'zh'
                        ? '环境变量令牌模式'
                        : 'Environment token mode'
                      : language === 'zh'
                        ? '未登录'
                        : 'Not signed in'}
                </span>
              </div>
              {authSession?.role === 'admin' || authSession?.role === 'user' ? (
                <button className="secondary-button" type="button" onClick={() => void handleLogout()}>
                  <ArrowLeft size={16} />
                  {language === 'zh' ? '退出登录' : 'Sign out'}
                </button>
              ) : null}
            </div>

            <div className="settings-row settings-stack">
              <div>
                <strong>{language === 'zh' ? '已登录设备' : 'Signed-in devices'}</strong>
                <span>
                  {authSession?.auth_mode === 'env_token'
                    ? language === 'zh'
                      ? '当前后端使用环境变量令牌鉴权，不记录设备会话。'
                      : 'This backend uses environment token auth, so device sessions are not tracked.'
                    : language === 'zh'
                      ? '你可以在这里看到当前设备和其它仍然持有登录状态的设备。'
                      : 'See this device and other devices that still have an active sign-in here.'}
                </span>
              </div>
            </div>

            <div className="table-list">
              {deviceSessions.length === 0 ? (
                <p className="muted">
                  {authSession?.auth_mode === 'env_token'
                    ? language === 'zh'
                      ? '令牌模式下没有设备会话列表。'
                      : 'No device session list is available in token mode.'
                    : language === 'zh'
                      ? '还没有可显示的设备会话。'
                      : 'No device sessions to show yet.'}
                </p>
              ) : (
                deviceSessions.map((session) => (
                  <div className="table-row" key={`device-session-${session.id}`}>
                    <div>
                      <strong>
                        {session.device_name || (language === 'zh' ? '未命名设备' : 'Unnamed device')}
                        {session.is_current ? ` · ${language === 'zh' ? '当前设备' : 'Current'}` : ''}
                      </strong>
                      <span>{session.ip_address || session.user_agent || '-'}</span>
                      <small>
                        {(language === 'zh' ? '最近访问' : 'Last seen')}: {session.last_seen_at ? formatDate(session.last_seen_at) : '-'}
                      </small>
                    </div>
                    {!session.is_current && !session.revoked_at ? (
                      <button className="chip" type="button" onClick={() => void handleRevokeDeviceSession(session.id)}>
                        {language === 'zh' ? '移除' : 'Revoke'}
                      </button>
                    ) : (
                      <span className="chip">{session.revoked_at ? (language === 'zh' ? '已失效' : 'Revoked') : (language === 'zh' ? '当前中' : 'Active')}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="settings-group-block">
          <div className="settings-group-label">{language === 'zh' ? '团队与共享' : 'Team and sharing'}</div>
          <div className="panel settings-panel">
            <div className="collaboration-overview-strip">
              {collaborationMetrics.map((metric) => (
                <div className="collaboration-overview-card" key={metric.key}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.detail}</small>
                </div>
              ))}
            </div>

            <div className="settings-row settings-stack">
              <div>
                <strong>{language === 'zh' ? '当前工作区角色' : 'Current workspace role'}</strong>
                <span>{workspaceRoleLabel(authSession?.user?.workspace_role)}</span>
                <small>{workspaceRoleDescription(authSession?.user?.workspace_role)}</small>
              </div>
            </div>

            <div className="role-guide-grid">
              {(['owner', 'admin', 'member', 'viewer'] as const).map((role) => (
                <div className={`role-guide-card ${authSession?.user?.workspace_role === role ? 'active' : ''}`} key={`workspace-role-${role}`}>
                  <strong>{workspaceRoleLabel(role)}</strong>
                  <span>{workspaceRoleDescription(role)}</span>
                </div>
              ))}
            </div>

            {canManageWorkspace ? (
              <>
                <form className="stacked-form" onSubmit={handleCreateTeamInvitation}>
                  <div className="settings-row settings-stack">
                    <div>
                      <strong>{language === 'zh' ? '邀请新成员' : 'Invite new member'}</strong>
                      <span>{language === 'zh' ? '先创建邀请码，再把它发给新成员。对方可以直接在登录页接受邀请。' : 'Create an invite token, then send it to a new teammate.'}</span>
                    </div>
                  </div>
                  <div className="form-grid two-columns">
                    <label>
                      <span>Email</span>
                      <input value={teamInviteDraft.email} onChange={(event) => setTeamInviteDraft((current) => ({ ...current, email: event.target.value }))} placeholder="teammate@example.com" />
                    </label>
                    <label>
                      <span>{language === 'zh' ? '工作区角色' : 'Workspace role'}</span>
                      <select value={teamInviteDraft.workspace_role} onChange={(event) => setTeamInviteDraft((current) => ({ ...current, workspace_role: event.target.value as 'admin' | 'member' | 'viewer' }))}>
                        <option value="admin">{language === 'zh' ? '管理员' : 'Admin'}</option>
                        <option value="member">{language === 'zh' ? '成员' : 'Member'}</option>
                        <option value="viewer">{language === 'zh' ? '查看者' : 'Viewer'}</option>
                      </select>
                    </label>
                    <label>
                      <span>{language === 'zh' ? '默认项目角色' : 'Default project role'}</span>
                      <select value={teamInviteDraft.project_role} onChange={(event) => setTeamInviteDraft((current) => ({ ...current, project_role: event.target.value as 'editor' | 'viewer' }))}>
                        <option value="editor">{language === 'zh' ? '编辑者' : 'Editor'}</option>
                        <option value="viewer">{language === 'zh' ? '查看者' : 'Viewer'}</option>
                      </select>
                    </label>
                    <label>
                      <span>{language === 'zh' ? '有效期（天）' : 'Expires in days'}</span>
                      <input type="number" min={1} max={30} value={teamInviteDraft.expires_in_days} onChange={(event) => setTeamInviteDraft((current) => ({ ...current, expires_in_days: Number(event.target.value) || 7 }))} />
                    </label>
                  </div>
                  <label>
                    <span>{language === 'zh' ? '共享项目' : 'Shared projects'}</span>
                    <select
                      multiple
                      value={teamInviteDraft.project_ids.map(String)}
                      onChange={(event) =>
                        setTeamInviteDraft((current) => ({
                          ...current,
                          project_ids: Array.from(event.target.selectedOptions).map((option) => Number(option.value)),
                        }))
                      }
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {displayProjectName(project.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!!selectedInviteProjects.length && (
                    <div className="selected-project-chip-list">
                      {selectedInviteProjects.map((project) => (
                        <span className="meta-chip" key={`invite-project-${project.id}`}>
                          {displayProjectName(project.name)} / {projectRoleLabel(teamInviteDraft.project_role)}
                        </span>
                      ))}
                    </div>
                  )}
                  <label>
                    <span>{language === 'zh' ? '附言' : 'Message'}</span>
                    <input value={teamInviteDraft.message} onChange={(event) => setTeamInviteDraft((current) => ({ ...current, message: event.target.value }))} placeholder={language === 'zh' ? '告诉对方这个工作区主要放什么' : 'Optional note for the invitee'} />
                  </label>
                  <button className="primary-button" type="submit">
                    <Shield size={16} />
                    {language === 'zh' ? '创建邀请码' : 'Create invite'}
                  </button>
                </form>

                <div className="section-heading compact">
                  <span>{language === 'zh' ? '待处理邀请' : 'Pending invites'}</span>
                </div>
                <div className="invite-card-grid">
                  {teamInvitations.length === 0 ? (
                    <p className="muted">{language === 'zh' ? '还没有邀请。' : 'No invitations yet.'}</p>
                  ) : (
                    teamInvitations.map((invite) => (
                      <div className="invite-card" key={`invite-${invite.id}`}>
                        <div className="invite-card-header">
                          <div>
                            <strong>{invite.email}</strong>
                            <span>{workspaceRoleLabel(invite.workspace_role)} / {projectRoleLabel(invite.project_role)}</span>
                          </div>
                          <span className={`meta-chip ${invite.status === 'pending' ? 'good' : 'subtle'}`}>{invite.status}</span>
                        </div>
                        <div className="invite-card-meta">
                          <small>{language === 'zh' ? '邀请码' : 'Invite token'}</small>
                          <code>{invite.invite_token}</code>
                        </div>
                        {!!invite.project_names.length && (
                          <div className="selected-project-chip-list">
                            {invite.project_names.map((projectName) => (
                              <span className="meta-chip" key={`invite-${invite.id}-${projectName}`}>{displayProjectName(projectName)}</span>
                            ))}
                          </div>
                        )}
                        {invite.message ? <p className="invite-card-note">{invite.message}</p> : null}
                        <div className="invite-card-actions">
                          <small>{invite.expires_at ? formatDate(invite.expires_at) : '-'}</small>
                          <div className="row-actions">
                            <button
                              className="chip"
                              type="button"
                              onClick={() => void copyText(invite.invite_token, language === 'zh' ? '邀请码已复制。' : 'Invite token copied.')}
                            >
                              {language === 'zh' ? '复制口令' : 'Copy token'}
                            </button>
                            <button
                              className="chip"
                              type="button"
                              onClick={() =>
                                void copyText(
                                  `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(invite.invite_token)}`,
                                  language === 'zh' ? '邀请链接已复制。' : 'Invite link copied.',
                                )
                              }
                            >
                              {language === 'zh' ? '复制链接' : 'Copy link'}
                            </button>
                            {invite.status === 'pending' ? (
                              <button className="chip" type="button" onClick={() => void handleRevokeInvitation(invite.id)}>
                                {language === 'zh' ? '撤销' : 'Revoke'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="section-heading compact">
                  <span>{language === 'zh' ? '团队成员' : 'Team members'}</span>
                </div>
                <div className="member-card-list">
                  {teamMembers.map((member) => (
                    <div className="member-card" key={`team-member-${member.user_id}`}>
                      <div className="member-card-main">
                        <strong>{member.display_name || member.email}</strong>
                        <span>{member.email}</span>
                        <small>{language === 'zh' ? `已加入 ${member.project_count} 个项目` : `${member.project_count} project(s)`}</small>
                      </div>
                      <div className="member-card-side">
                        <span className="meta-chip">{workspaceRoleLabel(member.workspace_role)}</span>
                        <small>
                          {member.last_login_at
                            ? language === 'zh'
                              ? `最近登录 ${formatDate(member.last_login_at)}`
                              : `Last login ${formatDate(member.last_login_at)}`
                            : language === 'zh'
                              ? '尚未登录'
                              : 'No sign-in yet'}
                        </small>
                        <select value={member.workspace_role} onChange={(event) => void handlePatchTeamMember(member.user_id, event.target.value as 'owner' | 'admin' | 'member' | 'viewer')}>
                          <option value="owner">{language === 'zh' ? '所有者' : 'Owner'}</option>
                          <option value="admin">{language === 'zh' ? '管理员' : 'Admin'}</option>
                          <option value="member">{language === 'zh' ? '成员' : 'Member'}</option>
                          <option value="viewer">{language === 'zh' ? '查看者' : 'Viewer'}</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="settings-row settings-stack">
                <div>
                  <strong>{language === 'zh' ? '项目共享入口' : 'Project sharing entry'}</strong>
                  <span>{language === 'zh' ? '如果你只需要管理当前项目成员，直接去知识库页里的“项目共享”面板。' : 'To manage members for the current project, use the project sharing panel in Knowledge.'}</span>
                </div>
              </div>
            )}
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
      presets: language === 'zh' ? '预设' : 'Presets',
      eval_cases: language === 'zh' ? '评测集' : 'Eval cases',
      feedback: language === 'zh' ? '反馈' : 'Feedback',
    }
    return labels[key] ?? key
  }
}

export default App


