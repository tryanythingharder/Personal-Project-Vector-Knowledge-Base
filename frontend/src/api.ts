import type {
  AdminStats,
  AdminHealth,
  AuthSessionInfo,
  AuthSuccess,
  Citation,
  ConversationDetail,
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
  ModelDiscoveryRequest,
  ModelPreset,
  ModelUsage,
  ModelUsageTotal,
  Project,
  ProjectMember,
  RagDebugResult,
  RagLog,
  SearchResult,
  SyncSource,
  TeamInvitation,
  TeamInvitationPreview,
  TeamMember,
} from './types'

const API_BASE_STORAGE_KEY = 'kortex.apiBaseUrl'
const API_TOKEN_STORAGE_KEY = 'kortex.apiToken'

export function getApiBase() {
  if (typeof window === 'undefined') return import.meta.env.VITE_API_BASE_URL || ''
  return localStorage.getItem(API_BASE_STORAGE_KEY) || import.meta.env.VITE_API_BASE_URL || ''
}

export function setApiBase(value: string) {
  const normalized = value.trim().replace(/\/+$/, '')
  if (normalized) {
    localStorage.setItem(API_BASE_STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
  }
}

export function getApiToken() {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(API_TOKEN_STORAGE_KEY) || ''
}

export function setApiToken(value: string) {
  const normalized = value.trim()
  if (normalized) {
    localStorage.setItem(API_TOKEN_STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(API_TOKEN_STORAGE_KEY)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = getApiBase()
  const token = getApiToken()
  const headers: Record<string, string> = init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value
    })
  }
  if (token) headers['x-kortex-token'] = token
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || response.statusText)
  }
  return response.json()
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  authSession: () => request<AuthSessionInfo>('/api/auth/session'),
  authBootstrap: (payload: { email: string; display_name: string; password: string; device_name: string }) =>
    request<AuthSuccess>('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(payload) }),
  authLogin: (payload: { email: string; password: string; device_name: string }) =>
    request<AuthSuccess>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  previewTeamInvite: (token: string) =>
    request<TeamInvitationPreview>(`/api/team/invitations/preview?token=${encodeURIComponent(token)}`),
  acceptTeamInvite: (payload: { invite_token: string; display_name: string; password: string; device_name: string }) =>
    request<AuthSuccess>('/api/team/invitations/accept', { method: 'POST', body: JSON.stringify(payload) }),
  authLogout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  authSessions: () => request<DeviceSession[]>('/api/auth/sessions'),
  revokeAuthSession: (id: number) => request<{ ok: boolean }>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  teamMembers: () => request<TeamMember[]>('/api/team/members'),
  patchTeamMember: (id: number, payload: { workspace_role: 'owner' | 'admin' | 'member' | 'viewer' }) =>
    request<TeamMember>(`/api/team/members/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  teamInvitations: () => request<TeamInvitation[]>('/api/team/invitations'),
  createTeamInvitation: (payload: { email: string; workspace_role: 'admin' | 'member' | 'viewer'; project_role: 'editor' | 'viewer'; project_ids: number[]; message?: string; expires_in_days?: number }) =>
    request<TeamInvitation>('/api/team/invitations', { method: 'POST', body: JSON.stringify(payload) }),
  revokeTeamInvitation: (id: number) => request<{ ok: boolean }>(`/api/team/invitations/${id}`, { method: 'DELETE' }),
  projects: () => request<Project[]>('/api/projects'),
  createProject: (payload: { name: string; description: string }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  projectMembers: (projectId: number) => request<ProjectMember[]>(`/api/projects/${projectId}/members`),
  addProjectMember: (projectId: number, payload: { user_id: number; role: 'owner' | 'editor' | 'viewer' }) =>
    request<ProjectMember>(`/api/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify(payload) }),
  patchProjectMember: (projectId: number, userId: number, payload: { role: 'owner' | 'editor' | 'viewer' }) =>
    request<ProjectMember>(`/api/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeProjectMember: (projectId: number, userId: number) => request<{ ok: boolean }>(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  patchProjectSettings: (id: number, payload: Partial<Project>) =>
    request<Project>(`/api/projects/${id}/settings`, { method: 'PATCH', body: JSON.stringify(payload) }),
  documents: (projectId?: number) => request<DocumentItem[]>(`/api/documents${projectId ? `?project_id=${projectId}` : ''}`),
  documentTree: (projectId: number) => request<DocumentTreeNode>(`/api/documents/tree?project_id=${projectId}`),
  document: (id: number) => request<DocumentDetail>(`/api/documents/${id}`),
  importJobs: (projectId?: number) => request<ImportJob[]>(`/api/import-jobs${projectId ? `?project_id=${projectId}` : ''}`),
  previewDocuments: (projectId: number, files: FileList | File[]) => {
    const form = new FormData()
    Array.from(files).forEach((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      form.append('files', file, relativePath || file.name)
    })
    form.append('project_id', String(projectId))
    return request<{ items: DocumentPreview[]; skipped: ImportResultItem[]; summary: ImportSummary }>('/api/documents/preview', {
      method: 'POST',
      body: form,
    })
  },
  uploadDocuments: (projectId: number, files: FileList | File[]) => {
    const form = new FormData()
    Array.from(files).forEach((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      form.append('files', file, relativePath || file.name)
    })
    form.append('project_id', String(projectId))
    return request<{
      uploaded: ImportResultItem[]
      skipped: ImportResultItem[]
      results: ImportResultItem[]
      summary: ImportSummary
    }>('/api/documents/upload', {
      method: 'POST',
      body: form,
    })
  },
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),
  batchDeleteDocuments: (documentIds: number[]) =>
    request<{ deleted: number; failed: Array<{ document_id: number; reason: string }> }>('/api/documents/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ document_ids: documentIds }),
    }),
  reindexDocument: (id: number) => request<{ document_id: number; filename: string; chunks: number }>(`/api/documents/${id}/reindex`, { method: 'POST' }),
  patchDocumentMetadata: (id: number, payload: { title?: string; metadata?: Record<string, unknown> }) =>
    request<DocumentDetail>(`/api/documents/${id}/metadata`, { method: 'PATCH', body: JSON.stringify(payload) }),
  retryImportJob: (id: number) =>
    request<{ retried: number; items: Array<{ document_id: number; filename: string; chunks: number }>; summary: ImportSummary }>(`/api/import-jobs/${id}/retry`, {
      method: 'POST',
    }),
  models: () => request<ModelConfig[]>('/api/models'),
  modelPresets: () => request<ModelPreset[]>('/api/model-presets'),
  createModelPreset: (payload: Partial<ModelPreset> & { name: string }) =>
    request<ModelPreset>('/api/model-presets', { method: 'POST', body: JSON.stringify(payload) }),
  patchModelPreset: (id: number, payload: Partial<ModelPreset>) =>
    request<ModelPreset>(`/api/model-presets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteModelPreset: (id: number) => request<{ ok: boolean }>(`/api/model-presets/${id}`, { method: 'DELETE' }),
  discoverModels: (payload: ModelDiscoveryRequest) =>
    request<{ models: DiscoveredModel[] }>('/api/models/discover', { method: 'POST', body: JSON.stringify(payload) }),
  createModel: (payload: Partial<ModelConfig> & { api_key?: string }) =>
    request<ModelConfig>('/api/models', { method: 'POST', body: JSON.stringify(payload) }),
  patchModel: (id: number, payload: Partial<ModelConfig> & { api_key?: string }) =>
    request<ModelConfig>(`/api/models/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteModel: (id: number) => request<{ ok: boolean }>(`/api/models/${id}`, { method: 'DELETE' }),
  testModel: (id: number) => request<{ ok: boolean; latency_ms: number; error: string; models_seen: number; model: ModelConfig }>(`/api/models/${id}/test`, { method: 'POST' }),
  chat: (payload: {
    message: string
    project_id?: number
    model_id?: number
    preset_id?: number
    conversation_id?: number
    top_k?: number
    retrieval_mode?: string
    retrieval_scope?: string
    similarity_threshold?: number
    use_query_rewrite?: boolean
    use_rerank?: boolean
    metadata_filter?: Record<string, unknown>
  }) =>
    request<{
      conversation_id: number
      answer: string
      citations: Citation[]
      model: ModelConfig
      preset?: ModelPreset
      usage: Pick<ModelUsage, 'input_tokens' | 'output_tokens' | 'total_tokens' | 'estimated_cost' | 'currency' | 'is_estimated'>
      debug: {
        retrieval_mode: string
        retrieval_scope?: string
        effective_query?: string
        top_k: number
        similarity_threshold: number
        retrieved_count: number
        retrieval_ms: number
        generation_ms: number
      }
    }>('/api/chat', { method: 'POST', body: JSON.stringify(payload) }),
  chatStream: async (
    payload: {
      message: string
      project_id?: number
      model_id?: number
      preset_id?: number
      conversation_id?: number
      top_k?: number
      retrieval_mode?: string
      retrieval_scope?: string
      similarity_threshold?: number
      use_query_rewrite?: boolean
      use_rerank?: boolean
      metadata_filter?: Record<string, unknown>
    },
    handlers: {
      onStatus?: (status: string) => void
      onMeta?: (data: any) => void
      onReasoning?: (text: string) => void
      onChunk?: (text: string) => void
      onDone?: (data: any) => void
      onError?: (message: string) => void
    },
  ) => {
    const token = getApiToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['x-kortex-token'] = token
    const response = await fetch(`${getApiBase()}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || response.statusText)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const rawEvent of events) {
        const eventName = rawEvent.match(/^event:\s*(.+)$/m)?.[1]
        const dataLine = rawEvent.match(/^data:\s*(.+)$/m)?.[1]
        if (!eventName || !dataLine) continue
        const data = JSON.parse(dataLine)
        if (eventName === 'status') handlers.onStatus?.(data.status)
        if (eventName === 'meta') handlers.onMeta?.(data)
        if (eventName === 'reasoning') handlers.onReasoning?.(data.text || '')
        if (eventName === 'chunk') handlers.onChunk?.(data.text || '')
        if (eventName === 'done') handlers.onDone?.(data)
        if (eventName === 'error') handlers.onError?.(data.message || 'Stream failed')
      }
    }
  },
  debugRetrieval: (payload: { query: string; project_id?: number; top_k?: number; retrieval_mode?: string; retrieval_scope?: string; similarity_threshold?: number; use_query_rewrite?: boolean; use_rerank?: boolean; metadata_filter?: Record<string, unknown> }) =>
    request<RagDebugResult>('/api/rag/debug', { method: 'POST', body: JSON.stringify(payload) }),
  searchKnowledge: (payload: { query: string; project_id?: number; top_k?: number; retrieval_mode?: string; retrieval_scope?: string; similarity_threshold?: number; metadata_filter?: Record<string, unknown> }) =>
    request<SearchResult>('/api/search', { method: 'POST', body: JSON.stringify(payload) }),
  ragLogs: (projectId?: number) => request<RagLog[]>(`/api/rag/logs${projectId ? `?project_id=${projectId}` : ''}`),
  saveFeedback: (payload: { conversation_id: number; message_id: number; rating: number; note?: string }) =>
    request<{ ok: boolean }>('/api/chat/feedback', { method: 'POST', body: JSON.stringify(payload) }),
  regenerateConversation: (conversationId: number, modelId?: number) =>
    request<any>(`/api/conversations/${conversationId}/regenerate${modelId ? `?model_id=${modelId}` : ''}`, { method: 'POST' }),
  evalCases: (projectId?: number) => request<EvalCase[]>(`/api/eval/cases${projectId ? `?project_id=${projectId}` : ''}`),
  createEvalCase: (payload: Partial<EvalCase> & { question: string }) =>
    request<EvalCase>('/api/eval/cases', { method: 'POST', body: JSON.stringify(payload) }),
  deleteEvalCase: (id: number) => request<{ ok: boolean }>(`/api/eval/cases/${id}`, { method: 'DELETE' }),
  runEval: (payload: { case_ids?: number[]; project_id?: number; model_id?: number; preset_id?: number }) =>
    request<{ count: number; items: Array<{ run_id: number; case_id: number; retrieval_score: number; answer_score: number; latency_ms: number }> }>('/api/eval/run', { method: 'POST', body: JSON.stringify(payload) }),
  evalRuns: () => request<EvalRun[]>('/api/eval/runs'),
  modelUsage: () => request<{ items: ModelUsage[]; totals: ModelUsageTotal[] }>('/api/models/usage'),
  conversations: () => request<ConversationSummary[]>('/api/conversations'),
  conversation: (id: number) => request<ConversationDetail>(`/api/conversations/${id}`),
  deleteConversation: (id: number) => request<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  stats: () => request<AdminStats>('/api/admin/stats'),
  adminHealth: () => request<AdminHealth>('/api/admin/health'),
  syncSources: (projectId?: number) => request<SyncSource[]>(`/api/sync-sources${projectId ? `?project_id=${projectId}` : ''}`),
  createSyncSource: (payload: { project_id: number; name: string; source_path: string; enabled?: boolean; poll_interval_seconds?: number; include_globs?: string; exclude_globs?: string; delete_missing?: boolean }) =>
    request<SyncSource>('/api/sync-sources', { method: 'POST', body: JSON.stringify(payload) }),
  patchSyncSource: (id: number, payload: Partial<SyncSource>) =>
    request<SyncSource>(`/api/sync-sources/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSyncSource: (id: number) => request<{ ok: boolean }>(`/api/sync-sources/${id}`, { method: 'DELETE' }),
  scanSyncSource: (id: number) => request<{ source_id: number; summary: Record<string, number> }>(`/api/sync-sources/${id}/scan`, { method: 'POST' }),
  downloadBackup: async () => {
    const headers: Record<string, string> = {}
    const token = getApiToken()
    if (token) headers['x-kortex-token'] = token
    const response = await fetch(`${getApiBase()}/api/admin/backup`, { headers })
    if (!response.ok) throw new Error(response.statusText)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'kortex-backup.zip'
    link.click()
    URL.revokeObjectURL(url)
  },
  restoreBackup: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ ok: boolean }>('/api/admin/backup/restore', { method: 'POST', body: form })
  },
}
