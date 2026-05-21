export type Project = {
  id: number
  name: string
  description: string
  chunk_size: number
  chunk_overlap: number
  retrieval_top_k: number
  retrieval_mode: RetrievalMode
  retrieval_scope: RetrievalScope
  similarity_threshold: number
  query_rewrite_enabled: boolean
  rerank_enabled: boolean
  agent_tools_enabled: boolean
  full_context_limit: number
  metadata_filter_json: string
  embedding_model_id?: number
  rerank_model_id?: number
  document_count?: number
  chunk_count?: number
  member_count?: number
  access_role?: 'owner' | 'editor' | 'viewer'
  created_at: string
  updated_at: string
}

export type RetrievalMode = 'vector' | 'keyword' | 'hybrid'
export type RetrievalScope = 'focused' | 'full_context'

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
  checksum?: string
  version?: number
  metadata_json?: string
  metadata?: Record<string, unknown>
  updated_at?: string
  last_indexed_at?: string
  created_at: string
}

export type DocumentChunk = {
  id: number
  chunk_index: number
  content: string
  char_count: number
  section_path?: string
  start_char?: number
  end_char?: number
  vector_model_id?: number
  metadata?: Record<string, unknown>
  created_at: string
}

export type DocumentDetail = DocumentItem & {
  chunks: DocumentChunk[]
  preview: string
}

export type DocumentTreeNode = {
  name: string
  path: string
  type: 'folder' | 'file'
  children?: DocumentTreeNode[]
  document?: Pick<DocumentItem, 'id' | 'title' | 'filename' | 'chunk_count' | 'size' | 'status' | 'created_at'>
}

export type ModelProvider = 'local' | 'ollama' | 'openai_compatible' | 'anthropic' | 'google'
export type ModelType = 'chat' | 'embedding' | 'rerank'

export type ModelConfig = {
  id: number
  name: string
  provider: ModelProvider
  model: string
  base_url: string
  temperature: number
  model_type: ModelType
  context_window: number
  supports_tools: boolean
  supports_vision: boolean
  last_test_status: 'untested' | 'ok' | 'failed'
  last_test_latency_ms?: number
  last_test_error?: string
  last_test_at?: string
  enabled: boolean
  is_default: boolean
  api_key_set: boolean
}

export type ModelPreset = {
  id: number
  name: string
  description: string
  project_id?: number
  project_name?: string
  model_id?: number
  model_name?: string
  model_provider?: ModelProvider
  model_model?: string
  system_prompt: string
  temperature: number
  retrieval_scope: RetrievalScope
  retrieval_mode: RetrievalMode
  top_k: number
  similarity_threshold: number
  use_query_rewrite: boolean
  use_rerank: boolean
  metadata_filter_json: string
  metadata_filter?: Record<string, unknown>
  tools_json: string
  tools?: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

export type ImportResultStatus = 'indexed' | 'duplicate' | 'skipped' | 'failed'

export type ImportResultItem = {
  filename: string
  status: ImportResultStatus
  reason?: string
  document_id?: number
  duplicate_document_id?: number
  duplicate_filename?: string
  chunks?: number
  last_indexed_at?: string
}

export type ImportSummary = {
  total_files: number
  indexed_files: number
  duplicate_files: number
  skipped_files: number
  failed_files: number
  indexed_chunks: number
  new_files: string[]
  duplicate_names: string[]
  failed_names: string[]
}

export type ImportJob = {
  id: number
  project_id: number
  project_name: string
  status: 'completed' | 'failed' | 'running'
  source_name: string
  total_files: number
  indexed_files: number
  skipped_files: number
  failed_files: number
  uploaded: ImportResultItem[]
  skipped: ImportResultItem[]
  results: ImportResultItem[]
  summary: ImportSummary
  error: string
  started_at: string
  finished_at?: string
}

export type ChatDebug = {
  retrieval_mode: string
  retrieval_scope?: string
  effective_query?: string
  top_k: number
  similarity_threshold: number
  retrieved_count: number
  retrieval_ms: number
  generation_ms: number
}

export type DocumentPreview = {
  filename: string
  checksum: string
  duplicate_document_id?: number
  duplicate_filename?: string
  last_indexed_at?: string
  chunk_count: number
  metadata: Record<string, unknown>
  chunks: Array<{
    chunk_index: number
    section_path?: string
    char_count: number
    content: string
  }>
}

export type ModelUsage = {
  id: number
  conversation_id: number
  user_message_id?: number
  assistant_message_id?: number
  model_id?: number
  provider: ModelProvider
  model: string
  model_name?: string
  model_preset_id?: number
  preset_name?: string
  conversation_title?: string
  project_name?: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  currency: string
  is_estimated: boolean
  created_at: string
}

export type ModelUsageTotal = {
  provider: ModelProvider
  model: string
  model_preset_id?: number
  preset_name?: string
  call_count: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  estimated_cost: number
  last_used_at: string
}

export type ModelDiscoveryRequest = {
  provider: ModelProvider
  base_url?: string
  api_key?: string
}

export type DiscoveredModel = {
  id: string
  name?: string
}

export type Citation = {
  rank: number
  document_id: number
  document_title: string
  project_name?: string
  filename: string
  chunk_id: number
  score: number
  vector_score?: number
  keyword_score?: number
  rerank_score?: number
  chunk_index?: number
  section_path?: string
  snippet: string
}

export type RagDebugResult = {
  query: string
  effective_query?: string
  settings: {
    chunk_size: number
    chunk_overlap: number
    top_k: number
    retrieval_mode: RetrievalMode
    retrieval_scope?: RetrievalScope
    similarity_threshold: number
    query_rewrite_enabled?: boolean
    rerank_enabled?: boolean
    metadata_filter?: Record<string, unknown>
  }
  retrieval_ms: number
  items: Array<{
    chunk_id: number
    document_id: number
    document_title: string
    filename: string
    chunk_index: number
    score: number
    vector_score: number
    keyword_score: number
    rerank_score?: number
    section_path?: string
    snippet: string
  }>
}

export type RagLog = {
  id: number
  conversation_id?: number
  project_id?: number
  model_id?: number
  query: string
  retrieval_mode: RetrievalMode
  top_k: number
  similarity_threshold: number
  retrieved_count: number
  retrieval_ms: number
  generation_ms: number
  citations: Citation[]
  project_name?: string
  model_name?: string
  conversation_title?: string
  created_at: string
}

export type ChatMessage = {
  id?: number
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  model_id?: number
  model_name?: string
  model_model?: string
  model_provider?: ModelProvider
  model_preset_id?: number
  reasoning_count?: number
  debug?: ChatDebug
  usage?: Pick<ModelUsage, 'input_tokens' | 'output_tokens' | 'total_tokens' | 'estimated_cost' | 'currency' | 'is_estimated'>
  created_at?: string
}

export type ConversationSummary = {
  id: number
  title: string
  project_id?: number
  project_name?: string
  model_name?: string
  model_preset_id?: number
  preset_name?: string
  updated_at: string
}

export type ConversationDetail = ConversationSummary & {
  messages: ChatMessage[]
}

export type AdminStats = {
  counts: Record<string, number>
  recent_documents: DocumentItem[]
  recent_conversations: ConversationSummary[]
}

export type EvalCase = {
  id: number
  project_id?: number
  project_name?: string
  question: string
  expected_answer: string
  expected_document: string
  tags: string
  created_at: string
  updated_at: string
}

export type EvalRun = {
  id: number
  case_id: number
  project_id?: number
  model_id?: number
  model_preset_id?: number
  model_name?: string
  preset_name?: string
  question: string
  answer: string
  citations: Citation[]
  retrieval_score: number
  answer_score: number
  latency_ms: number
  created_at: string
}

export type AdminHealth = {
  status: string
  database_path: string
  data_dir: string
  db_size: number
  uploads_size: number
  failed_import_jobs: number
  feedback_count: number
  auth_required: boolean
  vector_backend?: string
  qdrant?: {
    backend: string
    enabled: boolean
    url?: string
    collection?: string
    reachable?: boolean
    status_code?: number
    error?: string
  }
  recent_events: Array<{
    id: number
    level: string
    area: string
    message: string
    detail_json: string
    created_at: string
  }>
}

export type SearchResult = {
  query: string
  project_id?: number
  retrieval_ms: number
  items: Citation[]
}

export type AuthRole = 'open' | 'anonymous' | 'admin' | 'user'

export type AuthUser = {
  id: number
  email: string
  display_name: string
  role: 'admin' | 'user'
  workspace_role: 'owner' | 'admin' | 'member' | 'viewer'
  disabled: boolean
  last_login_at?: string
  created_at?: string
  updated_at?: string
  auth_source?: 'open' | 'env_token' | 'password'
}

export type DeviceSession = {
  id: number
  user_id: number
  device_name: string
  user_agent: string
  ip_address: string
  created_at?: string
  expires_at?: string
  last_seen_at?: string
  revoked_at?: string
  is_current: boolean
}

export type AuthSessionInfo = {
  auth_required: boolean
  setup_required: boolean
  role: AuthRole
  permissions: string[]
  user?: AuthUser | null
  session?: DeviceSession | null
  auth_mode: 'open' | 'env_token' | 'password'
  can_bootstrap: boolean
}

export type AuthSuccess = {
  token: string
  auth: AuthSessionInfo
}

export type TeamMember = {
  user_id: number
  email: string
  display_name: string
  role: 'admin' | 'user'
  workspace_role: 'owner' | 'admin' | 'member' | 'viewer'
  disabled: boolean
  project_count: number
  last_login_at?: string
  created_at?: string
  updated_at?: string
}

export type TeamInvitation = {
  id: number
  email: string
  workspace_role: 'admin' | 'member' | 'viewer'
  project_role: 'editor' | 'viewer'
  project_ids: number[]
  project_names: string[]
  invite_token: string
  message: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at?: string
  accepted_at?: string
  invited_by_user_id?: number
  invited_by_name?: string
  created_at?: string
  updated_at?: string
}

export type TeamInvitationPreview = {
  email: string
  workspace_role: 'admin' | 'member' | 'viewer'
  project_role: 'editor' | 'viewer'
  project_ids: number[]
  project_names: string[]
  message: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at?: string
}

export type ProjectMember = {
  user_id: number
  project_id: number
  role: 'owner' | 'editor' | 'viewer'
  display_name: string
  email: string
  workspace_role: 'owner' | 'admin' | 'member' | 'viewer'
  created_at?: string
  updated_at?: string
}

export type SyncSource = {
  id: number
  project_id: number
  project_name?: string
  name: string
  source_path: string
  enabled: boolean
  poll_interval_seconds: number
  include_globs: string
  exclude_globs: string
  delete_missing: boolean
  last_scan_at?: string
  last_error?: string
  last_summary?: {
    indexed_files?: number
    updated_files?: number
    deleted_files?: number
    missing_files?: number
    unchanged_files?: number
    failed_files?: number
  }
  document_count: number
  healthy_count: number
  pending_count: number
  created_at: string
  updated_at: string
}
