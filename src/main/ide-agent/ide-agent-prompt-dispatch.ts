import { randomUUID } from 'node:crypto'
import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed
} from '../../shared/ide-agent/ide-agent-types'
import { runPromptLifecycle } from './ide-agent-run-lifecycle'
import {
  pickExecutionSettings,
  type ActiveRunControl,
  type EngineHostOps,
  type ResolveWorkspaceGateway
} from './ide-agent-runtime-types'

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
  openFilePaths?: string[]
  reuseLastUserMessage?: boolean
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
  if (
    conv.messages.length === 0 &&
    (conv.title === 'New Chat' || conv.title === 'New IDE Chat' || conv.title === 'New AI Chat')
  ) {
    conv.title = params.text.trim().replace(/\s+/g, ' ').slice(0, 64) || 'New Chat'
  }
  const rawAttachments = params.attachments ?? []
  const persistedAttachments = rawAttachments.map((att) =>
    att.sensitiveWarning ? { ...att, previewText: undefined } : att
  )
  const gateway = await resolveGateway(params.worktreeSelector)
  const runControl = params.createRunControl(conv, params.worktreeSelector, dirtySet)
  if (!params.reuseLastUserMessage) {
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
      ...(persistedAttachments.length > 0 ? { attachments: persistedAttachments } : {})
    }
    conv.messages.push(userMessage)
  }
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
      const latest = host.requireConversation(conv.id)
      const activePlan = latest.plans.find((p) => p.id === latest.activePlanId)
      if (activePlan && activePlan.status === 'executing') {
        activePlan.status = 'failed'
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
