import { EventEmitter } from 'node:events'
import type {
  IdeActivityEvent,
  IdeAgentStreamEvent,
  IdeConversation,
  IdeRunStatus
} from '../../shared/ide-agent/ide-agent-types'
import {
  pickExecutionSettings,
  waitUntilRunResumedOrAborted,
  type ActiveRunControl,
  type ConversationExecutionSettings,
  type EngineHostOps,
  type IdeAppendActivityInput
} from './ide-agent-runtime-types'
import { requestExplicitRunPermission } from './ide-agent-run-controls'
import {
  abortAndRemoveRunControl,
  pushBoundedActivityEvent,
  updateDirtyPathsMap
} from './ide-agent-selection'
import type { IdeAiClient } from './ide-ai-client'
import type { IdeAgentStore } from './ide-agent-persistence'
import type { IdeAttachmentStore } from './ide-attachment-store'

export class IdeEngineConversationState {
  readonly emitter = new EventEmitter()
  readonly activeRuns = new Map<string, ActiveRunControl>()
  readonly conversationsCache = new Map<string, IdeConversation>()
  readonly deletedConversations = new Set<string>()
  readonly dirtyFilesByConversation = new Map<string, Set<string>>()
  readonly knownProviderModels = new Map<string, Set<string>>()
  private readonly executionSettingsCache = new Map<string, ConversationExecutionSettings>()
  private eventSeq = 0

  constructor(
    readonly store: IdeAgentStore,
    readonly attachmentStore: IdeAttachmentStore | null,
    readonly aiClient: IdeAiClient,
    readonly chunkDelayMs?: number
  ) {
    this.emitter.setMaxListeners(100)
  }

  get hostOps(): EngineHostOps {
    return {
      store: this.store,
      attachmentStore: this.attachmentStore,
      aiClient: this.aiClient,
      chunkDelayMs: this.chunkDelayMs,
      emit: (e) => this.emitter.emit('event', e),
      saveAndPublish: (c, s) => this.saveAndPublish(c, s),
      requireConversation: (id) => this.requireConversation(id),
      setRunStatus: (c, r, s, d) => this.setRunStatus(c, r, s, d),
      appendActivity: (c, p) => this.appendActivity(c, p),
      requestExplicitPermission: (c, r, p) => requestExplicitRunPermission(this.hostOps, c, r, p),
      waitIfPausedOrAborted: (c, r) =>
        waitUntilRunResumedOrAborted(c, r, (conv, id) => this.setRunStatus(conv, id, 'paused'))
    }
  }

  subscribe(listener: (event: IdeAgentStreamEvent) => void, conversationId?: string): () => void {
    const handler = (event: IdeAgentStreamEvent): void => {
      const eventConvId =
        event.type === 'conversation_updated' ? event.conversation.id : event.conversationId
      if (!conversationId || eventConvId === conversationId) {
        listener(event)
      }
    }
    this.emitter.on('event', handler)
    return () => this.emitter.off('event', handler)
  }

  saveAndPublish(conv: IdeConversation, settings?: ConversationExecutionSettings): IdeConversation {
    if (this.deletedConversations.has(conv.id)) {
      return conv
    }
    conv.updatedAt = Date.now()
    const persisted = this.conversationsCache.get(conv.id) ?? this.store.getConversation(conv.id)
    const effective =
      settings ??
      this.executionSettingsCache.get(conv.id) ??
      (persisted ? pickExecutionSettings(persisted) : pickExecutionSettings(conv))
    this.executionSettingsCache.set(conv.id, { ...effective })
    Object.assign(conv, effective)
    this.conversationsCache.set(conv.id, conv)
    this.store.saveConversation(conv)
    this.emitter.emit('event', {
      type: 'conversation_updated',
      conversation: structuredClone(conv)
    })
    return conv
  }

  requireConversation(conversationId: string): IdeConversation {
    if (this.deletedConversations.has(conversationId)) {
      throw new Error(`Conversation "${conversationId}" not found.`)
    }
    const existing =
      this.conversationsCache.get(conversationId) ?? this.store.getConversation(conversationId)
    if (!existing) {
      throw new Error(`Conversation "${conversationId}" not found.`)
    }
    this.conversationsCache.set(conversationId, existing)
    return existing
  }

  getConversation(conversationId: string): IdeConversation | null {
    if (this.deletedConversations.has(conversationId)) {
      return null
    }
    const conv =
      this.conversationsCache.get(conversationId) ?? this.store.getConversation(conversationId)
    if (conv) {
      this.conversationsCache.set(conversationId, conv)
    }
    return conv ? structuredClone(conv) : null
  }

  setRunStatus(
    conv: IdeConversation,
    runId: string | null,
    status: IdeRunStatus,
    detail?: string
  ): void {
    if (runId === null) {
      this.activeRuns.delete(conv.id)
    }
    conv.status = status
    conv.activeRunId = runId
    this.saveAndPublish(conv)
    this.emitter.emit('event', {
      type: 'run_status',
      conversationId: conv.id,
      runId,
      status,
      detail
    })
  }

  appendActivity(conv: IdeConversation, params: IdeAppendActivityInput): IdeActivityEvent {
    this.eventSeq += 1
    const event = pushBoundedActivityEvent(conv, this.eventSeq, params)
    this.saveAndPublish(conv)
    this.emitter.emit('event', { type: 'activity', conversationId: conv.id, event })
    return event
  }

  updateDirtySet(conversationId: string, dirtyPaths?: readonly string[]): Set<string> {
    return updateDirtyPathsMap(
      this.dirtyFilesByConversation,
      this.activeRuns,
      conversationId,
      dirtyPaths
    )
  }

  deleteConversation(conversationId: string): void {
    this.deletedConversations.add(conversationId)
    abortAndRemoveRunControl(this.activeRuns, conversationId)
    this.conversationsCache.delete(conversationId)
    this.dirtyFilesByConversation.delete(conversationId)
    this.executionSettingsCache.delete(conversationId)
    this.store.deleteConversation(conversationId)
    void this.attachmentStore?.deleteConversationAttachments(conversationId).catch(() => {})
  }
}
