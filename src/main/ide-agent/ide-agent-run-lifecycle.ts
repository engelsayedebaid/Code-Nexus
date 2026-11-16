import { randomUUID } from 'node:crypto'
import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed
} from '../../shared/ide-agent/ide-agent-types'
import { runToolAssistedInspectionLoop } from './ide-agent-harness'
import {
  buildAskPrompt,
  buildPlanPrompt,
  isClarificationOrQuestionPrompt
} from './ide-agent-prompts'
import { finalizePlannerOutput } from './ide-agent-planner-turn'
import {
  executeReadOnlyChatTurn,
  filterAndHydrateAttachments,
  inspectWorkspaceForTurn,
  runReviewModeTurn
} from './ide-agent-turn-helpers'
import {
  pickExecutionSettings,
  type ActiveRunControl,
  type EngineHostOps,
  type ResolveWorkspaceGateway
} from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

export { buildPlanRecord } from './ide-agent-turn-helpers'

export async function runPromptLifecycle(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  conversationId: string
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  input: { text: string; attachments?: IdeChatAttachment[]; activeFilePath?: string }
}): Promise<void> {
  const { host, activeRuns, conversationId, run, gateway, input } = params
  const conv = host.requireConversation(conversationId)
  try {
    host.setRunStatus(conv, run.runId, 'analyzing', 'Inspecting workspace context...')
    const attachments =
      (input.attachments?.length ?? 0) > 0
        ? await filterAndHydrateAttachments(host, conv, run, gateway, input.attachments ?? [])
        : []
    if (run.abortController.signal.aborted) {
      host.setRunStatus(conv, null, 'canceled')
      return
    }

    const { snapshot, budget, activeFileContent } = await inspectWorkspaceForTurn({
      host,
      conv,
      run,
      gateway,
      text: input.text,
      activeFilePath: input.activeFilePath
    })
    if (run.abortController.signal.aborted) {
      host.setRunStatus(conv, null, 'canceled')
      return
    }

    if (run.config.mode === 'ask') {
      await executeReadOnlyChatTurn({
        host,
        conv,
        run,
        gateway,
        budget,
        mode: 'ask',
        buildPrompt: (observations) =>
          buildAskPrompt({
            question: input.text,
            snapshot,
            attachments,
            activeFileContent,
            history: conv.messages.slice(0, -1),
            activePlan: conv.plans.find((p) => p.id === conv.activePlanId) ?? conv.plans.at(-1),
            toolObservations: observations
          })
      })
      return
    }

    if (run.config.mode === 'agent' && isClarificationOrQuestionPrompt(input.text)) {
      const activePlan =
        conv.plans.find((p) => p.id === conv.activePlanId) ?? conv.plans.at(-1) ?? null
      await executeReadOnlyChatTurn({
        host,
        conv,
        run,
        gateway,
        budget,
        mode: 'ask',
        preserveAwaitingPlan: activePlan?.status === 'awaiting_approval',
        buildPrompt: (observations) =>
          buildAskPrompt({
            question: input.text,
            snapshot,
            attachments,
            activeFileContent,
            history: conv.messages.slice(0, -1),
            activePlan,
            toolObservations: observations
          })
      })
      return
    }

    if (run.config.mode === 'review') {
      await runReviewModeTurn({
        host,
        conv,
        run,
        gateway,
        budget,
        snapshot,
        requestText: input.text
      })
      return
    }

    host.setRunStatus(conv, run.runId, 'planning', 'Generating implementation plan...')
    if (run.config.multiAgentEnabled) {
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'planner',
        type: 'agent.role_started',
        summary: 'Planner Agent drafting implementation plan',
        status: 'running'
      })
    }

    const aiRes = await runToolAssistedInspectionLoop({
      host,
      conv,
      run,
      gateway,
      budget,
      mode: 'plan',
      role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
      buildPrompt: (observations) =>
        buildPlanPrompt({
          request: input.text,
          snapshot,
          attachments,
          activeFileContent,
          history: conv.messages.slice(0, -1),
          mode: run.config.mode === 'agent' ? 'agent' : 'plan',
          toolObservations: observations
        })
    })

    if (!aiRes.ok) {
      if (aiRes.canceled || run.abortController.signal.aborted) {
        host.appendActivity(conv, {
          runId: run.runId,
          role: 'planner',
          type: 'run.canceled',
          summary: 'Planning canceled',
          status: 'warning'
        })
        host.setRunStatus(conv, null, 'canceled')
        return
      }
      throw new Error(aiRes.error)
    }

    await finalizePlannerOutput({
      host,
      activeRuns,
      conv,
      run,
      gateway,
      requestText: input.text,
      aiText: aiRes.text
    })
  } finally {
    if (activeRuns.get(conversationId) === run) {
      activeRuns.delete(conversationId)
    }
  }
}

export async function dispatchIdePrompt(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  resolveGateway: ResolveWorkspaceGateway
  createRunControl: (
    conv: IdeConversation,
    selector: string,
    dirtySet: Set<string>
  ) => ActiveRunControl
  resolveSelectionUpdate: (
    conv: IdeConversation,
    update: { agentId?: string; modelId?: string }
  ) => { agentId: string; modelId: string }
  dirtySet: Set<string>
  conversationId: string
  worktreeSelector: string
  text: string
  mode: IdeExecutionMode
  agentId?: string
  modelId?: string
  multiAgentEnabled?: boolean
  followAgent?: boolean
  liveEditSpeed?: IdeLiveEditSpeed
  attachments?: IdeChatAttachment[]
  activeFilePath?: string
}): Promise<IdeConversation> {
  const { host, activeRuns, resolveGateway, dirtySet } = params
  const conv = host.requireConversation(params.conversationId)
  if (activeRuns.has(conv.id)) {
    throw new Error('Another run is already active in this conversation. Stop or pause it first.')
  }
  const sel = params.resolveSelectionUpdate(conv, params)
  conv.mode = params.mode
  conv.agentId = sel.agentId
  conv.modelId = sel.modelId
  if (params.multiAgentEnabled !== undefined) {
    conv.multiAgentEnabled = params.multiAgentEnabled
  }
  if (params.followAgent !== undefined) {
    conv.followAgent = params.followAgent
  }
  if (params.liveEditSpeed !== undefined) {
    conv.liveEditSpeed = params.liveEditSpeed
  }
  if (conv.messages.length === 0 && conv.title === 'New IDE Chat') {
    conv.title = params.text.trim().replace(/\s+/g, ' ').slice(0, 64) || 'IDE Session'
  }
  const rawAttachments = params.attachments ?? []
  const gateway = await resolveGateway(params.worktreeSelector)
  const runControl = params.createRunControl(conv, params.worktreeSelector, dirtySet)
  const userMessage: IdeChatMessage = {
    id: randomUUID(),
    conversationId: conv.id,
    role: 'user',
    mode: conv.mode,
    text: params.text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentId: conv.agentId,
    modelId: conv.modelId,
    teamMode: conv.multiAgentEnabled,
    ...(rawAttachments.length > 0 ? { attachments: rawAttachments } : {})
  }
  conv.messages.push(userMessage)
  host.saveAndPublish(conv, pickExecutionSettings(conv))

  void runPromptLifecycle({
    host,
    activeRuns,
    conversationId: conv.id,
    run: runControl,
    gateway,
    input: params
  }).catch((error) => {
    if (runControl.abortController.signal.aborted) {
      return
    }
    try {
      const latest = host.store.getConversation(conv.id)
      if (!latest) {
        return
      }
      const errText = error instanceof Error ? error.message : String(error)
      host.appendActivity(latest, {
        runId: runControl.runId,
        role: 'orchestrator',
        type: 'run.failed',
        summary: 'Run failed',
        detail: errText,
        status: 'error'
      })
      latest.messages.push({
        id: randomUUID(),
        conversationId: latest.id,
        role: 'assistant',
        mode: latest.mode,
        text: `Error: ${errText}`,
        error: errText,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        runId: runControl.runId,
        agentId: latest.agentId,
        modelId: latest.modelId
      })
      host.setRunStatus(latest, null, 'failed', errText)
    } catch {
      // Ignore post-disposal errors when DB store was closed after cancellation or shutdown.
    }
  })
  return conv
}
