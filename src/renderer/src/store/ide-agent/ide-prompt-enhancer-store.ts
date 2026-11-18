import { create } from 'zustand'
import type { IdePromptEnhancerStatus } from '../../../../shared/ide-agent/ide-prompt-enhancer-types'
import type { IdeExecutionMode } from '../../../../shared/ide-agent/ide-agent-types'
import { useIdeAgentStore } from './ide-agent-store'
import {
  collectIdeContextForEnhancement,
  getPromptEnhancerTransport,
  setPromptEnhancerTransportForTesting,
  type PromptEnhancerTransport
} from './ide-prompt-enhancer-context'

export { setPromptEnhancerTransportForTesting, type PromptEnhancerTransport }

export type IdeConversationEnhancerSlice = {
  status: IdePromptEnhancerStatus
  requestId: string | null
  sourceDraft: string
  enhancedPrompt: string | null
  restorableDraft: string | null
  errorMessage: string | null
  draftChangedSinceRequest: boolean
  usedAgentId: string | null
  usedModelId: string | null
}

export const DEFAULT_CONVERSATION_ENHANCER_SLICE: IdeConversationEnhancerSlice = {
  status: 'idle',
  requestId: null,
  sourceDraft: '',
  enhancedPrompt: null,
  restorableDraft: null,
  errorMessage: null,
  draftChangedSinceRequest: false,
  usedAgentId: null,
  usedModelId: null
}

function makeEnhanceRequestId(): string {
  return `enh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export type IdeEnhanceTriggerInput = {
  conversationId: string
  worktreeSelector?: string | null
  workspacePath?: string | null
  worktreeId?: string | null
  draftOverride?: string
  mode?: IdeExecutionMode
  agentId?: string
  modelId?: string
  regenerate?: boolean
}

type IdePromptEnhancerState = {
  byConversation: Record<string, IdeConversationEnhancerSlice>
  triggerEnhance: (input: IdeEnhanceTriggerInput) => Promise<void>
  regenerate: (input: Omit<IdeEnhanceTriggerInput, 'regenerate'>) => Promise<void>
  applyEnhancedPrompt: (conversationId: string) => boolean
  restoreOriginalDraft: (conversationId: string) => boolean
  dismissPreview: (conversationId: string) => void
  cancelEnhancement: (conversationId: string) => void
  notifyDraftChanged: (conversationId: string, nextDraft: string) => void
  clearRestorableDraft: (conversationId: string) => void
}

function patchSlice(
  byConversation: Record<string, IdeConversationEnhancerSlice>,
  conversationId: string,
  patch: Partial<IdeConversationEnhancerSlice>
): Record<string, IdeConversationEnhancerSlice> {
  const prev = byConversation[conversationId] ?? DEFAULT_CONVERSATION_ENHANCER_SLICE
  return { ...byConversation, [conversationId]: { ...prev, ...patch } }
}

export const useIdePromptEnhancerStore = create<IdePromptEnhancerState>((set, get) => ({
  byConversation: {},

  triggerEnhance: async (input) => {
    const transport = getPromptEnhancerTransport()
    const existing =
      get().byConversation[input.conversationId] ?? DEFAULT_CONVERSATION_ENHANCER_SLICE
    if (
      existing.status === 'enhancing' &&
      !input.regenerate &&
      !existing.draftChangedSinceRequest
    ) {
      return
    }
    if (existing.status === 'enhancing' && existing.requestId) {
      void transport.cancel(existing.requestId)
    }

    const agentState = useIdeAgentStore.getState()
    const liveDraft = agentState.draftsByConversation[input.conversationId] ?? ''
    const sourceDraft =
      input.draftOverride ??
      (input.regenerate && existing.sourceDraft.trim() && !existing.draftChangedSinceRequest
        ? existing.sourceDraft
        : liveDraft)
    if (!sourceDraft.trim()) {
      return
    }

    const activeConv =
      agentState.activeConversation?.id === input.conversationId
        ? agentState.activeConversation
        : null
    const mode = input.mode ?? activeConv?.mode ?? 'agent'
    const agentId = input.agentId ?? activeConv?.agentId
    const modelId = input.modelId ?? activeConv?.modelId
    const requestId = makeEnhanceRequestId()
    const context = collectIdeContextForEnhancement(input.conversationId, input.worktreeId)

    set((s) => ({
      byConversation: patchSlice(s.byConversation, input.conversationId, {
        status: 'enhancing',
        requestId,
        sourceDraft,
        enhancedPrompt: null,
        errorMessage: null,
        draftChangedSinceRequest: liveDraft !== sourceDraft,
        usedAgentId: agentId ?? null,
        usedModelId: modelId ?? null
      })
    }))

    try {
      const response = await transport.enhance({
        requestId,
        conversationId: input.conversationId,
        ...(input.worktreeSelector ? { worktreeSelector: input.worktreeSelector } : {}),
        ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
        draft: sourceDraft,
        mode,
        ...(agentId ? { agentId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(input.regenerate ? { regenerate: true } : {}),
        ...context
      })

      const latest = get().byConversation[input.conversationId]
      if (!latest || latest.requestId !== requestId) {
        return
      }
      const currentDraftNow =
        useIdeAgentStore.getState().draftsByConversation[input.conversationId] ?? ''

      if (!response.ok) {
        set((s) => ({
          byConversation: patchSlice(s.byConversation, input.conversationId, {
            status: response.cancelled ? 'cancelled' : 'error',
            requestId: null,
            errorMessage: response.cancelled ? null : response.error,
            draftChangedSinceRequest: currentDraftNow !== sourceDraft
          })
        }))
        return
      }

      set((s) => ({
        byConversation: patchSlice(s.byConversation, input.conversationId, {
          status: 'preview',
          requestId: null,
          enhancedPrompt: response.enhancedPrompt,
          errorMessage: null,
          draftChangedSinceRequest: currentDraftNow !== sourceDraft,
          usedAgentId: response.agentId,
          usedModelId: response.modelId
        })
      }))
    } catch (error) {
      const latest = get().byConversation[input.conversationId]
      if (!latest || latest.requestId !== requestId) {
        return
      }
      set((s) => ({
        byConversation: patchSlice(s.byConversation, input.conversationId, {
          status: 'error',
          requestId: null,
          errorMessage: error instanceof Error ? error.message : 'Failed to enhance prompt.'
        })
      }))
    }
  },

  regenerate: async (input) => {
    await get().triggerEnhance({ ...input, regenerate: true })
  },

  applyEnhancedPrompt: (conversationId) => {
    const slice = get().byConversation[conversationId]
    if (!slice || slice.status !== 'preview' || !slice.enhancedPrompt) {
      return false
    }
    const currentLiveDraft = useIdeAgentStore.getState().draftsByConversation[conversationId] ?? ''
    const restorable = currentLiveDraft.trim() ? currentLiveDraft : slice.sourceDraft

    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, { status: 'applying' })
    }))
    useIdeAgentStore.getState().setDraft(conversationId, slice.enhancedPrompt)
    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, {
        status: 'idle',
        requestId: null,
        enhancedPrompt: null,
        errorMessage: null,
        draftChangedSinceRequest: false,
        restorableDraft: restorable
      })
    }))
    return true
  },

  restoreOriginalDraft: (conversationId) => {
    const slice = get().byConversation[conversationId]
    if (!slice || slice.restorableDraft === null) {
      return false
    }
    useIdeAgentStore.getState().setDraft(conversationId, slice.restorableDraft)
    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, {
        restorableDraft: null,
        status: 'idle'
      })
    }))
    return true
  },

  dismissPreview: (conversationId) => {
    const slice = get().byConversation[conversationId]
    if (slice?.requestId) {
      void getPromptEnhancerTransport().cancel(slice.requestId)
    }
    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, {
        status: 'idle',
        requestId: null,
        enhancedPrompt: null,
        errorMessage: null,
        draftChangedSinceRequest: false
      })
    }))
  },

  cancelEnhancement: (conversationId) => {
    const slice = get().byConversation[conversationId]
    if (!slice || slice.status !== 'enhancing') {
      return
    }
    if (slice.requestId) {
      void getPromptEnhancerTransport().cancel(slice.requestId)
    }
    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, {
        status: 'cancelled',
        requestId: null,
        enhancedPrompt: null,
        errorMessage: null
      })
    }))
  },

  notifyDraftChanged: (conversationId, nextDraft) => {
    const slice = get().byConversation[conversationId]
    if (!slice || (slice.status !== 'enhancing' && slice.status !== 'preview')) {
      return
    }
    const changed = nextDraft !== slice.sourceDraft
    if (changed !== slice.draftChangedSinceRequest) {
      set((s) => ({
        byConversation: patchSlice(s.byConversation, conversationId, {
          draftChangedSinceRequest: changed
        })
      }))
    }
  },

  clearRestorableDraft: (conversationId) => {
    const slice = get().byConversation[conversationId]
    if (!slice || slice.restorableDraft === null) {
      return
    }
    set((s) => ({
      byConversation: patchSlice(s.byConversation, conversationId, { restorableDraft: null })
    }))
  }
}))
