import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markdownMessageDirection } from '@/components/sidebar/comment-markdown-direction'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../shared/ide-agent/ide-agent-types'
import type {
  IdeEnhancePromptRequest,
  IdeEnhancePromptResult
} from '../../../../shared/ide-agent/ide-prompt-enhancer-types'

const mockAppState = {
  activeFileId: 'file-1',
  openFiles: [
    {
      id: 'file-1',
      worktreeId: 'wt-1',
      relativePath: 'src/components/LoginForm.tsx',
      filePath: '/workspace/src/components/LoginForm.tsx'
    }
  ]
}

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockAppState
  }
}))

import { useIdeAgentStore } from './ide-agent-store'
import {
  setPromptEnhancerTransportForTesting,
  useIdePromptEnhancerStore
} from './ide-prompt-enhancer-store'

function makeConversation(overrides: Partial<IdeConversation> = {}): IdeConversation {
  return {
    id: 'conv-1',
    workspaceKey: 'ws-1',
    workspacePath: '/workspace',
    title: 'Test',
    mode: 'agent',
    agentId: 'claude',
    modelId: 'claude-sonnet-4-5',
    multiAgentEnabled: false,
    followAgent: true,
    activePlanId: null,
    activeRunId: null,
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    plans: [],
    activity: [],
    fileChanges: [],
    checkpoints: [],
    commandExecutions: [],
    pendingPermissions: [],
    ...overrides
  }
}

describe('useIdePromptEnhancerStore', () => {
  let sendPromptCallCount = 0
  const originalSendPrompt = useIdeAgentStore.getState().sendPrompt

  beforeEach(() => {
    sendPromptCallCount = 0
    useIdePromptEnhancerStore.setState({ byConversation: {} })
    const conv = makeConversation()
    useIdeAgentStore.setState({
      activeConversation: conv,
      draftsByConversation: { 'conv-1': 'fix login bug in auth.ts', 'conv-2': 'other draft' },
      attachmentsByConversation: {
        'conv-1': [
          { id: 'att-1', kind: 'file', name: 'auth.ts', relativePath: 'src/auth.ts' },
          { id: 'att-2', kind: 'image', name: 'shot.png', mimeType: 'image/png' }
        ]
      },
      sendPrompt: async () => {
        sendPromptCallCount += 1
      }
    })
  })

  afterEach(() => {
    setPromptEnhancerTransportForTesting(null)
    useIdeAgentStore.setState({ sendPrompt: originalSendPrompt })
  })

  it('ignores empty prompts and prevents duplicate concurrent requests without auto-sending', async () => {
    const requests: IdeEnhancePromptRequest[] = []
    const deferred: { resolve?: (res: IdeEnhancePromptResult) => void } = {}
    setPromptEnhancerTransportForTesting({
      enhance: (req) => {
        requests.push(req)
        return new Promise((resolve) => {
          deferred.resolve = resolve
        })
      },
      cancel: async () => undefined
    })

    useIdeAgentStore.getState().setDraft('conv-1', '   ')
    await useIdePromptEnhancerStore.getState().triggerEnhance({ conversationId: 'conv-1' })
    expect(requests).toHaveLength(0)

    useIdeAgentStore.getState().setDraft('conv-1', 'fix login bug in auth.ts')
    const firstRun = useIdePromptEnhancerStore
      .getState()
      .triggerEnhance({ conversationId: 'conv-1', worktreeId: 'wt-1' })
    const duplicateRun = useIdePromptEnhancerStore
      .getState()
      .triggerEnhance({ conversationId: 'conv-1', worktreeId: 'wt-1' })
    await duplicateRun
    expect(requests).toHaveLength(1)
    expect(requests[0]?.activeFilePath).toBe('src/components/LoginForm.tsx')
    expect(requests[0]?.mentionedPaths).toEqual(['src/auth.ts'])
    expect(useIdePromptEnhancerStore.getState().byConversation['conv-1']?.status).toBe('enhancing')

    deferred.resolve?.({
      ok: true,
      requestId: requests[0]!.requestId,
      enhancedPrompt:
        'Investigate the root cause of the login failure in `src/auth.ts` and verify authentication tests pass.',
      agentId: 'claude',
      modelId: 'claude-sonnet-4-5'
    })
    await firstRun

    const slice = useIdePromptEnhancerStore.getState().byConversation['conv-1']
    expect(slice?.status).toBe('preview')
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'fix login bug in auth.ts'
    )
    expect(sendPromptCallCount).toBe(0)
  })

  it('supports Apply, normal editing, Restore original, Regenerate, Dismiss, and preserves attachments', async () => {
    const requests: IdeEnhancePromptRequest[] = []
    setPromptEnhancerTransportForTesting({
      enhance: async (req) => {
        requests.push(req)
        return {
          ok: true,
          requestId: req.requestId,
          enhancedPrompt: req.regenerate
            ? 'Regenerated structured prompt for `src/auth.ts`.'
            : 'Enhanced prompt for `src/auth.ts`.',
          agentId: req.agentId ?? 'claude',
          modelId: req.modelId ?? 'claude-sonnet-4-5'
        }
      },
      cancel: async () => undefined
    })

    await useIdePromptEnhancerStore.getState().triggerEnhance({ conversationId: 'conv-1' })
    await useIdePromptEnhancerStore.getState().regenerate({
      conversationId: 'conv-1',
      agentId: 'codex',
      modelId: 'gpt-5'
    })
    expect(requests).toHaveLength(2)
    expect(requests[1]?.regenerate).toBe(true)
    expect(requests[1]?.modelId).toBe('gpt-5')

    const preservedBefore: IdeChatAttachment[] = [
      ...(useIdeAgentStore.getState().attachmentsByConversation['conv-1'] ?? [])
    ]
    expect(useIdePromptEnhancerStore.getState().applyEnhancedPrompt('conv-1')).toBe(true)
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'Regenerated structured prompt for `src/auth.ts`.'
    )
    expect(useIdeAgentStore.getState().attachmentsByConversation['conv-1']).toEqual(preservedBefore)
    expect(sendPromptCallCount).toBe(0)

    useIdeAgentStore
      .getState()
      .setDraft('conv-1', 'Regenerated structured prompt for `src/auth.ts` + user tweak.')
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toContain('+ user tweak.')

    expect(useIdePromptEnhancerStore.getState().restoreOriginalDraft('conv-1')).toBe(true)
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'fix login bug in auth.ts'
    )

    await useIdePromptEnhancerStore.getState().triggerEnhance({ conversationId: 'conv-1' })
    useIdePromptEnhancerStore.getState().dismissPreview('conv-1')
    expect(useIdePromptEnhancerStore.getState().byConversation['conv-1']?.status).toBe('idle')
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'fix login bug in auth.ts'
    )
    expect(useIdeAgentStore.getState().draftsByConversation['conv-2']).toBe('other draft')
  })

  it('handles draft edits during enhancement, cancellation, provider failures, and RTL/LTR direction', async () => {
    const cancelledIds: string[] = []
    const deferred: { resolve?: (res: IdeEnhancePromptResult) => void } = {}
    setPromptEnhancerTransportForTesting({
      enhance: (req) =>
        new Promise((resolve) => {
          deferred.resolve = resolve
          void req
        }),
      cancel: async (requestId) => {
        cancelledIds.push(requestId)
      }
    })

    const pending = useIdePromptEnhancerStore
      .getState()
      .triggerEnhance({ conversationId: 'conv-1' })
    useIdeAgentStore.getState().setDraft('conv-1', 'newer user draft written while enhancing')
    useIdePromptEnhancerStore
      .getState()
      .notifyDraftChanged('conv-1', 'newer user draft written while enhancing')

    const reqId = useIdePromptEnhancerStore.getState().byConversation['conv-1']?.requestId ?? ''
    deferred.resolve?.({
      ok: true,
      requestId: reqId,
      enhancedPrompt: 'حسن أداء التمرير في واجهة الدردشة بدون كسر التوافقية.',
      agentId: 'claude',
      modelId: 'claude-sonnet-4-5'
    })
    await pending

    const previewSlice = useIdePromptEnhancerStore.getState().byConversation['conv-1']
    expect(previewSlice?.status).toBe('preview')
    expect(previewSlice?.draftChangedSinceRequest).toBe(true)
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'newer user draft written while enhancing'
    )
    expect(markdownMessageDirection(previewSlice?.enhancedPrompt ?? '')).toBe('rtl')
    expect(markdownMessageDirection('Refactor `IdeChatComposer.tsx` cleanly.')).toBe('ltr')

    const pendingCancel = useIdePromptEnhancerStore
      .getState()
      .regenerate({ conversationId: 'conv-1' })
    useIdePromptEnhancerStore.getState().cancelEnhancement('conv-1')
    deferred.resolve?.({
      ok: true,
      requestId: 'stale',
      enhancedPrompt: 'ignored',
      agentId: 'a',
      modelId: 'm'
    })
    await pendingCancel
    expect(cancelledIds).toHaveLength(1)
    expect(useIdePromptEnhancerStore.getState().byConversation['conv-1']?.status).toBe('cancelled')

    setPromptEnhancerTransportForTesting({
      enhance: async (req) => ({
        ok: false,
        requestId: req.requestId,
        error: 'Rate limit exceeded'
      }),
      cancel: async () => undefined
    })
    await useIdePromptEnhancerStore.getState().triggerEnhance({ conversationId: 'conv-1' })
    expect(useIdePromptEnhancerStore.getState().byConversation['conv-1']?.status).toBe('error')
    expect(useIdePromptEnhancerStore.getState().byConversation['conv-1']?.errorMessage).toBe(
      'Rate limit exceeded'
    )
    expect(useIdeAgentStore.getState().draftsByConversation['conv-1']).toBe(
      'newer user draft written while enhancing'
    )
  })
})
