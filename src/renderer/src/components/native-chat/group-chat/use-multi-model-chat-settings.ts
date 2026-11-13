import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type {
  CouncilAgentCatalog,
  CouncilMode,
  CouncilModelsResult
} from '../../../../../shared/council/council-contract'
import { defaultRounds } from '../../council/council-session-execution'
import { keepProbedSelection } from './multi-model-chat-mutations'
import {
  assignRolesForDiscussionMode,
  clampGroupRounds,
  chooseParticipantModel,
  defaultGroupParticipants,
  loadMultiModelChatConfig,
  makeParticipantModerator,
  saveMultiModelChatConfig,
  toggleAgentModelFromCatalog,
  toggleParticipantFromCatalog,
  updateGroupParticipant,
  validateGroupParticipants,
  WORKTREE_REQUIRED,
  type MultiModelChatConfig,
  type MultiModelChatMode
} from './multi-model-chat-state'

export type MultiModelChatSettings = {
  config: MultiModelChatConfig
  agents: CouncilAgentCatalog[]
  loadingAgents: boolean
  probingAgentIds?: string[]
  catalogError: string | null
  /** Why the group cannot run here, or null when it can. */
  blockedReason: string | null
  sharePriorContext?: boolean
  setMode: (mode: MultiModelChatMode) => void
  setDiscussionMode: (mode: CouncilMode) => void
  setMaxRounds: (rounds: number) => void
  toggleAgent: (agentId: string) => void
  toggleAgentModel?: (agentId: string, modelId: string) => void
  chooseModel: (participantId: string, agentId: string, modelId: string) => void
  setThinkingLevel: (participantId: string, level: string | undefined) => void
  setModerator: (participantId: string) => void
  setSharePriorContext?: (share: boolean) => void
  loadModels: (agentId: string) => Promise<void>
  refreshCatalog?: () => Promise<void>
}

/** The group's model roster and discussion settings, persisted per chat and shared across tabs. */
export function useMultiModelChatSettings(
  chatId: string,
  worktreePath: string | null,
  fallbackChatId?: string
): MultiModelChatSettings {
  const [config, setConfig] = useState<MultiModelChatConfig>(() =>
    loadMultiModelChatConfig(chatId, fallbackChatId)
  )
  const [configChatId, setConfigChatId] = useState(chatId)
  const [agents, setAgents] = useState<CouncilAgentCatalog[]>([])
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [probingAgentIds, setProbingAgentIds] = useState<string[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const loadedAgentsRef = useRef(false)
  const autoProbedAgentsRef = useRef<Set<string>>(new Set())

  // A saved-chat restore moves the same hook to another scope; reload without an extra effect render.
  if (configChatId !== chatId) {
    setConfigChatId(chatId)
    setConfig(loadMultiModelChatConfig(chatId, fallbackChatId))
  }

  useEffect(() => {
    saveMultiModelChatConfig(chatId, config)
  }, [chatId, config])

  const loadModelsInternal = useCallback(
    async (agentId: string, silent: boolean) => {
      if (!worktreePath) {
        if (!silent) {
          toast.error(WORKTREE_REQUIRED)
        }
        return
      }
      setProbingAgentIds((current) => (current.includes(agentId) ? current : [...current, agentId]))
      try {
        const result = await callRuntimeRpc<CouncilModelsResult>(
          { kind: 'local' },
          'council.models',
          { worktree: worktreePath, agent: agentId },
          { timeoutMs: 30_000 }
        )
        if (!result.success) {
          if (!silent) {
            toast.error(result.error)
          }
          return
        }
        setAgents((current) =>
          current.map((agent) => (agent.id === result.agent.id ? result.agent : agent))
        )
        setConfig((current) => ({
          ...current,
          participants: keepProbedSelection(current.participants, result.agent)
        }))
      } catch (error) {
        if (!silent) {
          toast.error(error instanceof Error ? error.message : String(error))
        }
      } finally {
        setProbingAgentIds((current) => current.filter((id) => id !== agentId))
      }
    },
    [worktreePath]
  )

  const loadModels = useCallback(
    async (agentId: string) => {
      await loadModelsInternal(agentId, false)
    },
    [loadModelsInternal]
  )

  const loadAgents = useCallback(async (): Promise<CouncilAgentCatalog[]> => {
    if (loadingAgents) {
      return []
    }
    setLoadingAgents(true)
    setCatalogError(null)
    try {
      const result = await callRuntimeRpc<{ agents: CouncilAgentCatalog[] }>(
        { kind: 'local' },
        'council.agents',
        {}
      )
      setAgents(result.agents)
      loadedAgentsRef.current = true
      setConfig((current) =>
        current.participants.length === 0
          ? { ...current, participants: defaultGroupParticipants(result.agents) }
          : current
      )
      return result.agents
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error))
      return []
    } finally {
      setLoadingAgents(false)
    }
  }, [loadingAgents])

  const refreshCatalog = useCallback(async () => {
    autoProbedAgentsRef.current.clear()
    const freshAgents = await loadAgents()
    if (!worktreePath) {
      return
    }
    const probeTargets = freshAgents.filter((agent) => agent.available !== false)
    await Promise.allSettled(
      probeTargets.map((agent) => {
        autoProbedAgentsRef.current.add(agent.id)
        return loadModelsInternal(agent.id, true)
      })
    )
  }, [loadAgents, loadModelsInternal, worktreePath])

  // Availability is only probed when the person actually opens multi-model chat.
  useEffect(() => {
    if (config.mode !== 'multi') {
      return
    }
    if (!loadedAgentsRef.current && !loadingAgents) {
      void loadAgents()
      return
    }
    if (!worktreePath || agents.length === 0) {
      return
    }
    const candidates = agents.filter(
      (agent) =>
        agent.available !== false &&
        agent.modelSource !== 'dynamic' &&
        !autoProbedAgentsRef.current.has(agent.id)
    )
    if (candidates.length === 0) {
      return
    }
    for (const agent of candidates) {
      autoProbedAgentsRef.current.add(agent.id)
      void loadModelsInternal(agent.id, true)
    }
  }, [agents, config.mode, loadAgents, loadModelsInternal, loadingAgents, worktreePath])

  const setMode = useCallback(
    (mode: MultiModelChatMode) => {
      setConfig((current) => ({ ...current, mode }))
      if (mode === 'multi' && !loadedAgentsRef.current) {
        void loadAgents()
      }
    },
    [loadAgents]
  )

  const setDiscussionMode = useCallback((mode: CouncilMode) => {
    setConfig((current) => ({
      ...current,
      discussionMode: mode,
      maxRounds: current.discussionMode === mode ? current.maxRounds : defaultRounds(mode),
      participants: assignRolesForDiscussionMode(current.participants, mode)
    }))
  }, [])

  const setMaxRounds = useCallback((rounds: number) => {
    setConfig((current) => ({ ...current, maxRounds: clampGroupRounds(rounds) }))
  }, [])

  const toggleAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((candidate) => candidate.id === agentId)
      if (!agent) {
        return
      }
      setConfig((current) => ({
        ...current,
        participants: toggleParticipantFromCatalog(current.participants, agent)
      }))
    },
    [agents]
  )

  const toggleAgentModel = useCallback(
    (agentId: string, modelId: string) => {
      const agent = agents.find((candidate) => candidate.id === agentId)
      if (!agent) {
        return
      }
      setConfig((current) => ({
        ...current,
        participants: toggleAgentModelFromCatalog(current.participants, agent, modelId)
      }))
    },
    [agents]
  )

  const chooseModel = useCallback(
    (participantId: string, agentId: string, modelId: string) => {
      const agent = agents.find((candidate) => candidate.id === agentId)
      if (!agent) {
        return
      }
      setConfig((current) => ({
        ...current,
        participants: chooseParticipantModel(current.participants, participantId, agent, modelId)
      }))
    },
    [agents]
  )

  const setThinkingLevel = useCallback((participantId: string, level: string | undefined) => {
    setConfig((current) => ({
      ...current,
      participants: updateGroupParticipant(current.participants, participantId, {
        thinkingLevel: level
      })
    }))
  }, [])

  const setModerator = useCallback((participantId: string) => {
    setConfig((current) => ({
      ...current,
      participants: makeParticipantModerator(current.participants, participantId)
    }))
  }, [])

  const setSharePriorContext = useCallback((sharePriorContext: boolean) => {
    setConfig((current) => ({ ...current, sharePriorContext }))
  }, [])

  const blockedReason = !worktreePath
    ? WORKTREE_REQUIRED
    : validateGroupParticipants(config.participants, agents)

  return {
    config,
    agents,
    loadingAgents,
    probingAgentIds,
    catalogError,
    blockedReason,
    sharePriorContext: config.sharePriorContext !== false,
    setMode,
    setDiscussionMode,
    setMaxRounds,
    toggleAgent,
    toggleAgentModel,
    chooseModel,
    setThinkingLevel,
    setModerator,
    setSharePriorContext,
    loadModels,
    refreshCatalog
  }
}
