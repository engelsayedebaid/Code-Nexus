import type {
  AgentPickerDraft,
  AgentPickerEntry
} from '../../../../../shared/agent-launch/picker/agent-launch-picker'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import { formatNativeChatFileReference } from '../../../../../shared/agent-image-paste'
import { isAgentInlineImagePath } from '../../../../../shared/agent-inline-image-types'
import { repoIsRemote } from '../../../../../shared/agent-launch/startup/agent-launch-remote'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import { isFolderRepo, isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import { getSuggestedCreatureName } from '@/components/sidebar/workspace-creation/naming/worktree-name-suggestions'
import { translate } from '@/i18n/i18n'
import { resolveAgentSessionLaunchRoute } from '@/lib/agent-session/launch/routing/agent-session-launch-plan'
import type { AgentLaunchRoute } from '@/lib/agent-session/launch/routing/agent-launch-routing'
import { getWorkspaceSeedName } from '@/lib/workspace/creation/new-workspace'
import { quickWorkspacePickerInputs } from '@/lib/workspace/creation/quick-workspace-agent-selection'
import { runBackgroundWorktreeCreation } from '@/lib/workspace/creation/worktree-creation-flow'
import { buildQuickCreationRequest } from '@/hooks/composer-state/quick-creation-request'
import { prepareQuickComposerStartup } from '@/hooks/composer-state/quick-startup-plan'
import {
  resolveExecutionHostAgentStartupShell,
  resolveRepoExecutionHostPlatform
} from '@/runtime/hosts/platform/execution-host-facts'
import { getLocalRepoProjectExecutionRuntimeContext } from '@/runtime/hosts/preflight/local-preflight-context'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'

const LANDING_TITLE_MAX_LENGTH = 60

export type LaunchLandingChatInput = {
  selectedRepo: Repo | null
  executionHostId: ExecutionHostId
  prompt: string
  attachmentPaths: readonly string[]
  agent: TuiAgent | null
  launchRoute?: AgentLaunchRoute
  pickerDraft?: AgentPickerDraft
  pickerEntry?: AgentPickerEntry
}

export type LaunchLandingChatResult = {
  creationId: string
  repo: Repo
}

export function findNoRepoProject(
  repos: readonly Repo[],
  executionHostId: ExecutionHostId
): Repo | null {
  return (
    repos.find(
      (repo) =>
        isFolderRepo(repo) &&
        getRepoExecutionHostId(repo) === executionHostId &&
        (repo.isNoRepo === true || repo.displayName === 'No Repo')
    ) ?? null
  )
}

export function hostSupportsLandingNoRepo(
  repos: readonly Repo[],
  hostId: ExecutionHostId
): boolean {
  return hostId === LOCAL_EXECUTION_HOST_ID || findNoRepoProject(repos, hostId) !== null
}

export async function ensureNoRepoProject(executionHostId: ExecutionHostId): Promise<Repo> {
  const existing = findNoRepoProject(useAppStore.getState().repos, executionHostId)
  if (existing) {
    return existing
  }
  if (executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    throw new Error(
      translate(
        'landing.noRepoRemoteUnsupported',
        'Switch host to This PC or choose a repository on this host to start a chat.'
      )
    )
  }
  const noRepoDir = await window.api.app.getNoRepoDirectory()
  const added = await useAppStore.getState().addRepoPath(noRepoDir, 'folder', {
    displayName: 'No Repo',
    repoIcon: { type: 'lucide', name: 'Home' },
    isNoRepo: true,
    quiet: true
  })
  const resolved = added ?? findNoRepoProject(useAppStore.getState().repos, executionHostId)
  if (!resolved) {
    throw new Error(
      translate('landing.noRepoUnavailable', 'Could not prepare the No Repo workspace.')
    )
  }
  return resolved
}

export function deriveLandingChatDisplayName(
  prompt: string,
  attachmentPaths: readonly string[]
): string | undefined {
  const singleLine = prompt.trim().replace(/\s+/g, ' ')
  if (singleLine) {
    return singleLine.length > LANDING_TITLE_MAX_LENGTH
      ? `${singleLine.slice(0, LANDING_TITLE_MAX_LENGTH - 3).trimEnd()}...`
      : singleLine
  }
  const firstPath = attachmentPaths[0]
  if (!firstPath) {
    return undefined
  }
  const baseName = firstPath.split(/[\\/]/).pop() || firstPath
  return attachmentPaths.length === 1 ? baseName : `${baseName} (+${attachmentPaths.length - 1})`
}

export function formatLandingPromptWithAttachments(
  prompt: string,
  attachmentPaths: readonly string[]
): string {
  const trimmedPrompt = prompt.trim()
  const nonImagePaths = attachmentPaths.filter((filePath) => !isAgentInlineImagePath(filePath))
  if (nonImagePaths.length === 0) {
    return trimmedPrompt
  }
  const fileRefs = nonImagePaths.map(formatNativeChatFileReference).join(' ')
  return trimmedPrompt ? `${trimmedPrompt}\n${fileRefs}` : fileRefs
}

/**
 * Starts a chat or workspace directly from Landing without opening the workspace creation modal.
 */
export async function launchLandingChat(
  input: LaunchLandingChatInput
): Promise<LaunchLandingChatResult> {
  const repo = input.selectedRepo ?? (await ensureNoRepoProject(input.executionHostId))
  const state = useAppStore.getState()
  const targetHostId = getRepoExecutionHostId(repo)
  const target = ipcOrRuntimeTargetForHostId(targetHostId)
  const launchHost = resolveRepoExecutionHostPlatform(state, repo, () =>
    getLocalRepoProjectExecutionRuntimeContext(state, repo.id)
  )
  if (launchHost.kind === 'withheld') {
    throw new Error(launchHost.reason)
  }

  const shell = resolveExecutionHostAgentStartupShell(
    launchHost,
    state.settings?.terminalWindowsShell
  )
  const selectedRepoIsGit = isGitRepoKind(repo)
  const selectedRepoIsRemote = repoIsRemote(repo)
  const effectivePrompt = formatLandingPromptWithAttachments(input.prompt, input.attachmentPaths)
  const agentNote = input.agent ? effectivePrompt : ''
  const hasImageAttachment = input.attachmentPaths.some(isAgentInlineImagePath)
  const promptDelivery = agentNote.length > 0 || hasImageAttachment ? 'auto-submit' : 'draft'
  const displayName = deriveLandingChatDisplayName(input.prompt, input.attachmentPaths)
  const fallbackName = getSuggestedCreatureName(selectWorktreesByRepo(state))
  const workspaceName = getWorkspaceSeedName({
    explicitName: '',
    prompt: input.prompt.trim() || displayName || '',
    linkedIssueNumber: null,
    linkedPR: null,
    fallbackName
  })

  const pickerInputs = input.agent
    ? quickWorkspacePickerInputs(input.pickerDraft, input.pickerEntry, targetHostId)
    : {}
  const explicitRoute = input.pickerDraft
    ? input.pickerDraft.surface === 'chat'
      ? 'structured-native-chat'
      : 'terminal-tui'
    : undefined
  const agentLaunchRoute =
    input.agent === null
      ? undefined
      : (explicitRoute ??
        input.launchRoute ??
        resolveAgentSessionLaunchRoute(state, {
          agent: input.agent,
          workspace: {
            kind: selectedRepoIsGit ? 'git-worktree' : 'folder',
            repoId: repo.id,
            executionHostId: targetHostId
          },
          prompt: agentNote,
          promptDelivery
        }))

  const quickStartup = await prepareQuickComposerStartup({
    agent: input.agent,
    linkedWorkItem: null,
    note: agentNote,
    prompt: agentNote,
    repoId: repo.id,
    executionHostId: targetHostId,
    settings: state.settings,
    launchHost,
    shell,
    isRemote: selectedRepoIsRemote,
    telemetrySource: 'unknown',
    route: agentLaunchRoute,
    launchInputs: pickerInputs.launchInputs,
    ...(pickerInputs.legacyLaunchInputs
      ? { legacyLaunchInputs: pickerInputs.legacyLaunchInputs }
      : {})
  })

  const request = buildQuickCreationRequest({
    repoId: repo.id,
    ephemeralVmRecipe: undefined,
    indeterminateProgress: target?.kind === 'environment',
    taskSourceContext: null,
    linkedWorkItem: null,
    workspaceRunContext: null,
    workspaceName,
    nameWasGenerated: true,
    displayName,
    displayNameKind: displayName ? 'generated' : undefined,
    selectedRepoIsGit,
    baseBranch: undefined,
    compareBaseRef: undefined,
    setupDecision: 'inherit',
    sparseDirectories: null,
    sparsePresetId: null,
    telemetrySource: 'unknown',
    linkedIssue: null,
    linkedPR: null,
    pushTarget: undefined,
    agent: input.agent,
    agentLaunchRoute,
    launchInputs: pickerInputs.launchInputs,
    legacyLaunchInputs: pickerInputs.legacyLaunchInputs,
    creationStartup: quickStartup.creationStartup,
    linkedLinearIssue: undefined,
    linkedLinearIssueWorkspaceId: undefined,
    linkedLinearIssueOrganizationUrlKey: undefined,
    branchNameOverride: undefined,
    parentWorktreeId: null,
    workspaceStatus: undefined,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    includeGitLabLinks: false,
    startup:
      agentLaunchRoute === 'structured-native-chat' ? undefined : quickStartup.backendStartup,
    pendingFirstAgentMessageRename:
      Boolean(input.agent && (input.prompt.trim() || input.attachmentPaths.length > 0)) &&
      state.settings?.autoRenameBranchFromWork === true,
    note: agentNote,
    startupPlan: quickStartup.startupPlan,
    quickPrompt: quickStartup.prompt,
    launchDraftPrompt: quickStartup.draftPrompt ?? undefined,
    promptDelivery,
    quickTelemetry: quickStartup.telemetry,
    suppressTerminalFocusOnCompletion: false,
    setupOnly: false
  })

  const creationId = runBackgroundWorktreeCreation(
    request,
    input.attachmentPaths.length > 0 ? { attachmentPaths: input.attachmentPaths } : undefined
  )
  return { creationId, repo }
}
