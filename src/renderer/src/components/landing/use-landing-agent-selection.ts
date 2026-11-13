import { useCallback, useMemo, useState } from 'react'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import type {
  AgentPickerDraft,
  AgentPickerEntry,
  AgentPickerSurface
} from '../../../../shared/agent-launch/picker/agent-launch-picker'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/repo-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAgentMenuObservation } from '@/components/tab-bar/use-new-tab-agent-menu-rows'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { agentChoicePending } from '@/lib/agent-session/launch/inventory/host-chat-program'
import { useAgentsOfferedForLaunch } from '@/lib/agent-session/launch/inventory/host-chat-program-acquisition'
import {
  composerLaunchWorkspace,
  pickQuickWorkspaceAgent,
  resolveQuickWorkspaceAgentSelection
} from '@/lib/workspace/creation/quick-workspace-agent-selection'
import { useAppStore } from '@/store'

type LandingQuickAgentPick = {
  agent: TuiAgent | null
  surface?: AgentPickerSurface
  draft?: AgentPickerDraft
  entry?: AgentPickerEntry
  contextKey: string
}

export function useLandingAgentSelection(input: {
  settings: GlobalSettings | null | undefined
  selectedRepo: Repo | null
  effectiveHostId: ExecutionHostId
}) {
  const { settings, selectedRepo, effectiveHostId } = input
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [quickAgentOverride, setQuickAgentOverride] = useState<TuiAgent | null | undefined>(
    undefined
  )
  const [quickAgentPick, setQuickAgentPick] = useState<LandingQuickAgentPick>({
    agent: null,
    contextKey: ''
  })

  const parsedHost = useMemo(() => parseExecutionHostId(effectiveHostId), [effectiveHostId])
  const detectionTarget = useMemo<AgentDetectionTarget>(() => {
    if (parsedHost?.kind === 'runtime') {
      return { kind: 'runtime', environmentId: parsedHost.environmentId }
    }
    if (parsedHost?.kind === 'ssh') {
      return { kind: 'ssh', connectionId: parsedHost.targetId }
    }
    return { kind: 'local' }
  }, [parsedHost])

  const agentMenuTarget = useMemo(
    () => ({
      workspace: {
        kind: (selectedRepo && isGitRepoKind(selectedRepo) ? 'git-worktree' : 'folder') as
          | 'git-worktree'
          | 'folder',
        ...(selectedRepo ? { repoId: selectedRepo.id } : {}),
        ...(parsedHost?.kind === 'runtime'
          ? { runtimeEnvironmentId: parsedHost.environmentId }
          : {}),
        executionHostId: effectiveHostId
      }
    }),
    [effectiveHostId, parsedHost, selectedRepo]
  )

  const observation = useAgentMenuObservation(agentMenuTarget, true, detectionTarget, {
    wakeOnOpen: agentMenuOpen
  })
  const detectedAgentIds = useMemo<Set<TuiAgent> | null>(
    () => (observation.detection.detectedIds ? new Set(observation.detection.detectedIds) : null),
    [observation.detection.detectedIds]
  )
  const selectedRepoIsGit = selectedRepo ? isGitRepoKind(selectedRepo) : false
  const launchWorkspace = useMemo(
    () =>
      composerLaunchWorkspace({
        repoId: selectedRepo?.id ?? null,
        selectedRepoIsGit,
        selectedRepoExecutionHostId: effectiveHostId
      }),
    [effectiveHostId, selectedRepo?.id, selectedRepoIsGit]
  )
  const offeredAgentIds = useAgentsOfferedForLaunch(launchWorkspace, detectedAgentIds)
  const detectedList = observation.detection.detectedIds
  const choicePending = (agent: TuiAgent): boolean =>
    agentChoicePending(useAppStore.getState(), agent, launchWorkspace, detectedList)
  const preferredQuickAgent = pickQuickWorkspaceAgent(
    settings?.defaultTuiAgent,
    detectedAgentIds,
    settings?.disabledTuiAgents,
    offeredAgentIds,
    choicePending
  )
  const { quickAgent } = resolveQuickWorkspaceAgentSelection({
    quickAgentOverride,
    preferredQuickAgent,
    detectedAgentIds,
    offeredAgentIds,
    selectedChoiceUnresolved: Boolean(quickAgentOverride && choicePending(quickAgentOverride))
  })
  const pickerMatchesContext =
    quickAgentPick.agent === quickAgent && quickAgentPick.contextKey === observation.contextKey
  const pickerDraft = pickerMatchesContext ? quickAgentPick.draft : undefined
  const pickerEntry = pickerMatchesContext ? quickAgentPick.entry : undefined
  const quickAgentSurface = quickAgentPick.agent === quickAgent ? quickAgentPick.surface : undefined
  const launchSelection = observation.selectionFor(quickAgent, quickAgentSurface)

  const handleQuickAgentPick = useCallback(
    (
      agent: TuiAgent,
      draft?: AgentPickerDraft,
      entry?: AgentPickerEntry,
      surface?: AgentPickerSurface
    ) => {
      setQuickAgentOverride(agent)
      setQuickAgentPick({ agent, surface, draft, entry, contextKey: observation.contextKey })
    },
    [observation.contextKey]
  )

  const handleSelectBlankTerminal = useCallback(() => {
    setQuickAgentOverride(null)
    setQuickAgentPick({ agent: null, contextKey: observation.contextKey })
  }, [observation.contextKey])

  return {
    observation,
    quickAgent,
    pickerDraft,
    pickerEntry,
    launchSelection,
    setAgentMenuOpen,
    handleQuickAgentPick,
    handleSelectBlankTerminal
  }
}
