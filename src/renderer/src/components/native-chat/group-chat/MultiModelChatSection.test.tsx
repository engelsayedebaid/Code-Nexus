// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CouncilAgentCatalog,
  CouncilParticipant
} from '../../../../../shared/council/council-contract'
import { render } from '../messages/actions/native-chat-tooltip-test-harness'
import { MultiModelChatSection } from './MultiModelChatSection'
import { MultiModelChatTranscript } from './MultiModelChatTranscript'
import type { MultiModelChatController } from './use-multi-model-chat'

const agents: CouncilAgentCatalog[] = [
  {
    id: 'codex',
    label: 'Codex',
    defaultModelId: 'gpt-5',
    modelSource: 'static',
    models: [{ id: 'gpt-5', label: 'GPT-5' }]
  },
  {
    id: 'claude',
    label: 'Claude Code',
    defaultModelId: 'sonnet',
    modelSource: 'static',
    models: [{ id: 'sonnet', label: 'Sonnet' }]
  }
]

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
    model: 'sonnet',
    modelLabel: 'Sonnet',
    role: 'Security Engineer',
    moderator: false
  }
]

function stubController(
  overrides: Partial<MultiModelChatController> = {}
): MultiModelChatController {
  return {
    config: {
      mode: 'multi',
      discussionMode: 'debate',
      maxRounds: 3,
      participants
    },
    agents,
    loadingAgents: false,
    catalogError: null,
    blockedReason: null,
    setMode: vi.fn(),
    setDiscussionMode: vi.fn(),
    setMaxRounds: vi.fn(),
    toggleAgent: vi.fn(),
    chooseModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setModerator: vi.fn(),
    loadModels: vi.fn(),
    chatId: 'chat-1',
    mode: 'multi',
    discussionMode: 'debate',
    maxRounds: 3,
    participants,
    session: null,
    isRunning: false,
    isPaused: false,
    notice: null,
    dismissNotice: vi.fn(),
    send: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    requestDecision: vi.fn(),
    continueDiscussion: vi.fn(),
    ...overrides
  }
}

afterEach(() => {
  cleanup()
})

describe('multi-model chat controls in the composer dropdown', () => {
  it('offers single and multi modes, the installed providers, the four discussion modes and rounds', () => {
    const group = stubController()
    const onClose = vi.fn()
    render(<MultiModelChatSection group={group} onClose={onClose} />)

    expect(screen.getByRole('button', { name: 'Single Model' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Multi-Model' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('textbox', { name: 'Search multi-model providers' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Codex/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Claude Code/ })).toBeInTheDocument()
    for (const mode of ['Parallel', 'Debate', 'Code Review', 'Consensus']) {
      expect(screen.getByRole('button', { name: mode })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'More rounds' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fewer rounds' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('routes the person’s choices to the group settings', () => {
    const group = stubController()
    render(<MultiModelChatSection group={group} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Single Model' }))
    expect(group.setMode).toHaveBeenCalledWith('single')

    fireEvent.click(screen.getByRole('button', { name: 'Code Review' }))
    expect(group.setDiscussionMode).toHaveBeenCalledWith('code-review')

    fireEvent.click(screen.getByRole('button', { name: 'More rounds' }))
    expect(group.setMaxRounds).toHaveBeenCalledWith(4)
  })
})

describe('multi-model chat timeline', () => {
  it('shows every participant turn with its provider, round and reply attribution', () => {
    const group = stubController({
      isRunning: true,
      session: {
        id: 's1',
        chatId: 'chat-1',
        surface: 'chat',
        workspaceId: '/repo',
        title: 'Multi-model chat',
        prompt: 'Review the auth change',
        mode: 'debate',
        maxRounds: 3,
        participants,
        messages: [
          {
            id: 'm1',
            participantLabel: 'You',
            role: 'User',
            round: 1,
            createdAt: 1_700_000_000_000,
            status: 'completed',
            kind: 'user',
            content: 'Review the auth change'
          },
          {
            id: 'm2',
            participantId: 'p1',
            participantLabel: 'Codex',
            provider: 'codex',
            model: 'GPT-5',
            role: 'Software Architect',
            round: 1,
            createdAt: 1_700_000_001_000,
            status: 'completed',
            kind: 'response',
            content: 'The session cookie is not rotated.'
          },
          {
            id: 'm3',
            participantId: 'p2',
            participantLabel: 'Claude Code',
            provider: 'claude',
            model: 'Sonnet',
            role: 'Security Engineer',
            round: 2,
            createdAt: 1_700_000_002_000,
            status: 'processing',
            kind: 'response',
            content: '',
            replyToLabel: 'Codex'
          }
        ],
        status: 'running',
        currentRound: 2,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_002_000,
        queuedUserMessages: []
      }
    })
    render(<MultiModelChatTranscript group={group} priorMessages={[]} agent={null} />)

    expect(screen.getByText('Review the auth change')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('The session cookie is not rotated.')).toBeInTheDocument()
    expect(screen.getByText('Replying to Codex')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('offers the final decision and a continued discussion once the group is idle', () => {
    const group = stubController({
      session: {
        id: 's2',
        chatId: 'chat-1',
        surface: 'chat',
        workspaceId: '/repo',
        title: 'Multi-model chat',
        prompt: 'Review the auth change',
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
            createdAt: 1_700_000_001_000,
            status: 'completed',
            kind: 'response',
            content: 'Rotate the session cookie.'
          }
        ],
        status: 'completed',
        currentRound: 1,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        queuedUserMessages: []
      }
    })
    render(<MultiModelChatTranscript group={group} priorMessages={[]} agent={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Request final decision' }))
    expect(group.requestDecision).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue discussion' }))
    expect(group.continueDiscussion).toHaveBeenCalled()
  })
})
