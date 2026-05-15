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
  Layers3,
  Loader2,
  MessageSquareText,
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
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getApiBase, setApiBase } from './api'
import type { AdminStats, ChatMessage, Citation, ConversationSummary, DocumentItem, ModelConfig, Project } from './types'

type View = 'chat' | 'knowledge' | 'models' | 'server' | 'admin'

type ModelPreset = {
  name: string
  provider: ModelConfig['provider']
  model: string
  base_url: string
  note: string
}

const PRODUCT_NAME = 'Kortex'

const navItems: Array<{ id: View; label: string; icon: typeof MessageSquareText }> = [
  { id: 'chat', label: 'Ask', icon: MessageSquareText },
  { id: 'knowledge', label: 'Library', icon: Database },
  { id: 'models', label: 'Models', icon: Layers3 },
  { id: 'server', label: 'Server', icon: Cloud },
  { id: 'admin', label: 'Admin', icon: Activity },
]

const providerLabels: Record<ModelConfig['provider'], string> = {
  local: 'Local RAG',
  ollama: 'Ollama',
  openai_compatible: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
}

const modelPresets: ModelPreset[] = [
  {
    name: 'OpenAI GPT-4.1 Mini',
    provider: 'openai_compatible',
    model: 'gpt-4.1-mini',
    base_url: 'https://api.openai.com/v1',
    note: 'OpenAI API',
  },
  {
    name: 'Anthropic Claude Sonnet',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
    base_url: 'https://api.anthropic.com/v1',
    note: 'Claude Messages API',
  },
  {
    name: 'Google Gemini Flash',
    provider: 'google',
    model: 'gemini-1.5-flash',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    note: 'Google AI Studio key',
  },
  {
    name: 'DeepSeek Chat',
    provider: 'openai_compatible',
    model: 'deepseek-chat',
    base_url: 'https://api.deepseek.com/v1',
    note: 'OpenAI-compatible',
  },
  {
    name: 'Qwen Plus',
    provider: 'openai_compatible',
    model: 'qwen-plus',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    note: 'DashScope compatible mode',
  },
  {
    name: 'Kimi',
    provider: 'openai_compatible',
    model: 'moonshot-v1-8k',
    base_url: 'https://api.moonshot.cn/v1',
    note: 'Moonshot compatible API',
  },
  {
    name: 'OpenRouter',
    provider: 'openai_compatible',
    model: 'openai/gpt-4.1-mini',
    base_url: 'https://openrouter.ai/api/v1',
    note: 'Route to many hosted models',
  },
  {
    name: 'Local Ollama Qwen',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    base_url: 'http://localhost:11434',
    note: 'Private local model',
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

function App() {
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
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [files, setFiles] = useState<FileList | null>(null)
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase())
  const [connectionState, setConnectionState] = useState<'checking' | 'online' | 'offline'>('checking')
  const [newProject, setNewProject] = useState({ name: '', description: '' })
  const [modelForm, setModelForm] = useState({
    name: 'DeepSeek Chat',
    provider: 'openai_compatible' as ModelConfig['provider'],
    model: 'deepseek-chat',
    base_url: 'https://api.deepseek.com/v1',
    api_key: '',
    temperature: 0.2,
  })
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  )
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? models.find((model) => model.is_default) ?? models[0],
    [models, selectedModelId],
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
    setSelectedModelId((current) => current ?? modelData.find((model) => model.is_default)?.id ?? modelData[0]?.id)
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
    setNotice(`Project created: ${created.name}`)
    await refreshAll()
  }

  async function handleUpload() {
    if (!files?.length || !selectedProject) return
    setIsUploading(true)
    try {
      const result = await api.uploadDocuments(selectedProject.id, files)
      setFiles(null)
      setNotice(`Indexed ${result.uploaded.length} file(s).`)
      await refreshAll()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDeleteDocument(id: number) {
    await api.deleteDocument(id)
    setNotice('Document removed.')
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
          content: error instanceof Error ? `Request failed: ${error.message}` : 'Request failed.',
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

  async function handleCreateModel(event: FormEvent) {
    event.preventDefault()
    const created = await api.createModel({ ...modelForm, enabled: true, is_default: false })
    setNotice(`Model saved: ${created.name}`)
    setModelForm((current) => ({ ...current, api_key: '' }))
    await refreshAll()
  }

  async function patchModel(id: number, payload: Partial<ModelConfig>) {
    await api.patchModel(id, payload)
    await refreshAll()
  }

  async function handleSaveServer(event: FormEvent) {
    event.preventDefault()
    setApiBase(apiBaseInput)
    setNotice(apiBaseInput.trim() ? 'Remote server saved. All API calls now use that backend.' : 'Switched back to the bundled local backend.')
    await refreshAll()
  }

  async function handleTestServer() {
    const base = normalizeApiBase(apiBaseInput)
    try {
      const response = await fetch(`${base}/api/health`)
      if (!response.ok) throw new Error(response.statusText)
      setNotice('Server connection succeeded.')
    } catch (error) {
      setNotice(error instanceof Error ? `Server test failed: ${error.message}` : 'Server test failed.')
    }
  }

  function applyPreset(preset: ModelPreset) {
    setModelForm({
      name: preset.name,
      provider: preset.provider,
      model: preset.model,
      base_url: preset.base_url,
      api_key: '',
      temperature: 0.2,
    })
  }

  const activeApiBase = getApiBase()
  const connectionLabel = connectionState === 'online' ? 'Online' : connectionState === 'checking' ? 'Checking' : 'Offline'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>{PRODUCT_NAME}</strong>
            <span>Project memory OS</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} className={activeView === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView(item.id)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <div className={`status-dot ${connectionState}`} />
          <div>
            <strong>{connectionLabel}</strong>
            <span>{activeApiBase || 'Bundled backend'}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <Bot size={19} />
            <div>
              <span>Workspace</span>
              <strong>{selectedProject?.name ?? 'Personal Projects'}</strong>
            </div>
          </div>
          <div className="topbar-controls">
            <select value={selectedProject?.id ?? ''} onChange={(event) => setSelectedProjectId(Number(event.target.value))}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select value={selectedModel?.id ?? ''} onChange={(event) => setSelectedModelId(Number(event.target.value))}>
              {models
                .filter((model) => model.enabled)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
            </select>
            <button className="icon-button" title="Refresh" onClick={() => refreshAll()}>
              <RefreshCcw size={17} />
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>Dismiss</button>
          </div>
        )}

        {activeView === 'chat' && renderChat()}
        {activeView === 'knowledge' && renderKnowledge()}
        {activeView === 'models' && renderModels()}
        {activeView === 'server' && renderServer()}
        {activeView === 'admin' && renderAdmin()}
      </main>
    </div>
  )

  function renderChat() {
    return (
      <section className="chat-layout">
        <aside className="conversation-rail">
          <div className="section-heading">
            <History size={17} />
            <span>Sessions</span>
          </div>
          <button
            className="primary-button full-width"
            onClick={() => {
              setConversationId(undefined)
              setMessages([])
            }}
          >
            <Plus size={16} />
            New thread
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
                  {conversation.project_name || 'All projects'} / {formatDate(conversation.updated_at)}
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
                <h2>Ask across your project memory</h2>
                <p>Upload requirements, handoff notes, README files, design decisions, and retrospectives. Kortex will retrieve the closest evidence before answering.</p>
                <div className="prompt-row">
                  {['Summarize this project', 'Find deployment steps', 'Extract reusable lessons'].map((prompt) => (
                    <button key={prompt} onClick={() => setQuestion(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <div className="message-role">{message.role === 'user' ? 'You' : selectedModel?.name || PRODUCT_NAME}</div>
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
                  Retrieving evidence and composing an answer
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="composer" onSubmit={handleSend}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about a project, decision, module, deployment, bug, or lesson learned..."
              rows={3}
            />
            <button className="send-button" type="submit" disabled={isSending || !question.trim()} title="Send">
              {isSending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
          </form>
        </section>

        <aside className="inspector">
          <div className="section-heading">
            <FileText size={17} />
            <span>Evidence</span>
          </div>
          {latestCitations.length === 0 ? (
            <p className="muted">Cited chunks, source files, and similarity scores appear here after an answer.</p>
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
            <span>Ingest</span>
          </div>
          <label className="file-drop">
            <input type="file" multiple onChange={(event) => setFiles(event.target.files)} />
            <Upload size={22} />
            <strong>{files?.length ? `${files.length} file(s) selected` : 'Drop project files into memory'}</strong>
            <span>txt, md, pdf, docx, source code, logs, config files</span>
          </label>
          <button className="primary-button full-width" onClick={handleUpload} disabled={!files?.length || isUploading}>
            {isUploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            Index documents
          </button>

          <form className="stacked-form" onSubmit={handleCreateProject}>
            <div className="section-heading compact">
              <Plus size={16} />
              <span>New project space</span>
            </div>
            <input value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} placeholder="Project name" />
            <textarea
              value={newProject.description}
              onChange={(event) => setNewProject({ ...newProject, description: event.target.value })}
              placeholder="What belongs in this project?"
              rows={4}
            />
            <button className="secondary-button" type="submit">
              <Plus size={16} />
              Create project
            </button>
          </form>
        </div>

        <div className="panel wide">
          <div className="section-heading split">
            <span>Indexed files</span>
            <small>{documents.length} file(s)</small>
          </div>
          <div className="table-list">
            {documents.map((document) => (
              <div className="table-row" key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <span>{document.filename} / {document.chunk_count} chunks / {formatDate(document.created_at)}</span>
                </div>
                <button className="icon-button danger" title="Delete document" onClick={() => handleDeleteDocument(document.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {documents.length === 0 && <p className="muted">This project space does not have indexed files yet.</p>}
          </div>
        </div>
      </section>
    )
  }

  function renderModels() {
    return (
      <section className="models-page">
        <div className="preset-strip">
          {modelPresets.map((preset) => (
            <button key={preset.name} className="preset-button" onClick={() => applyPreset(preset)}>
              <strong>{preset.name}</strong>
              <span>{preset.note}</span>
            </button>
          ))}
        </div>

        <div className="two-column-page flush">
          <form className="panel stacked-form" onSubmit={handleCreateModel}>
            <div className="section-heading">
              <Settings2 size={17} />
              <span>Model endpoint</span>
            </div>
            <input value={modelForm.name} onChange={(event) => setModelForm({ ...modelForm, name: event.target.value })} placeholder="Display name" />
            <select value={modelForm.provider} onChange={(event) => setModelForm({ ...modelForm, provider: event.target.value as ModelConfig['provider'] })}>
              <option value="local">Local evidence answer</option>
              <option value="ollama">Ollama</option>
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="google">Google Gemini</option>
            </select>
            <input value={modelForm.model} onChange={(event) => setModelForm({ ...modelForm, model: event.target.value })} placeholder="Model id" />
            <input value={modelForm.base_url} onChange={(event) => setModelForm({ ...modelForm, base_url: event.target.value })} placeholder="Base URL" />
            <input type="password" value={modelForm.api_key} onChange={(event) => setModelForm({ ...modelForm, api_key: event.target.value })} placeholder="API key" />
            <label className="range-row">
              <span>Temperature</span>
              <input type="range" min="0" max="1" step="0.1" value={modelForm.temperature} onChange={(event) => setModelForm({ ...modelForm, temperature: Number(event.target.value) })} />
              <strong>{modelForm.temperature}</strong>
            </label>
            <button className="primary-button" type="submit">
              <Plus size={16} />
              Save model
            </button>
          </form>

          <div className="panel wide">
            <div className="section-heading split">
              <span>Configured models</span>
              <small>{models.length} endpoint(s)</small>
            </div>
            <div className="model-list">
              {models.map((model) => (
                <div className="model-row" key={model.id}>
                  <div>
                    <strong>{model.name}</strong>
                    <span>{providerLabels[model.provider]} / {model.model}</span>
                    {model.base_url && <small>{model.base_url}</small>}
                  </div>
                  <div className="row-actions">
                    <button className={model.enabled ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { enabled: !model.enabled })}>
                      {model.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button className={model.is_default ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { is_default: true })}>
                      <Check size={14} />
                      Default
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

  function renderServer() {
    return (
      <section className="server-page">
        <div className="server-hero">
          <div>
            <div className="eyebrow">
              <Wifi size={15} />
              Shared backend mode
            </div>
            <h2>Point every device at the same knowledge base.</h2>
            <p>Deploy the FastAPI backend on your server, keep SQLite or swap in a managed database later, then set this desktop app to that API URL. Your laptop, desktop, and future clients will read the same documents and chat history.</p>
          </div>
          <div className="server-mode">
            <div>
              <HardDrive size={18} />
              <span>Local bundled backend</span>
            </div>
            <div>
              <Globe2 size={18} />
              <span>Remote API backend</span>
            </div>
          </div>
        </div>

        <div className="two-column-page flush">
          <form className="panel stacked-form" onSubmit={handleSaveServer}>
            <div className="section-heading">
              <Server size={17} />
              <span>Backend endpoint</span>
            </div>
            <input value={apiBaseInput} onChange={(event) => setApiBaseInput(event.target.value)} placeholder="https://kb.your-domain.com or leave empty for local" />
            <div className="button-row">
              <button className="primary-button" type="submit">
                <Check size={16} />
                Save endpoint
              </button>
              <button className="secondary-button" type="button" onClick={handleTestServer}>
                <Wifi size={16} />
                Test
              </button>
            </div>
            <p className="muted">The desktop app stores this endpoint locally. It does not rewrite the installed app.</p>
          </form>

          <div className="panel wide">
            <div className="section-heading">
              <Shield size={17} />
              <span>Deployment notes</span>
            </div>
            <div className="note-list">
              <p>Run the backend on your server with Docker Compose and expose HTTPS through Nginx, Caddy, or a cloud load balancer.</p>
              <p>Keep `KB_DATA_DIR` on a persistent disk so uploads, SQLite data, and vectors survive redeploys.</p>
              <p>For team or multi-device scale, the next backend step is replacing SQLite with PostgreSQL plus pgvector while keeping the desktop client unchanged.</p>
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
              <span>Recent documents</span>
            </div>
            <div className="table-list">
              {stats?.recent_documents.map((document) => (
                <div className="table-row" key={document.id}>
                  <div>
                    <strong>{document.title}</strong>
                    <span>{document.project_name} / {document.chunk_count} chunks</span>
                  </div>
                  <small>{formatDate(document.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading">
              <Activity size={17} />
              <span>Recent sessions</span>
            </div>
            <div className="table-list">
              {stats?.recent_conversations.map((conversation) => (
                <button className="table-row as-button" key={conversation.id} onClick={() => handleLoadConversation(conversation.id)}>
                  <div>
                    <strong>{conversation.title}</strong>
                    <span>{conversation.project_name || 'All projects'}</span>
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
}

function metricLabel(key: string) {
  const labels: Record<string, string> = {
    projects: 'Projects',
    documents: 'Documents',
    chunks: 'Chunks',
    conversations: 'Threads',
    models: 'Models',
  }
  return labels[key] ?? key
}

export default App
