// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CouncilAgentCatalog,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import {
  buildMultiModelSharedContext,
  describeMultiModelSharedContext
} from './multi-model-chat-context'
import {
  DEFAULT_MULTI_MODEL_CHAT_CONFIG,
  formatParticipantMentionToken,
  loadMultiModelChatConfig,
  loadMultiModelChatSession,
  matchingGroupMentionParticipants,
  saveMultiModelChatConfig,
  saveMultiModelChatSession,
  toggleAgentModelFromCatalog
} from './multi-model-chat-state'

const antigravityAgent: CouncilAgentCatalog = {
  id: 'antigravity',
  label: 'Antigravity',
  defaultModelId: 'gemini-2.5-pro',
  modelSource: 'static',
  available: true,
  supportsMultipleModels: true,
  models: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', thinkingLevels: [] },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', thinkingLevels: [] }
  ]
}

const codexAgent: CouncilAgentCatalog = {
  id: 'codex',
  label: 'Codex',
  defaultModelId: 'gpt-5',
  modelSource: 'static',
  available: true,
  supportsMultipleModels: false,
  models: [
    { id: 'gpt-5', label: 'GPT-5', thinkingLevels: [] },
    { id: 'o4-mini', label: 'o4-mini', thinkingLevels: [] }
  ]
}

afterEach(() => {
  localStorage.clear()
})

describe('multi-model group state, shared context, and mention matching', () => {
  it('supports selecting multiple models from one provider when supported and swaps single-model agents', () => {
    let list: CouncilParticipant[] = []
    list = toggleAgentModelFromCatalog(list, antigravityAgent, 'gemini-2.5-pro')
    list = toggleAgentModelFromCatalog(list, antigravityAgent, 'gemini-2.5-flash')
    expect(list.map((p) => `${p.agent}:${p.model}`)).toEqual([
      'antigravity:gemini-2.5-pro',
      'antigravity:gemini-2.5-flash'
    ])
    expect(list[0]?.moderator).toBe(true)

    // Removing moderator promotes next participant to moderator.
    list = toggleAgentModelFromCatalog(list, antigravityAgent, 'gemini-2.5-pro')
    expect(list.map((p) => p.model)).toEqual(['gemini-2.5-flash'])
    expect(list[0]?.moderator).toBe(true)

    // Single-model provider replaces its prior selection.
    list = toggleAgentModelFromCatalog(list, codexAgent, 'gpt-5')
    list = toggleAgentModelFromCatalog(list, codexAgent, 'o4-mini')
    expect(list.filter((p) => p.agent === 'codex').map((p) => p.model)).toEqual(['o4-mini'])
  })

  it('redacts sensitive tokens in shared single-to-multi context and excludes tool-only items', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        source: 'transcript',
        timestamp: 1,
        blocks: [
          {
            type: 'text',
            text: 'Use key sk-proj-secret1234567890abcdef and Bearer myjwtvalue9999999'
          }
        ]
      },
      {
        id: 't1',
        role: 'tool',
        source: 'transcript',
        timestamp: 2,
        blocks: [{ type: 'tool-call', name: 'read_file', input: { path: 'a.ts' } }]
      },
      {
        id: 'a1',
        role: 'assistant',
        source: 'transcript',
        timestamp: 3,
        blocks: [
          {
            type: 'text',
            text: 'Use key AIzaSySecretKeyValue1234567890123456 for staging.'
          }
        ]
      }
    ] as unknown as NativeChatMessage[]

    const summary = describeMultiModelSharedContext(messages)
    expect(summary?.messageCount).toBe(2)
    expect(summary?.preview).toContain('[REDACTED]')
    expect(summary?.preview).not.toContain('sk-proj-secret1234567890abcdef')
    expect(summary?.preview).not.toContain('myjwtvalue9999999')
    expect(summary?.preview).not.toContain('AIzaSySecretKeyValue1234567890123456')

    const note = buildMultiModelSharedContext(messages)
    expect(note).toContain('Use key [REDACTED]')
    expect(note).not.toContain('AIzaSySecretKeyValue1234567890123456')
  })

  it('restores config and sessions by primary sessionId with tabId fallback', () => {
    const saved = {
      ...DEFAULT_MULTI_MODEL_CHAT_CONFIG,
      mode: 'multi' as const,
      discussionMode: 'code-review' as const,
      maxRounds: 4
    }
    saveMultiModelChatConfig('tab-fallback-1', saved)
    expect(loadMultiModelChatConfig('session-primary-1', 'tab-fallback-1').discussionMode).toBe(
      'code-review'
    )

    const storedSession: CouncilSession = {
      id: 'grp-1',
      chatId: 'tab-fallback-1',
      surface: 'chat',
      workspaceId: 'C:\\repo',
      title: 'Review',
      prompt: 'Audit',
      mode: 'debate',
      maxRounds: 3,
      participants: [],
      messages: [],
      status: 'completed',
      currentRound: 2,
      createdAt: 1,
      updatedAt: 2,
      queuedUserMessages: []
    }
    saveMultiModelChatSession(storedSession)
    expect(loadMultiModelChatSession('session-primary-1', 'tab-fallback-1')?.id).toBe('grp-1')
  })

  it('formats participant mention tokens with quotes for labels with whitespace or punctuation', () => {
    const participant: CouncilParticipant = {
      id: 'p1',
      agent: 'antigravity',
      label: 'Antigravity (Gemini)',
      model: 'gemini-2.5-pro',
      modelLabel: 'Gemini 2.5 Pro',
      role: 'Architect',
      moderator: true
    }
    expect(formatParticipantMentionToken(participant, [participant])).toBe(
      '@"Antigravity (Gemini)"'
    )
    const matched = matchingGroupMentionParticipants([participant], 'gem')
    expect(matched).toHaveLength(1)
    expect(matched[0]?.mentionToken).toBe('@"Antigravity (Gemini)"')
  })
})
