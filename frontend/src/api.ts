import type {
  AdminStats,
  Citation,
  ConversationDetail,
  ConversationSummary,
  DiscoveredModel,
  DocumentItem,
  ModelConfig,
  ModelDiscoveryRequest,
  Project,
} from './types'

const API_BASE_STORAGE_KEY = 'kortex.apiBaseUrl'

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = getApiBase()
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(error.detail || response.statusText)
  }
  return response.json()
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  projects: () => request<Project[]>('/api/projects'),
  createProject: (payload: { name: string; description: string }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  documents: (projectId?: number) => request<DocumentItem[]>(`/api/documents${projectId ? `?project_id=${projectId}` : ''}`),
  uploadDocuments: (projectId: number, files: FileList | File[]) => {
    const form = new FormData()
    Array.from(files).forEach((file) => form.append('files', file))
    form.append('project_id', String(projectId))
    return request<{ uploaded: Array<{ document_id: number; filename: string; chunks: number }> }>('/api/documents/upload', {
      method: 'POST',
      body: form,
    })
  },
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),
  models: () => request<ModelConfig[]>('/api/models'),
  discoverModels: (payload: ModelDiscoveryRequest) =>
    request<{ models: DiscoveredModel[] }>('/api/models/discover', { method: 'POST', body: JSON.stringify(payload) }),
  createModel: (payload: Partial<ModelConfig> & { api_key?: string }) =>
    request<ModelConfig>('/api/models', { method: 'POST', body: JSON.stringify(payload) }),
  patchModel: (id: number, payload: Partial<ModelConfig> & { api_key?: string }) =>
    request<ModelConfig>(`/api/models/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteModel: (id: number) => request<{ ok: boolean }>(`/api/models/${id}`, { method: 'DELETE' }),
  chat: (payload: {
    message: string
    project_id?: number
    model_id?: number
    conversation_id?: number
    top_k?: number
  }) =>
    request<{
      conversation_id: number
      answer: string
      citations: Citation[]
      model: ModelConfig
    }>('/api/chat', { method: 'POST', body: JSON.stringify(payload) }),
  conversations: () => request<ConversationSummary[]>('/api/conversations'),
  conversation: (id: number) => request<ConversationDetail>(`/api/conversations/${id}`),
  deleteConversation: (id: number) => request<{ ok: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  stats: () => request<AdminStats>('/api/admin/stats'),
}
