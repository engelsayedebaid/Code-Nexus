import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { buildExecutionHostRegistry } from '../../../../shared/execution-host/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { getNewWorkspaceDialogEligibleRepos } from '../../../../shared/new-workspace-dialog-repo'
import type { Repo } from '../../../../shared/repo-types'
import { useLandingAgentSelection } from '@/components/landing/use-landing-agent-selection'
import {
  hostSupportsLandingNoRepo,
  launchLandingChat
} from '@/lib/workspace/creation/landing-chat-launch'
import { useAppStore } from '@/store'

function executionLabel(executionHostId: string | null | undefined): string {
  if (executionHostId?.startsWith('ssh:')) {
    return 'SSH'
  }
  if (executionHostId?.startsWith('runtime:')) {
    return 'Remote'
  }
  return 'This PC'
}

export function useLandingChatComposer() {
  const {
    repos,
    settings,
    sshConnectionStates,
    sshTargetLabels,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    openTaskPage
  } = useAppStore(
    useShallow((state) => ({
      repos: state.repos,
      settings: state.settings,
      sshConnectionStates: state.sshConnectionStates,
      sshTargetLabels: state.sshTargetLabels,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      openTaskPage: state.openTaskPage
    }))
  )

  const [prompt, setPrompt] = useState('')
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([])
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)
  const [selectedHostId, setSelectedHostId] = useState<ExecutionHostId>(LOCAL_EXECUTION_HOST_ID)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selectableRepos = useMemo(
    () =>
      getNewWorkspaceDialogEligibleRepos(repos).filter(
        (repo) => !(repo.isNoRepo === true && repo.displayName === 'No Repo')
      ),
    [repos]
  )
  const selectedRepo = useMemo(
    () => selectableRepos.find((repo) => repo.id === selectedRepoId) ?? null,
    [selectableRepos, selectedRepoId]
  )

  const hostOptions = useMemo(
    () =>
      buildExecutionHostRegistry({
        repos,
        settings,
        hostSource: 'configured-only',
        sshTargetLabels,
        sshConnectionStates,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides: getHostDisplayLabelOverrides(settings)
      }),
    [
      repos,
      settings,
      sshTargetLabels,
      sshConnectionStates,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )

  const effectiveHostId: ExecutionHostId = selectedRepo
    ? getRepoExecutionHostId(selectedRepo)
    : selectedHostId
  const activeHostLabel =
    hostOptions.find((host) => host.id === effectiveHostId)?.label ??
    executionLabel(effectiveHostId)

  const agentSelection = useLandingAgentSelection({
    settings,
    selectedRepo,
    effectiveHostId
  })

  const handleSelectNoRepo = useCallback(() => {
    setSelectedRepoId(null)
    setSelectedHostId((current) =>
      hostSupportsLandingNoRepo(repos, current) ? current : LOCAL_EXECUTION_HOST_ID
    )
  }, [repos])

  const handleSelectRepo = useCallback((repo: Repo) => {
    setSelectedRepoId(repo.id)
    setSelectedHostId(getRepoExecutionHostId(repo))
  }, [])

  const isHostSelectable = useCallback(
    (hostId: ExecutionHostId) =>
      (selectedRepo !== null && getRepoExecutionHostId(selectedRepo) === hostId) ||
      hostSupportsLandingNoRepo(repos, hostId) ||
      selectableRepos.some((repo) => getRepoExecutionHostId(repo) === hostId),
    [repos, selectableRepos, selectedRepo]
  )

  const handleSelectHost = useCallback(
    (hostId: ExecutionHostId) => {
      if (selectedRepo && getRepoExecutionHostId(selectedRepo) === hostId) {
        return
      }
      if (hostSupportsLandingNoRepo(repos, hostId)) {
        setSelectedHostId(hostId)
        setSelectedRepoId(null)
        return
      }
      const matchingRepo = selectableRepos.find((repo) => getRepoExecutionHostId(repo) === hostId)
      if (matchingRepo) {
        setSelectedHostId(hostId)
        setSelectedRepoId(matchingRepo.id)
      }
    },
    [repos, selectableRepos, selectedRepo]
  )

  const handleAddFiles = useCallback(async () => {
    try {
      const picked = await window.api.shell.pickAttachments()
      if (!picked.length) {
        return
      }
      setAttachmentPaths((current) => {
        const seen = new Set(current)
        const next = [...current]
        for (const filePath of picked) {
          if (!seen.has(filePath)) {
            seen.add(filePath)
            next.push(filePath)
          }
        }
        return next
      })
      textareaRef.current?.focus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const removeAttachment = useCallback((filePath: string) => {
    setAttachmentPaths((current) => current.filter((entry) => entry !== filePath))
  }, [])

  const applyStarterPrompt = useCallback((starterPrompt: string) => {
    setPrompt((current) => current || starterPrompt)
    textareaRef.current?.focus()
  }, [])

  const handleSend = useCallback(async () => {
    if (submitting) {
      return
    }
    setSubmitting(true)
    try {
      await launchLandingChat({
        selectedRepo,
        executionHostId: effectiveHostId,
        prompt,
        attachmentPaths,
        agent: agentSelection.quickAgent,
        launchRoute: agentSelection.launchSelection.choice?.route,
        pickerDraft: agentSelection.pickerDraft,
        pickerEntry: agentSelection.pickerEntry
      })
      setPrompt('')
      setAttachmentPaths([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }, [
    agentSelection.launchSelection.choice?.route,
    agentSelection.pickerDraft,
    agentSelection.pickerEntry,
    agentSelection.quickAgent,
    attachmentPaths,
    effectiveHostId,
    prompt,
    selectedRepo,
    submitting
  ])

  return {
    prompt,
    setPrompt,
    attachmentPaths,
    removeAttachment,
    selectableRepos,
    selectedRepo,
    hostOptions,
    effectiveHostId,
    activeHostLabel,
    submitting,
    textareaRef,
    observation: agentSelection.observation,
    quickAgent: agentSelection.quickAgent,
    pickerDraft: agentSelection.pickerDraft,
    launchSelection: agentSelection.launchSelection,
    setAgentMenuOpen: agentSelection.setAgentMenuOpen,
    handleQuickAgentPick: agentSelection.handleQuickAgentPick,
    handleSelectBlankTerminal: agentSelection.handleSelectBlankTerminal,
    handleSelectNoRepo,
    handleSelectRepo,
    isHostSelectable,
    handleSelectHost,
    handleAddFiles,
    applyStarterPrompt,
    handleSend,
    openTaskPage
  }
}
