import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, MessageSquareText, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { launchAgentInNewTabWithOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type {
  CouncilAgentCatalog,
  CouncilMode,
  CouncilModelsResult,
  CouncilParticipant,
  CouncilSession
} from '../../../../shared/council/council-contract'
import {
  deleteCouncilSession,
  exportCouncilSession,
  loadCouncilSessions,
  saveCouncilSession
} from './council-session-storage'
import {
  MODE_LABELS,
  appendCouncilParticipant,
  createCouncilUuid,
  createDefaultCouncilParticipants,
  createUserInterventionMessage,
  defaultRounds,
  removeCouncilParticipant
} from './council-session-execution'
import { useCouncilSessionRunner } from './useCouncilSessionRunner'
import { CouncilSavedSessionsSidebar } from './CouncilSavedSessionsSidebar'
import { CouncilSetupPanel } from './CouncilSetupPanel'
import { CouncilThreadView } from './CouncilThreadView'
import { useMarkdownDirectionOverride } from '@/components/sidebar/MarkdownDirectionToggle'
import {
  OPEN_COUNCIL_WORKSPACE_EVENT,
  type CouncilWorkspaceTarget
} from './council-workspace-event'

export default function NexusCouncilWorkspace(): React.JSX.Element | null {
  const [target, setTarget] = useState<CouncilWorkspaceTarget | null>(null)
  const [agents, setAgents] = useState<CouncilAgentCatalog[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [participants, setParticipants] = useState<CouncilParticipant[]>([])
  const [mode, setMode] = useState<CouncilMode>('consensus')
  const [maxRounds, setMaxRounds] = useState(3)
  const [prompt, setPrompt] = useState('')
  const [session, setSession] = useState<CouncilSession | null>(null)
  const [savedSessions, setSavedSessions] = useState<CouncilSession[]>([])
  const [intervention, setIntervention] = useState('')
  const [confirmImplementation, setConfirmImplementation] = useState(false)
  const [briefDirection, setBriefDirection] = useMarkdownDirectionOverride(
    session ? `council-brief:${session.id}` : undefined
  )
  const { runningRef, pauseRef, sessionRef, persist, cancelActive, run, retryMessage } =
    useCouncilSessionRunner({ session, setSession, setSavedSessions })

  useEffect(() => {
    const open = (event: Event): void => {
      const detail = (event as CustomEvent<CouncilWorkspaceTarget>).detail
      setTarget(detail)
      const loaded = loadCouncilSessions()
      setSavedSessions(
        runningRef.current && sessionRef.current ? saveCouncilSession(sessionRef.current) : loaded
      )
    }
    window.addEventListener(OPEN_COUNCIL_WORKSPACE_EVENT, open)
    return () => window.removeEventListener(OPEN_COUNCIL_WORKSPACE_EVENT, open)
  }, [runningRef, sessionRef])

  const loadAgents = useCallback(async () => {
    setLoadingAgents(true)
    setCatalogError(null)
    try {
      const result = await callRuntimeRpc<{ agents: CouncilAgentCatalog[] }>(
        { kind: 'local' },
        'council.agents',
        {}
      )
      setAgents(result.agents)
      setParticipants((current) =>
        current.length ? current : createDefaultCouncilParticipants(result.agents)
      )
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoadingAgents(false)
    }
  }, [])

  useEffect(() => {
    if (target && agents.length === 0 && !loadingAgents) {
      void loadAgents()
    }
  }, [agents.length, loadAgents, loadingAgents, target])

  const updateParticipant = (id: string, patch: Partial<CouncilParticipant>): void => {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === id ? { ...participant, ...patch } : participant
      )
    )
  }

  const selectAgent = (participant: CouncilParticipant, agentId: string): void => {
    const agent = agents.find((candidate) => candidate.id === agentId)
    if (!agent) {
      return
    }
    const model =
      agent.models.find((candidate) => candidate.id === agent.defaultModelId) ?? agent.models[0]
    updateParticipant(participant.id, {
      agent: agent.id,
      label: agent.label,
      model: model?.id ?? agent.defaultModelId,
      modelLabel: model?.label ?? agent.defaultModelId,
      thinkingLevel: model?.defaultThinkingLevel
    })
  }

  const refreshModels = async (participant: CouncilParticipant): Promise<void> => {
    if (!target) {
      return
    }
    try {
      const result = await callRuntimeRpc<CouncilModelsResult>(
        { kind: 'local' },
        'council.models',
        { worktree: target.workspaceId, agent: participant.agent },
        { timeoutMs: 30_000 }
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setAgents((current) =>
        current.map((agent) => (agent.id === result.agent.id ? result.agent : agent))
      )
      const model =
        result.agent.models.find((candidate) => candidate.id === participant.model) ??
        result.agent.models[0]
      if (model) {
        updateParticipant(participant.id, {
          model: model.id,
          modelLabel: model.label,
          thinkingLevel: model.defaultThinkingLevel
        })
      }
      toast.success(`Loaded ${result.agent.models.length} ${result.agent.label} models`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const startCouncil = (): void => {
    if (!target || participants.length < 2 || !prompt.trim()) {
      return
    }
    const now = Date.now()
    const next: CouncilSession = {
      id: createCouncilUuid(),
      workspaceId: target.workspaceId,
      title: prompt.trim().split(/\s+/).slice(0, 8).join(' '),
      prompt: prompt.trim(),
      mode,
      maxRounds,
      participants,
      messages: [],
      status: 'draft',
      currentRound: 0,
      createdAt: now,
      updatedAt: now,
      queuedUserMessages: []
    }
    sessionRef.current = next
    setSession(next)
    void run(next)
  }

  const sendIntervention = (): void => {
    if (!session || !intervention.trim()) {
      return
    }
    const text = intervention.trim()
    setIntervention('')
    const updated = persist({
      ...session,
      queuedUserMessages: [...session.queuedUserMessages, text],
      messages: [...session.messages, createUserInterventionMessage(session.currentRound + 1, text)]
    })
    if (!runningRef.current) {
      const nextRound = Math.max(1, updated.currentRound + 1)
      void run(updated, nextRound, Math.max(updated.maxRounds, nextRound))
    }
  }

  const resumeSession = (): void => {
    if (!session || runningRef.current) {
      return
    }
    const nextRound = Math.max(1, session.currentRound + 1)
    void run(session, nextRound, Math.max(session.maxRounds, nextRound))
  }

  const implementDecision = (): void => {
    if (!session?.finalDecision || !target) {
      return
    }
    const moderator =
      session.participants.find((participant) => participant.moderator) ?? session.participants[0]
    const codingAgent =
      (moderator && isTuiAgent(moderator.agent) ? moderator : undefined) ??
      session.participants.find((participant) => isTuiAgent(participant.agent))
    if (!codingAgent || !isTuiAgent(codingAgent.agent)) {
      void navigator.clipboard.writeText(session.finalDecision).then(
        () => toast.success('Decision copied to clipboard for implementation'),
        () => toast.error('No coding agent tab is configured for this Council decision.')
      )
      setConfirmImplementation(false)
      return
    }
    const resolvedAgent = codingAgent.agent
    launchAgentInNewTabWithOutcome({
      requestId: createCouncilUuid(),
      agent: resolvedAgent,
      worktreeId: target.workspaceId,
      groupId: target.groupId,
      launchSource: 'tab_bar_quick_launch',
      promptDelivery: 'draft',
      prompt: `Implement this approved Code Nexus Council decision. Re-verify assumptions before editing and keep changes scoped.\n\n${session.finalDecision}`
    })
    setConfirmImplementation(false)
    setTarget(null)
  }

  const activeAgentModels = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.models])),
    [agents]
  )

  if (!target) {
    return null
  }

  return (
    <Dialog open onOpenChange={(open) => !open && setTarget(null)}>
      <DialogContent
        surface="panel"
        showCloseButton={false}
        className="h-[min(92vh,900px)] max-h-[calc(100vh-2rem)] w-[min(96vw,1280px)] max-w-[min(96vw,1280px)] sm:max-w-[min(96vw,1280px)] overflow-hidden rounded-xl"
      >
        <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] bg-background">
          <CouncilSavedSessionsSidebar
            savedSessions={savedSessions}
            activeSessionId={session?.id}
            liveSessionId={sessionRef.current?.id}
            isRunning={runningRef.current}
            onNewCouncil={() => {
              pauseRef.current = false
              sessionRef.current = null
              setSession(null)
              setPrompt('')
            }}
            onSelectSession={(saved, isLive) => {
              pauseRef.current = false
              const chosen = isLive && sessionRef.current ? sessionRef.current : saved
              sessionRef.current = chosen
              setSession(chosen)
            }}
            onDeleteSession={(sessionId) => {
              setSavedSessions(deleteCouncilSession(sessionId))
              if (session?.id === sessionId) {
                sessionRef.current = null
                setSession(null)
              }
            }}
          />

          <main className="flex min-h-0 min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {session?.title || 'Configure a new Council'}
                </span>
                {session ? <Badge variant="outline">{MODE_LABELS[session.mode]}</Badge> : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {session ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Export Markdown"
                      onClick={() => exportCouncilSession(session, 'markdown')}
                    >
                      <Download className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Export JSON"
                      onClick={() => exportCouncilSession(session, 'json')}
                    >
                      <span className="text-[9px] font-semibold">JSON</span>
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Close Council"
                  onClick={() => setTarget(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </header>

            {!session ? (
              <CouncilSetupPanel
                agents={agents}
                catalogError={catalogError}
                loadingAgents={loadingAgents}
                maxRounds={maxRounds}
                mode={mode}
                participants={participants}
                prompt={prompt}
                activeAgentModels={activeAgentModels}
                onLoadAgents={loadAgents}
                onModeChange={(next) => {
                  setMode(next)
                  setMaxRounds(defaultRounds(next))
                }}
                onRoundsChange={setMaxRounds}
                onPromptChange={setPrompt}
                onSelectAgent={selectAgent}
                onRefreshModels={(participant) => void refreshModels(participant)}
                onUpdateParticipant={updateParticipant}
                onAddParticipant={() =>
                  setParticipants((current) => appendCouncilParticipant(current, agents))
                }
                onRemoveParticipant={(id) =>
                  setParticipants((current) => removeCouncilParticipant(current, id))
                }
                onStart={startCouncil}
              />
            ) : (
              <CouncilThreadView
                session={session}
                isRunning={runningRef.current}
                isPaused={pauseRef.current}
                briefDirection={briefDirection}
                intervention={intervention}
                onBriefDirectionChange={setBriefDirection}
                onInterventionChange={setIntervention}
                onSendIntervention={sendIntervention}
                onTogglePause={() => {
                  pauseRef.current = !pauseRef.current
                  persist({ ...session, status: pauseRef.current ? 'paused' : 'running' })
                }}
                onResume={resumeSession}
                onStop={() => void cancelActive()}
                onRetryMessage={(message) => void retryMessage(message)}
                onConfirmImplementation={() => setConfirmImplementation(true)}
              />
            )}
          </main>
        </div>
      </DialogContent>
      <Dialog open={confirmImplementation} onOpenChange={setConfirmImplementation}>
        <DialogContent size="compact">
          <DialogHeader>
            <DialogTitle size="compact">Open an implementation session?</DialogTitle>
            <DialogDescription size="compact">
              Code Nexus will open a separate coding-agent tab with the approved decision as an
              unsent draft. No code changes begin until you review and send it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmImplementation(false)}>
              Cancel
            </Button>
            <Button onClick={implementDecision}>Open draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
