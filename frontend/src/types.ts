export type Project = {
  id: number
  name: string
  description: string
  document_count?: number
  chunk_count?: number
  created_at: string
  updated_at: string
}

export type DocumentItem = {
  id: number
  project_id: number
  project_name: string
  title: string
  filename: string
  content_type: string
  size: number
  status: string
  chunk_count: number
  created_at: string
}

export type ModelConfig = {
  id: number
  name: string
  provider: 'local' | 'ollama' | 'openai_compatible'
  model: string
  base_url: string
  temperature: number
  enabled: boolean
  is_default: boolean
  api_key_set: boolean
}

export type Citation = {
  rank: number
  document_id: number
  document_title: string
  filename: string
  chunk_id: number
  score: number
  snippet: string
}

export type ChatMessage = {
  id?: number
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  created_at?: string
}

export type ConversationSummary = {
  id: number
  title: string
  project_id?: number
  project_name?: string
  model_name?: string
  updated_at: string
}

export type ConversationDetail = ConversationSummary & {
  messages: ChatMessage[]
}

export type AdminStats = {
  counts: Record<'projects' | 'documents' | 'chunks' | 'conversations' | 'models', number>
  recent_documents: DocumentItem[]
  recent_conversations: ConversationSummary[]
}
