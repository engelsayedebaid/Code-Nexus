// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CouncilAgentCatalog,
  CouncilParticipant,
  CouncilSession
} from '../../../../../shared/council/council-contract'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { AppState } from '@/store/types'
import { multiModelChatScopeFor } from './multi-model-chat-scope'
import {
  MULTI_MODEL_CHAT_CONFIG_KEY,
  MULTI_MODEL_CHAT_SESSIONS_KEY,
  clampGroupRounds,
  defaultGroupParticipants,
  loadMultiModelChatConfig,
  loadMultiModelChatSession,
  newGroupSession,
  participantFromCatalog,
  roundsForDiscussion,
  saveMultiModelChatConfig,
  saveMultiModelChatSession,
  toggleParticipantFromCatalog,
  validateGroupParticipants
} from './multi-model-chat-state'

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
  },
  {
    id: 'gemini',
    label: 'Gemini',
    defaultModelId: 'pro',
    modelSource: 'static',
    models: [{ id: 'pro', label: 'Pro' }]
  }
]

const participants = agents
  .slice(0, 2)
  .map((agent, index) => participantFromCatalog(agent, undefined, index))

afterEach(() => {
  localStorage.clear()
})

describe('inline multi-model chat state', () => {
  it('keeps config per chat and never writes the Council workspace key', () => {
    saveMultiModelChatConfig('chat-a', {
      mode: 'multi',
      discussionMode: 'code-review',
      maxRounds: 4,
      participants
    })

    expect(loadMultiModelChatConfig('chat-a')).toMatchObject({
      mode: 'multi',
      discussionMode: 'code-review',
      maxRounds: 4
    })
    expect(loadMultiModelChatConfig('chat-b')).toMatchObject({
      mode: 'single',
      discussionMode: 'debate',
      participants: []
    })
    expect(localStorage.getItem('code-nexus.council.sessions.v1')).toBeNull()
    expect(localStorage.getItem(MULTI_MODEL_CHAT_CONFIG_KEY)).toContain('chat-a')
  })

  it('restores a group transcript by chat scope from its own storage key', () => {
    const session: CouncilSession = newGroupSession({
      chatId: 'chat-a',
      worktreePath: '/repo',
      participants,
      mode: 'parallel',
      maxRounds: 6
    })
    saveMultiModelChatSession(session)

    expect(loadMultiModelChatSession('chat-a')?.id).toBe(session.id)
    expect(loadMultiModelChatSession('chat-b')).toBeNull()
    expect(localStorage.getItem(MULTI_MODEL_CHAT_SESSIONS_KEY)).toContain(session.id)
    expect(localStorage.getItem('code-nexus.council.sessions.v1')).toBeNull()
  })

  it('clamps rounds, locks Parallel to one round, and seeds a valid group', () => {
    expect(clampGroupRounds(0)).toBe(1)
    expect(clampGroupRounds(99)).toBe(6)
    expect(roundsForDiscussion('parallel', 6)).toBe(1)
    expect(roundsForDiscussion('debate', 6)).toBe(6)

    const seeded = defaultGroupParticipants(agents)
    expect(seeded).toHaveLength(3)
    expect(seeded.filter((member) => member.moderator)).toHaveLength(1)
    expect(validateGroupParticipants(seeded, agents)).toBeNull()
  })

  it('adds each provider once and keeps one moderator after removal', () => {
    const first = toggleParticipantFromCatalog([], agents[0]!)
    const both = toggleParticipantFromCatalog(first, agents[1]!)
    expect(both.map((member) => member.agent)).toEqual(['codex', 'claude'])
    expect(both[0]?.moderator).toBe(true)

    const removedModerator = toggleParticipantFromCatalog(both, agents[0]!)
    expect(removedModerator.map((member) => member.agent)).toEqual(['claude'])
    expect(removedModerator[0]?.moderator).toBe(true)

    expect(toggleParticipantFromCatalog(both, agents[0]!).map((member) => member.agent)).toEqual([
      'claude'
    ])
  })

  it('explains unavailable providers instead of silently starting a run', () => {
    const unavailable: CouncilAgentCatalog = {
      ...agents[0]!,
      available: false,
      availabilityNote: 'Codex CLI is not signed in.'
    }
    const group: CouncilParticipant[] = [
      participantFromCatalog(unavailable, undefined, 0),
      participantFromCatalog(agents[1]!, undefined, 1)
    ]
    expect(validateGroupParticipants(group, [unavailable, agents[1]!])).toBe(
      'Codex CLI is not signed in.'
    )
  })
})

describe('multiModelChatScopeFor', () => {
  it('resolves structured native chats inside local folder workspaces and floating sessions', () => {
    const state = {
      tabsByWorktree: {},
      unifiedTabsByWorktree: {
        'folder:f-1': [{ id: 'tab-folder', entityId: 'sess-1', contentType: 'agent-session' }],
        [FLOATING_TERMINAL_WORKTREE_ID]: [
          {
            id: 'tab-floating',
            entityId: 'sess-float',
            contentType: 'agent-session',
            agentSessionAgent: 'codex'
          }
        ]
      },
      folderWorkspaces: [
        {
          id: 'f-1',
          name: 'test',
          folderPath: '/folders/test',
          connectionId: null,
          executionHostId: 'local'
        }
      ],
      worktreesByRepo: {},
      structuredSessionLaunchDirectoryByTabId: {
        'tab-floating': { sessionId: 'sess-float', launchDirectory: '/tmp/floating-chat' }
      }
    } as unknown as AppState

    expect(multiModelChatScopeFor(state, 'tab-folder')).toEqual({
      chatId: 'tab-folder',
      worktreeId: 'folder:f-1',
      worktreePath: '/folders/test'
    })
    expect(multiModelChatScopeFor(state, 'tab-floating')).toEqual({
      chatId: 'tab-floating',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      worktreePath: '/tmp/floating-chat'
    })
  })

  it('refuses remote execution hosts even when a folder workspace exists', () => {
    const state = {
      tabsByWorktree: {},
      unifiedTabsByWorktree: {
        'folder:f-remote': [
          {
            id: 'tab-remote',
            entityId: 'sess-r',
            contentType: 'agent-session',
            executionHostId: 'ssh:prod-box'
          }
        ]
      },
      folderWorkspaces: [
        {
          id: 'f-remote',
          name: 'remote-test',
          folderPath: '/srv/test',
          connectionId: 'conn-1'
        }
      ],
      worktreesByRepo: {}
    } as unknown as AppState

    expect(multiModelChatScopeFor(state, 'tab-remote')).toEqual({
      chatId: 'tab-remote',
      worktreeId: 'folder:f-remote',
      worktreePath: null
    })
  })
})
