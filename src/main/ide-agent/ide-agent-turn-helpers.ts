import { randomUUID } from 'node:crypto'
import { computeIdePlanHash } from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdeConversation,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { runToolAssistedInspectionLoop } from './ide-agent-harness'
import {
  buildReviewPrompt,
  unwrapDirectAnswerJsonIfPresent,
  type parsePlanJsonFromAiOutput
} from './ide-agent-prompts'
import { IdeContextBudgetTracker } from './ide-context-budget'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway, WorkspaceInspectionSnapshot } from './ide-workspace-gateway'
import { gatherRankedTurnContext, type RankedContextSnippet } from './harness/context-engine'
import {
  resolveModelExecutionProfile,
  type ResolvedModelExecutionProfile
} from './harness/model-capability-registry'
import {
  loadTrustedWorkspaceInstructions,
  type WorkspaceInstructionsBundle
} from './harness/workspace-instructions-loader'

export { filterAndHydrateAttachments } from './ide-attachment-prompt-context'

export async function inspectWorkspaceForTurn(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  text: string
  activeFilePath?: string
  openFilePaths?: readonly string[]
  attachments?: readonly IdeChatAttachment[]
}) {
  const { host, conv, run, gateway } = params
  host.setRunStatus(conv, run.runId, 'analyzing', 'Inspecting workspace context...')
  const taskKind =
    run.config.mode === 'ask' ? 'ask' : run.config.mode === 'review' ? 'review' : 'plan'
  const profile = resolveModelExecutionProfile({
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    taskKind
  })
  const hintTerms = params.text
    .split(/[^A-Za-z0-9_.-]+/)
    .filter((token) => token.length >= 3)
    .slice(0, 12)
  const [snapshot, instructions] = await Promise.all([
    gateway.inspectWorkspace(hintTerms, run.abortController.signal),
    loadTrustedWorkspaceInstructions({
      gateway,
      maxRulesChars: profile.allocation.projectRulesTokens * 4,
      signal: run.abortController.signal
    })
  ])
  const budget = new IdeContextBudgetTracker({
    budgetTokens: profile.allocation.totalContextTokens,
    stackLabels: snapshot.architecture?.stackLabels
  })
  const { rankedSnippets, activeFileContent } = await gatherRankedTurnContext({
    gateway,
    snapshot,
    userText: params.text,
    activeFilePath: params.activeFilePath,
    openFilePaths: params.openFilePaths,
    attachments: params.attachments ?? [],
    budget,
    profile,
    signal: run.abortController.signal
  })
  for (const snippet of rankedSnippets) {
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'analysis.file_read',
      summary: `Read ${snippet.relativePath}`,
      relativePath: snippet.relativePath,
      status: 'completed'
    })
  }
  conv.contextBudget = budget.summary()
  return { snapshot, budget, activeFileContent, rankedSnippets, instructions, profile }
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
    title: step.title.replace(/^\s*\d+[.)]\s*/, '').trim() || step.title.trim(),
    detail: step.detail,
    targetFiles: step.targetFiles,
    status: 'pending'
  }))
  const affectedFiles = params.raw.affectedFiles
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
  profile?: ResolvedModelExecutionProfile
  mode: 'ask' | 'review'
  buildPrompt: (observations: readonly string[], allowTools: boolean) => string
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

  let lastDeltaEmitAt = 0
  let pendingDeltaTimer: ReturnType<typeof setTimeout> | null = null
  const flushMessageDelta = (): void => {
    if (pendingDeltaTimer !== null) {
      clearTimeout(pendingDeltaTimer)
      pendingDeltaTimer = null
    }
    lastDeltaEmitAt = Date.now()
    host.emit({
      type: 'message_delta',
      conversationId: conv.id,
      messageId: assistantMsg.id,
      text: assistantMsg.text
    })
  }

  const res = await runToolAssistedInspectionLoop({
    host,
    conv,
    run,
    gateway,
    budget,
    profile: params.profile,
    mode: params.mode,
    role: 'orchestrator',
    buildPrompt: params.buildPrompt,
    onTurnReset: () => {
      assistantMsg.text = ''
      assistantMsg.updatedAt = Date.now()
      flushMessageDelta()
    },
    onProseDelta: (delta) => {
      assistantMsg.text += delta
      assistantMsg.updatedAt = Date.now()
      const elapsed = Date.now() - lastDeltaEmitAt
      if (elapsed >= 32) {
        flushMessageDelta()
      } else if (pendingDeltaTimer === null) {
        pendingDeltaTimer = setTimeout(flushMessageDelta, 32 - elapsed)
      }
    }
  })
  if (pendingDeltaTimer !== null) {
    flushMessageDelta()
  }

  assistantMsg.streaming = false
  assistantMsg.updatedAt = Date.now()

  if (!res.ok) {
    if (res.canceled || run.abortController.signal.aborted) {
      if (!assistantMsg.text) {
        assistantMsg.text = '_Generation stopped by user._'
      }
      host.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
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

  assistantMsg.text = unwrapDirectAnswerJsonIfPresent(res.text)
  host.emit({ type: 'message_complete', conversationId: conv.id, message: assistantMsg })
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
  attachments?: readonly IdeChatAttachment[]
  activeFileContent?: { relativePath: string; content: string } | null
  rankedSnippets?: readonly RankedContextSnippet[]
  instructions?: WorkspaceInstructionsBundle | null
  profile?: ResolvedModelExecutionProfile
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
    profile: params.profile,
    mode: 'review',
    buildPrompt: (observations, allowTools) =>
      buildReviewPrompt({
        request: requestText,
        diffSummary: combinedDiff,
        commandHistorySummary: cmdSummary,
        snapshot,
        attachments: params.attachments,
        activeFileContent: params.activeFileContent,
        rankedSnippets: params.rankedSnippets,
        instructions: params.instructions,
        profile: params.profile,
        toolObservations: observations,
        allowTools
      })
  })
}
