// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import type * as QuickStartupPlan from '@/hooks/composer-state/quick-startup-plan'
import { useAppStore } from '@/store'
import { launchLandingChat } from './landing-chat-launch'

const {
  prepareQuickComposerStartupMock,
  runBackgroundWorktreeCreationMock,
  resolveAgentSessionLaunchRouteMock
} = vi.hoisted(() => ({
  prepareQuickComposerStartupMock: vi.fn(async () => ({
    prompt: 'tel me what can do\n@/tmp/notes.md',
    draftPrompt: null,
    startupPlan: null,
    backendStartup: undefined,
    telemetry: null,
    creationStartup: {
      legacy: () => ({ startupPlan: null, pasteDraftAfterLaunch: null, submitPastedPrompt: false })
    }
  })),
  runBackgroundWorktreeCreationMock: vi.fn(() => 'creation-1'),
  resolveAgentSessionLaunchRouteMock: vi.fn(() => 'structured-native-chat' as const)
}))

vi.mock('@/hooks/composer-state/quick-startup-plan', () => ({
  prepareQuickComposerStartup: prepareQuickComposerStartupMock
}))

vi.mock('@/lib/workspace/creation/worktree-creation-flow', () => ({
  runBackgroundWorktreeCreation: runBackgroundWorktreeCreationMock
}))

vi.mock('@/lib/agent-session/launch/routing/agent-session-launch-plan', () => ({
  resolveAgentSessionLaunchRoute: resolveAgentSessionLaunchRouteMock
}))

const initial = useAppStore.getInitialState()

describe('launchLandingChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState(initial, true)
  })

  afterEach(() => {
    useAppStore.setState(initial, true)
    delete (window as unknown as { api?: unknown }).api
  })

  it('auto-provisions No Repo on local send and submits directly without opening composer modal', async () => {
    const noRepo: Repo = {
      id: 'no-repo-id',
      path: '/app/no-repo-workspace',
      displayName: 'No Repo',
      badgeColor: '#599ce7',
      repoIcon: { type: 'lucide', name: 'Home' },
      isNoRepo: true,
      addedAt: 1,
      kind: 'folder'
    }
    const getNoRepoDirectory = vi.fn(async () => '/app/no-repo-workspace')
    const addRepoPath = vi.fn(async () => {
      useAppStore.setState({ repos: [noRepo] })
      return noRepo
    })
    const openModal = vi.fn()
    ;(window as unknown as { api: unknown }).api = {
      app: { getNoRepoDirectory }
    }
    useAppStore.setState({ repos: [], addRepoPath, openModal })

    const result = await launchLandingChat({
      selectedRepo: null,
      executionHostId: 'local',
      prompt: 'tel me what can do',
      attachmentPaths: ['/tmp/notes.md', '/tmp/shot.png'],
      agent: 'claude'
    })

    expect(result).toEqual({ creationId: 'creation-1', repo: noRepo })
    expect(openModal).not.toHaveBeenCalled()
    expect(getNoRepoDirectory).toHaveBeenCalledTimes(1)
    expect(addRepoPath).toHaveBeenCalledWith('/app/no-repo-workspace', 'folder', {
      displayName: 'No Repo',
      repoIcon: { type: 'lucide', name: 'Home' },
      isNoRepo: true,
      quiet: true
    })
    expect(prepareQuickComposerStartupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'no-repo-id',
        agent: 'claude',
        linkedWorkItem: null,
        note: 'tel me what can do\n@/tmp/notes.md',
        prompt: 'tel me what can do\n@/tmp/notes.md'
      })
    )
    expect(runBackgroundWorktreeCreationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'no-repo-id',
        agent: 'claude',
        displayName: 'tel me what can do',
        displayNameKind: 'generated',
        promptDelivery: 'auto-submit',
        quickPrompt: 'tel me what can do\n@/tmp/notes.md'
      }),
      { attachmentPaths: ['/tmp/notes.md', '/tmp/shot.png'] }
    )

    await launchLandingChat({
      selectedRepo: null,
      executionHostId: 'local',
      prompt: 'follow up',
      attachmentPaths: [],
      agent: 'claude'
    })

    expect(addRepoPath).toHaveBeenCalledTimes(1)
    expect(getNoRepoDirectory).toHaveBeenCalledTimes(1)
  })

  it('retains explicit prompt in prepareQuickComposerStartup even when linkedWorkItem is null', async () => {
    const { prepareQuickComposerStartup } = await vi.importActual<typeof QuickStartupPlan>(
      '@/hooks/composer-state/quick-startup-plan'
    )

    const landingResult = await prepareQuickComposerStartup({
      agent: 'antigravity',
      linkedWorkItem: null,
      note: 'test massege',
      prompt: 'test massege',
      repoId: 'no-repo-id',
      executionHostId: 'local',
      settings: undefined,
      launchHost: { kind: 'known', hostKind: 'local', platform: process.platform },
      shell: undefined,
      isRemote: false,
      telemetrySource: 'unknown',
      route: 'structured-native-chat'
    })

    expect(landingResult.prompt).toBe('test massege')
    expect(landingResult.draftPrompt).toBeNull()

    const noteOnlyResult = await prepareQuickComposerStartup({
      agent: 'antigravity',
      linkedWorkItem: null,
      note: 'workspace note only',
      repoId: 'repo-1',
      executionHostId: 'local',
      settings: undefined,
      launchHost: { kind: 'known', hostKind: 'local', platform: process.platform },
      shell: undefined,
      isRemote: false,
      telemetrySource: 'unknown',
      route: 'structured-native-chat'
    })

    expect(noteOnlyResult.prompt).toBe('')
    expect(noteOnlyResult.draftPrompt).toBeNull()
  })
})
