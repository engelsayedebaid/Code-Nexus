// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import {
  buildCouncilDecisionPrompt,
  buildCouncilTurnPrompt,
  messageTargetsParticipant
} from './council-prompts'
import { selectRoundParticipants } from './council-session-execution'
import {
  formatCouncilSessionExport,
  loadCouncilSessions,
  sanitizeCouncilExportText
} from './council-session-storage'

const participants: CouncilParticipant[] = [
  {
    id: 'p1',
    agent: 'codex',
    label: 'Codex',
    model: 'gpt-5',
    modelLabel: 'GPT-5',
    role: 'Software Architect',
    moderator: true
  },
  {
    id: 'p2',
    agent: 'claude',
    label: 'Claude Code',
    model: 'claude-sonnet-4',
    modelLabel: 'Claude Sonnet 4',
    role: 'Security Auditor',
    moderator: false
  },
  {
    id: 'p3',
    agent: 'opencode',
    label: 'OpenCode',
    model: 'opencode/big-pickle',
    modelLabel: 'Big Pickle',
    role: 'Performance & Reliability Reviewer',
    moderator: false
  }
]

afterEach(() => {
  localStorage.clear()
})

describe('Nexus AI Council routing and persistence', () => {
  it('routes multi-@mention interventions to the union of mentioned members', () => {
    expect(selectRoundParticipants(participants, []).map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(
      selectRoundParticipants(participants, ['@Codex verify types', '@Claude verify auth']).map(
        (p) => p.id
      )
    ).toEqual(['p1', 'p2'])
    expect(
      selectRoundParticipants(participants, ['@Claude-Code check XSS']).map((p) => p.id)
    ).toEqual(['p2'])
    expect(selectRoundParticipants(participants, ['@Unknown review all']).map((p) => p.id)).toEqual(
      ['p1', 'p2', 'p3']
    )
  })

  it('redacts secrets and API tokens from Markdown and JSON exports', () => {
    const raw =
      'Key: sk-proj-abcdefghijklmnopqrstuvwxyz123456\nGoogle: AIzaSyDummyKeyValue123456789012345\nAuthorization: Bearer my-secret-jwt-token-value\nOPENAI_API_KEY=secretvalue12345'
    const sanitized = sanitizeCouncilExportText(raw)
    expect(sanitized).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(sanitized).not.toContain('AIzaSyDummyKeyValue123456789012345')
    expect(sanitized).not.toContain('my-secret-jwt-token-value')
    expect(sanitized).not.toContain('secretvalue12345')
    expect(sanitized).toContain('[REDACTED]')

    const session: CouncilSession = {
      id: 's1',
      workspaceId: 'w1',
      title: 'Security review',
      prompt: 'Check ghp_1234567890abcdefghij123456',
      mode: 'consensus',
      maxRounds: 2,
      participants,
      messages: [
        {
          id: 'm1',
          participantId: 'p1',
          participantLabel: 'Codex',
          provider: 'codex',
          model: 'GPT-5',
          role: 'Software Architect',
          round: 1,
          createdAt: 1,
          status: 'completed',
          kind: 'response',
          content: 'Found leaked header Authorization: Bearer supersecret99999'
        }
      ],
      status: 'completed',
      currentRound: 2,
      finalDecision: 'Rotate API_KEY=verysecretkey123 immediately',
      createdAt: 1,
      updatedAt: 2,
      queuedUserMessages: []
    }

    const mdExport = formatCouncilSessionExport(session, 'markdown')
    expect(mdExport).not.toContain('ghp_1234567890abcdefghij123456')
    expect(mdExport).not.toContain('supersecret99999')
    expect(mdExport).toContain('[REDACTED]')

    const jsonExport = formatCouncilSessionExport(session, 'json')
    expect(jsonExport).not.toContain('verysecretkey123')
    expect(jsonExport).not.toContain('supersecret99999')
  })

  it('normalizes interrupted running sessions on load from storage', () => {
    const stale: CouncilSession = {
      id: 'stale-1',
      workspaceId: 'w1',
      title: 'Stale',
      prompt: 'Prompt',
      mode: 'debate',
      maxRounds: 2,
      participants,
      messages: [
        {
          id: 'm1',
          participantId: 'p1',
          participantLabel: 'Codex',
          provider: 'codex',
          model: 'GPT-5',
          role: 'Software Architect',
          round: 1,
          createdAt: 1,
          status: 'processing',
          kind: 'response',
          content: ''
        }
      ],
      status: 'running',
      currentRound: 1,
      createdAt: 1,
      updatedAt: 2,
      queuedUserMessages: []
    }
    localStorage.setItem('code-nexus.council.sessions.v1', JSON.stringify([stale]))
    const loaded = loadCouncilSessions()
    expect(loaded[0]?.status).toBe('stopped')
    expect(loaded[0]?.messages[0]?.status).toBe('cancelled')
  })

  it('matches quoted participant mentions and ignores @file paths', () => {
    const gemini: CouncilParticipant = {
      id: 'p-gem',
      agent: 'antigravity',
      label: 'Gemini (Pro)',
      model: 'gemini-2.5-pro',
      modelLabel: 'Gemini 2.5 Pro',
      role: 'Architect',
      moderator: false
    }
    expect(messageTargetsParticipant('@"Gemini (Pro)" check this', gemini)).toBe(true)
    expect(
      selectRoundParticipants(
        [...participants, gemini],
        ['@"Gemini (Pro)" Inspect @src/renderer/main.ts']
      ).map((p) => p.id)
    ).toEqual(['p-gem'])
    // File paths like @codex.ts or @my-dir/codex must not narrow the group to Codex alone.
    expect(
      selectRoundParticipants([...participants, gemini], ['Inspect @codex.ts and @my-dir/codex'])
        .length
    ).toBe(4)
  })

  it('builds code-review non-invention and consensus 7-section prompts', () => {
    const reviewPrompt = buildCouncilTurnPrompt({
      originalPrompt: 'Audit auth flow',
      mode: 'code-review',
      participant: participants[0]!,
      round: 1,
      messages: [],
      queuedUserMessages: []
    })
    expect(reviewPrompt).toContain('never invent file inspection results')
    expect(reviewPrompt).toContain('Discussion mode: code-review')

    const decisionPrompt = buildCouncilDecisionPrompt({
      originalPrompt: 'Pick a queue architecture',
      mode: 'consensus',
      messages: [
        {
          id: 'm1',
          participantId: 'p1',
          participantLabel: 'Codex',
          provider: 'codex',
          model: 'GPT-5',
          role: 'Software Architect',
          round: 1,
          createdAt: 1,
          status: 'completed',
          kind: 'response',
          content: 'Use BullMQ with idempotency keys.'
        }
      ]
    })
    for (const heading of [
      'Recommended solution',
      'Agreement points',
      'Remaining disagreements',
      'Technical trade-offs',
      'Risks',
      'Evidence',
      'Next steps'
    ]) {
      expect(decisionPrompt).toContain(heading)
    }
    expect(decisionPrompt).toContain('never fabricate agreement where participants disagreed')
    expect(decisionPrompt).toContain('never claim that consensus guarantees correctness')
  })
})
