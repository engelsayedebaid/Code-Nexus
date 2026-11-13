// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CouncilAgentCatalog,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import { MultiModelChatContext } from './MultiModelChatContext'
import { MultiModelChatSection } from './MultiModelChatSection'
import { MultiModelChatTranscript } from './MultiModelChatTranscript'
import { NativeChatComposerMultiModelBar } from './NativeChatComposerMultiModelBar'
import type { MultiModelChatController } from './use-multi-model-chat'

const antigravity: CouncilAgentCatalog = {
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

const claudeUnavailable: CouncilAgentCatalog = {
  id: 'claude',
  label: 'Claude Code',
  defaultModelId: 'claude-sonnet-4',
  modelSource: 'static',
  available: false,
  availabilityNote: 'Not signed in on this host',
  supportsMultipleModels: false,
  models: [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4', thinkingLevels: [] }]
}

const participants: CouncilParticipant[] = [
  {
    id: 'p1',
    agent: 'antigravity',
    label: 'Antigravity',
    model: 'gemini-2.5-pro',
    modelLabel: 'Gemini 2.5 Pro',
    role: 'Architect',
    moderator: true
  },
  {
    id: 'p2',
    agent: 'codex',
    label: 'Codex',
    model: 'gpt-5',
    modelLabel: 'GPT-5',
    role: 'Reviewer',
    moderator: false
  }
]

function makeController(
  overrides: Partial<MultiModelChatController> = {}
): MultiModelChatController {
  return {
    config: {
      mode: 'multi',
      discussionMode: 'debate',
      maxRounds: 3,
      participants,
      sharePriorContext: true
    },
    agents: [antigravity, claudeUnavailable],
    loadingAgents: false,
    probingAgentIds: [],
    catalogError: null,
    blockedReason: null,
    sharePriorContext: true,
    setMode: vi.fn(),
    setDiscussionMode: vi.fn(),
    setMaxRounds: vi.fn(),
    toggleAgent: vi.fn(),
    toggleAgentModel: vi.fn(),
    chooseModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    setModerator: vi.fn(),
    setSharePriorContext: vi.fn(),
    loadModels: vi.fn().mockResolvedValue(undefined),
    refreshCatalog: vi.fn().mockResolvedValue(undefined),
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
    sharedContext: null,
    replyTo: null,
    setReplyTarget: vi.fn(),
    clearReplyTarget: vi.fn(),
    send: vi.fn().mockResolvedValue(true),
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
  vi.restoreAllMocks()
})

describe('MultiModelChat UI behaviors', () => {
  it('hides composer discussion bar in Single Model mode and shows discussion/round/reply controls in Multi-Model', () => {
    const singleGroup = makeController({ mode: 'single' })
    const { rerender } = render(
      <MultiModelChatContext value={singleGroup}>
        <NativeChatComposerMultiModelBar />
      </MultiModelChatContext>
    )
    expect(screen.queryByLabelText('Composer fewer rounds')).toBeNull()

    const clearReplyTarget = vi.fn()
    const setMaxRounds = vi.fn()
    const multiGroup = makeController({
      mode: 'multi',
      maxRounds: 3,
      setMaxRounds,
      replyTo: { messageId: 'm2', participantLabel: 'Codex', preview: 'Add an idempotent queue.' },
      clearReplyTarget
    })
    rerender(
      <MultiModelChatContext value={multiGroup}>
        <NativeChatComposerMultiModelBar />
      </MultiModelChatContext>
    )

    fireEvent.click(screen.getByLabelText('Composer more rounds'))
    expect(setMaxRounds).toHaveBeenCalledWith(4)
    expect(screen.getByText(/Codex/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Cancel reply'))
    expect(clearReplyTarget).toHaveBeenCalledTimes(1)
  })

  it('triggers per-model selection checkboxes and shows honest unavailable provider notes in MultiModelChatSection', () => {
    const toggleAgentModel = vi.fn()
    const group = makeController({ toggleAgentModel })
    render(<MultiModelChatSection group={group} onClose={vi.fn()} />)

    const flashCheckbox = screen.getByLabelText('Antigravity Gemini 2.5 Flash')
    fireEvent.click(flashCheckbox)
    expect(toggleAgentModel).toHaveBeenCalledWith('antigravity', 'gemini-2.5-flash')
    expect(screen.getByText('Not signed in on this host')).toBeTruthy()
  })

  it('renders shared context toggle/preview, reply targeting with composer focus, and idle paused resume action', () => {
    const setSharePriorContext = vi.fn()
    const setReplyTarget = vi.fn()
    const resume = vi.fn()
    const onFocusComposer = vi.fn()
    const session: CouncilSession = {
      id: 'sess-1',
      chatId: 'chat-1',
      surface: 'chat',
      workspaceId: 'C:\\repo',
      title: 'Scale API',
      prompt: 'How to scale?',
      mode: 'debate',
      maxRounds: 3,
      participants,
      messages: [
        {
          id: 'm1',
          participantLabel: 'You',
          role: 'User',
          round: 1,
          createdAt: 1000,
          status: 'completed',
          kind: 'user',
          content: 'How should I scale Node.js?'
        },
        {
          id: 'm2',
          participantId: 'p2',
          participantLabel: 'Codex',
          provider: 'codex',
          model: 'GPT-5',
          role: 'Reviewer',
          round: 1,
          createdAt: 2000,
          status: 'completed',
          kind: 'response',
          content: 'Add an idempotent job queue.'
        }
      ],
      status: 'paused',
      currentRound: 1,
      createdAt: 1000,
      updatedAt: 2000,
      queuedUserMessages: []
    }
    const preSessionGroup = makeController({
      session: null,
      sharedContext: {
        messageCount: 2,
        preview: 'User: Previous turn with [REDACTED]'
      },
      setSharePriorContext
    })

    const { rerender } = render(
      <MultiModelChatTranscript
        group={preSessionGroup}
        priorMessages={[]}
        agent="antigravity"
        onFocusComposer={onFocusComposer}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Preview context/i }))
    expect(screen.getByText(/User: Previous turn with \[REDACTED\]/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Share earlier chat text with group'))
    expect(setSharePriorContext).toHaveBeenCalledWith(false)

    const group = makeController({
      session,
      isPaused: true,
      isRunning: false,
      sharedContext: {
        messageCount: 2,
        preview: 'User: Previous turn with [REDACTED]'
      },
      setSharePriorContext,
      setReplyTarget,
      resume
    })

    rerender(
      <MultiModelChatTranscript
        group={group}
        priorMessages={[]}
        agent="antigravity"
        onFocusComposer={onFocusComposer}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Resume/i }))
    expect(resume).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Reply to Codex/i }))
    expect(setReplyTarget).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }))
    expect(onFocusComposer).toHaveBeenCalledTimes(1)
  })
})
