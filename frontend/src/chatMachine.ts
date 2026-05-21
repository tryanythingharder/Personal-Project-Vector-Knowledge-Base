export type BackendChatStatus = 'retrieving' | 'thinking' | 'answering'

export type ChatMachineStage =
  | 'idle'
  | 'submitting'
  | 'retrieving'
  | 'thinking'
  | 'reasoning'
  | 'streaming'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ChatMachineEventName =
  | 'SUBMIT'
  | 'BACKEND_STATUS'
  | 'REASONING'
  | 'CHUNK'
  | 'FINALIZE'
  | 'COMPLETE'
  | 'FAIL'
  | 'CANCEL'
  | 'RESET'

export type ChatMachineState = {
  stage: ChatMachineStage
  requestId: number
  assistantMessageId?: number
  reasoningCount: number
  error?: string
  startedAt?: number
  updatedAt?: number
  lastEvent?: ChatMachineEventName
}

export type ChatMachineEvent =
  | { type: 'SUBMIT'; requestId: number; assistantMessageId: number }
  | { type: 'BACKEND_STATUS'; requestId: number; status: string }
  | { type: 'REASONING'; requestId: number }
  | { type: 'CHUNK'; requestId: number }
  | { type: 'FINALIZE'; requestId: number }
  | { type: 'COMPLETE'; requestId: number }
  | { type: 'FAIL'; requestId: number; error: string }
  | { type: 'CANCEL'; requestId: number }
  | { type: 'RESET' }

type RequestScopedChatMachineEvent = Exclude<ChatMachineEvent, { type: 'SUBMIT' } | { type: 'RESET' }>

const backendStatusStage: Record<BackendChatStatus, ChatMachineStage> = {
  retrieving: 'retrieving',
  thinking: 'thinking',
  answering: 'streaming',
}

export const chatMachineTransitions: Record<ChatMachineStage, readonly ChatMachineStage[]> = {
  idle: ['submitting'],
  submitting: ['retrieving', 'thinking', 'reasoning', 'streaming', 'finalizing', 'completed', 'failed', 'cancelled'],
  retrieving: ['thinking', 'reasoning', 'streaming', 'finalizing', 'completed', 'failed', 'cancelled'],
  thinking: ['reasoning', 'streaming', 'finalizing', 'completed', 'failed', 'cancelled'],
  reasoning: ['streaming', 'finalizing', 'completed', 'failed', 'cancelled'],
  streaming: ['finalizing', 'completed', 'failed', 'cancelled'],
  finalizing: ['completed', 'failed', 'cancelled'],
  completed: ['idle', 'submitting'],
  failed: ['idle', 'submitting'],
  cancelled: ['idle', 'submitting'],
}

export function createInitialChatMachineState(): ChatMachineState {
  return {
    stage: 'idle',
    requestId: 0,
    reasoningCount: 0,
  }
}

export function canMoveChatMachine(from: ChatMachineStage, to: ChatMachineStage) {
  return from === to || chatMachineTransitions[from].includes(to)
}

export function isChatMachineBusy(stage: ChatMachineStage) {
  return ['submitting', 'retrieving', 'thinking', 'reasoning', 'streaming', 'finalizing'].includes(stage)
}

function hasSameRequest(state: ChatMachineState, event: RequestScopedChatMachineEvent) {
  return state.requestId === event.requestId
}

function moveChatMachine(
  state: ChatMachineState,
  nextStage: ChatMachineStage,
  eventName: ChatMachineEventName,
  patch: Partial<ChatMachineState> = {},
): ChatMachineState {
  if (!canMoveChatMachine(state.stage, nextStage)) return state
  return {
    ...state,
    ...patch,
    stage: nextStage,
    lastEvent: eventName,
    updatedAt: Date.now(),
  }
}

function updateWithinStage(state: ChatMachineState, eventName: ChatMachineEventName, patch: Partial<ChatMachineState> = {}): ChatMachineState {
  return {
    ...state,
    ...patch,
    lastEvent: eventName,
    updatedAt: Date.now(),
  }
}

function isBackendChatStatus(status: string): status is BackendChatStatus {
  return status === 'retrieving' || status === 'thinking' || status === 'answering'
}

export function chatMachineReducer(state: ChatMachineState, event: ChatMachineEvent): ChatMachineState {
  if (event.type === 'RESET') return createInitialChatMachineState()

  if (event.type === 'SUBMIT') {
    if (!canMoveChatMachine(state.stage, 'submitting')) return state
    const now = Date.now()
    return {
      stage: 'submitting',
      requestId: event.requestId,
      assistantMessageId: event.assistantMessageId,
      reasoningCount: 0,
      startedAt: now,
      updatedAt: now,
      lastEvent: event.type,
    }
  }

  if (!hasSameRequest(state, event)) return state

  if (event.type === 'BACKEND_STATUS') {
    if (!isBackendChatStatus(event.status)) return state
    return moveChatMachine(state, backendStatusStage[event.status], event.type)
  }

  if (event.type === 'REASONING') {
    const patch = { reasoningCount: state.reasoningCount + 1 }
    if (state.stage === 'streaming') return updateWithinStage(state, event.type, patch)
    return moveChatMachine(state, 'reasoning', event.type, patch)
  }

  if (event.type === 'CHUNK') return moveChatMachine(state, 'streaming', event.type)
  if (event.type === 'FINALIZE') return moveChatMachine(state, 'finalizing', event.type)
  if (event.type === 'COMPLETE') return moveChatMachine(state, 'completed', event.type)
  if (event.type === 'FAIL') return moveChatMachine(state, 'failed', event.type, { error: event.error })
  if (event.type === 'CANCEL') return moveChatMachine(state, 'cancelled', event.type)

  return state
}
