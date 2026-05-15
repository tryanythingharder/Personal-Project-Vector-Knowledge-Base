import {
  Activity,
  Bot,
  Check,
  Database,
  FileText,
  History,
  Layers3,
  Loader2,
  MessageSquareText,
  PanelLeft,
  Plus,
  RefreshCcw,
  Search,
  Send,
  ServerCog,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { AdminStats, ChatMessage, Citation, ConversationSummary, DocumentItem, ModelConfig, Project } from './types'

type View = 'chat' | 'knowledge' | 'models' | 'admin'

const navItems: Array<{ id: View; label: string; icon: typeof MessageSquareText }> = [
  { id: 'chat', label: 'RAG 问答', icon: MessageSquareText },
  { id: 'knowledge', label: '知识库', icon: Database },
  { id: 'models', label: '模型切换', icon: Layers3 },
  { id: 'admin', label: '后台管理', icon: ServerCog },
]

const providerLabels: Record<ModelConfig['provider'], string> = {
  local: '本地检索',
  ollama: 'Ollama',
  openai_compatible: 'OpenAI 兼容',
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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
  const [newProject, setNewProject] = useState({ name: '', description: '' })
  const [modelForm, setModelForm] = useState({
    name: 'DeepSeek / OpenAI 兼容',
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
    const docs = await api.documents(defaultProjectId)
    setDocuments(docs)
  }, [selectedProjectId])

  useEffect(() => {
    refreshAll()
      .catch((error) => setNotice(error.message))
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
    setNotice(`已创建项目：${created.name}`)
    await refreshAll()
  }

  async function handleUpload() {
    if (!files?.length || !selectedProject) return
    setIsUploading(true)
    try {
      const result = await api.uploadDocuments(selectedProject.id, files)
      setFiles(null)
      setNotice(`已入库 ${result.uploaded.length} 个文件`)
      await refreshAll()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDeleteDocument(id: number) {
    await api.deleteDocument(id)
    setNotice('文档已删除')
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
          content: error instanceof Error ? `请求失败：${error.message}` : '请求失败',
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
    setNotice(`已添加模型：${created.name}`)
    setModelForm((current) => ({ ...current, api_key: '' }))
    await refreshAll()
  }

  async function patchModel(id: number, payload: Partial<ModelConfig>) {
    await api.patchModel(id, payload)
    await refreshAll()
  }

  const healthLabel = isLoading ? '连接中' : '本地服务正常'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">
            <Bot size={22} />
          </div>
          <div>
            <strong>ProjectVault</strong>
            <span>Agent 工作台</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
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
          <div className="status-dot" />
          <span>{healthLabel}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <PanelLeft size={18} />
            <div>
              <span>当前知识域</span>
              <strong>{selectedProject?.name ?? '我的项目库'}</strong>
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
            <button className="icon-button" title="刷新" onClick={() => refreshAll()}>
              <RefreshCcw size={17} />
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>关闭</button>
          </div>
        )}

        {activeView === 'chat' && renderChat()}
        {activeView === 'knowledge' && renderKnowledge()}
        {activeView === 'models' && renderModels()}
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
            <span>聊天记录</span>
          </div>
          <button
            className="primary-button full-width"
            onClick={() => {
              setConversationId(undefined)
              setMessages([])
            }}
          >
            <Plus size={16} />
            新会话
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
                  {conversation.project_name || '全部项目'} · {formatDate(conversation.updated_at)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="chat-main">
          <div className="chat-stream">
            {messages.length === 0 && (
              <div className="empty-state">
                <Search size={26} />
                <h2>问你的项目资料</h2>
                <p>上传需求文档、README、交付说明或复盘记录后，可以让 Agent 帮你总结方案、查功能点、整理经验。</p>
              </div>
            )}
            {messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <div className="message-role">{message.role === 'user' ? '你' : selectedModel?.name || 'Agent'}</div>
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
                <div className="message-role">Agent</div>
                <div className="message-content loading-line">
                  <Loader2 size={16} className="spin" />
                  正在检索知识库并生成回答
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="composer" onSubmit={handleSend}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：总结一下这个项目的核心功能和技术方案"
              rows={3}
            />
            <button className="send-button" type="submit" disabled={isSending || !question.trim()} title="发送">
              {isSending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            </button>
          </form>
        </section>

        <aside className="inspector">
          <div className="section-heading">
            <FileText size={17} />
            <span>检索依据</span>
          </div>
          {latestCitations.length === 0 ? (
            <p className="muted">回答后这里会显示引用片段、来源文件和相似度。</p>
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
            <span>文档入库</span>
          </div>
          <label className="file-drop">
            <input type="file" multiple onChange={(event) => setFiles(event.target.files)} />
            <Upload size={22} />
            <strong>{files?.length ? `已选择 ${files.length} 个文件` : '选择项目文档'}</strong>
            <span>支持 txt、md、pdf、docx、代码文件和常见配置文件</span>
          </label>
          <button className="primary-button full-width" onClick={handleUpload} disabled={!files?.length || isUploading}>
            {isUploading ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            入库并向量化
          </button>

          <form className="stacked-form" onSubmit={handleCreateProject}>
            <div className="section-heading compact">
              <Plus size={16} />
              <span>新项目</span>
            </div>
            <input
              value={newProject.name}
              onChange={(event) => setNewProject({ ...newProject, name: event.target.value })}
              placeholder="项目名称"
            />
            <textarea
              value={newProject.description}
              onChange={(event) => setNewProject({ ...newProject, description: event.target.value })}
              placeholder="项目说明"
              rows={4}
            />
            <button className="secondary-button" type="submit">
              <Plus size={16} />
              创建项目
            </button>
          </form>
        </div>

        <div className="panel wide">
          <div className="section-heading split">
            <span>已入库文档</span>
            <small>{documents.length} 个文件</small>
          </div>
          <div className="table-list">
            {documents.map((document) => (
              <div className="table-row" key={document.id}>
                <div>
                  <strong>{document.title}</strong>
                  <span>{document.filename} · {document.chunk_count} 个切片 · {formatDate(document.created_at)}</span>
                </div>
                <button className="icon-button danger" title="删除文档" onClick={() => handleDeleteDocument(document.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {documents.length === 0 && <p className="muted">这个项目还没有文档。</p>}
          </div>
        </div>
      </section>
    )
  }

  function renderModels() {
    return (
      <section className="two-column-page">
        <form className="panel stacked-form" onSubmit={handleCreateModel}>
          <div className="section-heading">
            <Settings2 size={17} />
            <span>添加模型</span>
          </div>
          <input value={modelForm.name} onChange={(event) => setModelForm({ ...modelForm, name: event.target.value })} placeholder="显示名称" />
          <select
            value={modelForm.provider}
            onChange={(event) => setModelForm({ ...modelForm, provider: event.target.value as ModelConfig['provider'] })}
          >
            <option value="local">本地检索</option>
            <option value="ollama">Ollama</option>
            <option value="openai_compatible">OpenAI 兼容</option>
          </select>
          <input value={modelForm.model} onChange={(event) => setModelForm({ ...modelForm, model: event.target.value })} placeholder="模型名" />
          <input value={modelForm.base_url} onChange={(event) => setModelForm({ ...modelForm, base_url: event.target.value })} placeholder="Base URL" />
          <input
            type="password"
            value={modelForm.api_key}
            onChange={(event) => setModelForm({ ...modelForm, api_key: event.target.value })}
            placeholder="API Key"
          />
          <label className="range-row">
            <span>Temperature</span>
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
          <button className="primary-button" type="submit">
            <Plus size={16} />
            保存模型
          </button>
        </form>

        <div className="panel wide">
          <div className="section-heading split">
            <span>模型列表</span>
            <small>{models.length} 个配置</small>
          </div>
          <div className="model-list">
            {models.map((model) => (
              <div className="model-row" key={model.id}>
                <div>
                  <strong>{model.name}</strong>
                  <span>{providerLabels[model.provider]} · {model.model}</span>
                  {model.base_url && <small>{model.base_url}</small>}
                </div>
                <div className="row-actions">
                  <button className={model.enabled ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { enabled: !model.enabled })}>
                    {model.enabled ? '启用' : '停用'}
                  </button>
                  <button className={model.is_default ? 'chip active' : 'chip'} onClick={() => patchModel(model.id, { is_default: true })}>
                    <Check size={14} />
                    默认
                  </button>
                </div>
              </div>
            ))}
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

        <div className="two-column-page">
          <div className="panel wide">
            <div className="section-heading">
              <FileText size={17} />
              <span>最近文档</span>
            </div>
            <div className="table-list">
              {stats?.recent_documents.map((document) => (
                <div className="table-row" key={document.id}>
                  <div>
                    <strong>{document.title}</strong>
                    <span>{document.project_name} · {document.chunk_count} 个切片</span>
                  </div>
                  <small>{formatDate(document.created_at)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className="panel wide">
            <div className="section-heading">
              <Activity size={17} />
              <span>最近会话</span>
            </div>
            <div className="table-list">
              {stats?.recent_conversations.map((conversation) => (
                <button className="table-row as-button" key={conversation.id} onClick={() => handleLoadConversation(conversation.id)}>
                  <div>
                    <strong>{conversation.title}</strong>
                    <span>{conversation.project_name || '全部项目'}</span>
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
    projects: '项目',
    documents: '文档',
    chunks: '切片',
    conversations: '会话',
    models: '模型',
  }
  return labels[key] ?? key
}

export default App
