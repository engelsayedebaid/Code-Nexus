import { describe, expect, it } from 'vitest'
import type {
  CouncilAgentCatalog,
  CouncilMessage,
  CouncilParticipant
} from '../../../../shared/council/council-contract'
import { toggleAgentModelFromCatalog } from '../native-chat/group-chat/multi-model-chat-mutations'
import { buildCouncilTurnPrompt } from './council-prompts'
import {
  orderRoundParticipantsForDialogue,
  resolveSequentialReplyTarget
} from './council-dialogue-turn'

const participants: CouncilParticipant[] = [
  {
    id: 'p1',
    agent: 'opencode',
    label: 'OpenCode',
    model: 'glm-5',
    modelLabel: 'Glm 5',
    role: 'Software Architect',
    moderator: true
  },
  {
    id: 'p2',
    agent: 'antigravity',
    label: 'Antigravity',
    model: 'gemini-4',
    modelLabel: 'Gemini 4',
    role: 'Backend Engineer',
    moderator: false
  }
]

describe('multi-model dialogue flow', () => {
  it('avoids back-to-back self-replies across rounds and links live peer replies', () => {
    const completed: CouncilMessage[] = [
      {
        id: 'u1',
        participantLabel: 'You',
        role: 'User',
        round: 1,
        createdAt: 1,
        status: 'completed',
        kind: 'user',
        content: 'Neon vs Supabase?'
      },
      {
        id: 'm1',
        participantId: 'p1',
        participantLabel: 'OpenCode',
        provider: 'opencode',
        model: 'Glm 5',
        role: 'Software Architect',
        round: 1,
        createdAt: 2,
        status: 'completed',
        kind: 'response',
        content: 'Neon shines for branching.'
      }
    ]

    expect(orderRoundParticipantsForDialogue(participants, completed).map((p) => p.id)).toEqual([
      'p2',
      'p1'
    ])

    expect(
      resolveSequentialReplyTarget({
        completedMessages: completed,
        participantId: 'p2',
        isFirstSpeakerInUserTurn: false
      })
    ).toEqual({ label: 'OpenCode', messageId: 'm1' })

    expect(
      resolveSequentialReplyTarget({
        completedMessages: [completed[0]!],
        participantId: 'p1',
        isFirstSpeakerInUserTurn: true
      })
    ).toBeUndefined()
  })

  it('keeps the speaker’s own earlier replies in the dialogue transcript and targets the prior speaker', () => {
    const history: CouncilMessage[] = [
      {
        id: 'u1',
        participantLabel: 'You',
        role: 'User',
        round: 1,
        createdAt: 1,
        status: 'completed',
        kind: 'user',
        content: 'Compare Neon and Supabase'
      },
      {
        id: 'm1',
        participantId: 'p1',
        participantLabel: 'OpenCode',
        provider: 'opencode',
        model: 'Glm 5',
        role: 'Software Architect',
        round: 1,
        createdAt: 2,
        status: 'completed',
        kind: 'response',
        content: 'Start with Supabase if you want auth built in.'
      },
      {
        id: 'm2',
        participantId: 'p2',
        participantLabel: 'Antigravity',
        provider: 'antigravity',
        model: 'Gemini 4',
        role: 'Backend Engineer',
        round: 2,
        createdAt: 3,
        status: 'completed',
        kind: 'response',
        content: 'Fair, though Neon branching beats Supabase on ephemeral previews.',
        replyToLabel: 'OpenCode'
      }
    ]

    const prompt = buildCouncilTurnPrompt({
      originalPrompt: 'Compare Neon and Supabase',
      mode: 'debate',
      round: 2,
      participant: participants[0]!,
      participants,
      replyToLabel: 'Antigravity',
      isOpeningRound: false,
      messages: history,
      queuedUserMessages: []
    })

    expect(prompt).toContain('OpenCode (You earlier · Round 1)')
    expect(prompt).toContain('Start with Supabase if you want auth built in.')
    expect(prompt).toContain('responding right after Antigravity')
  })

  it('picks an unused role when removing an earlier model and adding a new one', () => {
    const catalog: CouncilAgentCatalog = {
      id: 'claude',
      label: 'Claude',
      defaultModelId: 'sonnet',
      modelSource: 'static',
      models: [{ id: 'sonnet', label: 'Sonnet' }]
    }
    const onlySecond = [participants[1]!]
    const updated = toggleAgentModelFromCatalog(onlySecond, catalog, 'sonnet')
    expect(updated).toHaveLength(2)
    expect(new Set(updated.map((p) => p.role)).size).toBe(2)
  })
})
