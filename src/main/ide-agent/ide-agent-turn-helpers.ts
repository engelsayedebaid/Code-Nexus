import { randomUUID } from 'node:crypto'
import {
  computeIdePlanHash,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeChatMessage,
  IdeConversation,
  IdePlanFileAction,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { runToolAssistedInspectionLoop } from './ide-agent-harness'
import { buildReviewPrompt, type parsePlanJsonFromAiOutput } from './ide-agent-prompts'
import { IdeContextBudgetTracker } from './ide-context-budget'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway, WorkspaceInspectionSnapshot } from './ide-workspace-gateway'

export { filterAndHydrateAttachments } from './ide-attachment-prompt-context'

export async function inspectWorkspaceForTurn(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  text: string
  activeFilePath?: string
}): Promise<{
  snapshot: WorkspaceInspectionSnapshot
  budget: IdeContextBudgetTracker
  activeFileContent: { relativePath: string; content: string } | null
}> {
  const { host, conv, run, gateway } = params
  host.setRunStatus(conv, run.runId, 'analyzing', 'Inspecting workspace context...')
  host.appendActivity(conv, {
    runId: run.runId,
    role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
    type: 'analysis.started',
    summary: `Inspecting workspace in ${run.config.mode.toUpperCase()} mode`,
    status: 'running'
  })

  const hintTerms = params.text
    .split(/[^A-Za-z0-9_.-]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 10)
  const snapshot = await gateway.inspectWorkspace(hintTerms)
  const budget = new IdeContextBudgetTracker({ stackLabels: snapshot.architecture?.stackLabels })

  for (const file of snapshot.keyFiles.slice(0, 5)) {
    budget.recordText(`file:${file.relativePath}`, file.content)
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'analysis.file_read',
      summary: `Read ${file.relativePath}`,
      relativePath: file.relativePath,
      status: 'completed'
    })
  }

  let activeFileContent: { relativePath: string; content: string } | null = null
  if (params.activeFilePath) {
    const normalizedActive = normalizeWorkspaceRelativePath(params.activeFilePath)
    const readRes = await gateway.readTextFile(normalizedActive)
    if (readRes.ok && readRes.content !== null) {
      budget.recordText(`file:${normalizedActive}`, readRes.content)
      activeFileContent = { relativePath: normalizedActive, content: readRes.content }
    }
  }
  conv.contextBudget = budget.summary()
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'orchestrator',
    type: 'analysis.completed',
    summary: `Inspected ${snapshot.fileList.length} files (${snapshot.keyFiles.length} loaded)`,
    status: 'completed'
  })
  return { snapshot, budget, activeFileContent }
}

export function buildPlanRecord(params: {
  conversation: IdeConversation
  requestSummary: string
  raw: NonNullable<ReturnType<typeof parsePlanJsonFromAiOutput>>
  version: number
  revisionNotes?: string[]
}): IdeTaskPlan {
  const now = Date.now()
  const steps: IdePlanStep[] = params.raw.steps.map((step, index) => ({
    id: randomUUID(),
    index,
    title: step.title,
    detail: step.detail,
    targetFiles: step.targetFiles,
    status: 'pending'
  }))
  const affectedFiles: IdePlanFileAction[] = params.raw.affectedFiles
  const planHash = computeIdePlanHash({
    objective: params.raw.objective,
    affectedFiles,
    steps,
    risks: params.raw.risks,
    testsAndVerification: params.raw.testsAndVerification
  })
  return {
    id: randomUUID(),
    conversationId: params.conversation.id,
    version: params.version,
    planHash,
    ...(params.raw.intro ? { intro: params.raw.intro } : {}),
    objective: params.raw.objective,
    requestSummary: params.requestSummary,
    affectedFiles,
    steps,
    risks: params.raw.risks,
    testsAndVerification: params.raw.testsAndVerification,
    estimatedComplexity: params.raw.estimatedComplexity,
    status: 'awaiting_approval',
    createdAt: now,
    updatedAt: now,
    approvalRecord: null,
    revisionNotes: params.revisionNotes ?? []
  }
}

export async function executeReadOnlyChatTurn(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  budget: IdeContextBudgetTracker
  mode: 'ask' | 'review'
  buildPrompt: (observations: readonly string[]) => string
  preserveAwaitingPlan?: boolean
}): Promise<void> {
  const { host, conv, run, gateway, budget } = params
  const assistantMsg: IdeChatMessage = {
    id: randomUUID(),
    conversationId: conv.id,
    role: 'assistant',
    mode: params.mode,
    text: '',
    streaming: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    runId: run.runId
  }
  conv.messages.push(assistantMsg)
  host.setRunStatus(conv, run.runId, 'executing', `Generating ${params.mode} response...`)

  const res = await runToolAssistedInspectionLoop({
    host,
    conv,
    run,
    gateway,
    budget,
    mode: params.mode,
    role: 'orchestrator',
    buildPrompt: params.buildPrompt,
    onProseDelta: (delta) => {
      assistantMsg.text += delta
      assistantMsg.updatedAt = Date.now()
      host.emit({
        type: 'message_delta',
        conversationId: conv.id,
        messageId: assistantMsg.id,
        text: assistantMsg.text
      })
    }
  })

  assistantMsg.streaming = false
  assistantMsg.updatedAt = Date.now()

  if (!res.ok) {
    if (res.canceled || run.abortController.signal.aborted) {
      if (!assistantMsg.text) {
        assistantMsg.text = '_Generation stopped by user._'
      }
      host.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'run.canceled',
        summary: 'Stopped by user',
        status: 'warning'
      })
      host.setRunStatus(conv, null, 'canceled')
      return
    }
    assistantMsg.error = res.error
    assistantMsg.text = assistantMsg.text || `Error: ${res.error}`
    host.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.failed',
      summary: res.error,
      status: 'error'
    })
    host.setRunStatus(conv, null, 'failed', res.error)
    return
  }

  assistantMsg.text = res.text
  host.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'orchestrator',
    type: 'run.completed',
    summary: `${params.mode === 'review' ? 'Code review' : 'Answer'} completed (read-only)`,
    status: 'completed'
  })
  const activePlan = params.preserveAwaitingPlan
    ? conv.plans.find((p) => p.id === conv.activePlanId)
    : undefined
  host.setRunStatus(
    conv,
    null,
    activePlan?.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed'
  )
}

export async function runReviewModeTurn(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  budget: IdeContextBudgetTracker
  snapshot: WorkspaceInspectionSnapshot
  requestText: string
}): Promise<void> {
  const { conv, gateway, requestText, snapshot } = params
  const diffSummary = await gateway.getGitDiffSummary()
  const trackedSummary = conv.fileChanges
    .map(
      (c) =>
        `- ${c.relativePath} (${c.changeType}, state=${c.acceptedState}, chunks=${c.chunksApplied})`
    )
    .join('\n')
  const combinedDiff = [
    diffSummary,
    trackedSummary ? `### Tracked Agent Changes\n${trackedSummary}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
  const cmdSummary = conv.commandExecutions
    .slice(-5)
    .map((c) => `- \`${c.command}\`: ${c.status} (exit ${c.exitCode ?? 'n/a'})`)
    .join('\n')

  await executeReadOnlyChatTurn({
    host: params.host,
    conv,
    run: params.run,
    gateway,
    budget: params.budget,
    mode: 'review',
    buildPrompt: () =>
      buildReviewPrompt({
        request: requestText,
        diffSummary: combinedDiff,
        commandHistorySummary: cmdSummary,
        snapshot
      })
  })
}
