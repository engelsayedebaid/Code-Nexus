import { randomUUID } from 'node:crypto'
import { classifySensitiveFilePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeChatMessage, IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import { executeApprovedPlanRun } from './ide-agent-plan-execution'
import { formatPlanIntroMarkdown, parsePlanOrAnswerFromAiOutput } from './ide-agent-prompts'
import { buildPlanRecord } from './ide-agent-turn-helpers'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

export async function finalizePlannerOutput(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  requestText: string
  aiText: string
}): Promise<void> {
  const { host, activeRuns, conv, run, gateway, requestText, aiText } = params
  const triage = parsePlanOrAnswerFromAiOutput(aiText, requestText)
  if (!triage) {
    throw new Error(
      'Model response did not include a valid structured implementation plan JSON. Try revising or switching models.'
    )
  }

  if (triage.kind === 'answer') {
    const answerMessage: IdeChatMessage = {
      id: randomUUID(),
      conversationId: conv.id,
      role: 'assistant',
      mode: 'ask',
      text: triage.message,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      runId: run.runId
    }
    conv.messages.push(answerMessage)
    host.emit({ type: 'message_complete', conversationId: conv.id, message: answerMessage })
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.completed',
      summary: 'Answered directly (no file changes needed)',
      status: 'completed'
    })
    const activePlan = conv.plans.find((p) => p.id === conv.activePlanId)
    host.setRunStatus(
      conv,
      null,
      activePlan?.status === 'awaiting_approval' ? 'awaiting_approval' : 'completed'
    )
    return
  }

  const parsedPlan = triage.plan
  const plan = buildPlanRecord({
    conversation: conv,
    requestSummary: requestText,
    raw: parsedPlan,
    version: (conv.plans.at(-1)?.version ?? 0) + 1
  })

  for (const prev of conv.plans) {
    if (prev.status === 'awaiting_approval' || prev.status === 'draft') {
      prev.status = 'superseded'
    }
  }
  conv.plans.push(plan)
  conv.activePlanId = plan.id

  const shouldAutoExecute =
    run.config.mode === 'agent' &&
    parsedPlan.requiresApproval === false &&
    plan.estimatedComplexity === 'low' &&
    plan.affectedFiles.length > 0 &&
    plan.affectedFiles.length <= 2 &&
    plan.affectedFiles.every(
      (file) =>
        file.action !== 'delete' &&
        file.action !== 'delete_folder' &&
        classifySensitiveFilePath(file.path, 'write') === null
    )

  if (shouldAutoExecute) {
    plan.status = 'approved'
    plan.updatedAt = Date.now()
    plan.approvalRecord = {
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      decision: 'approved',
      decidedAt: Date.now(),
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      note: 'auto_approved_small_change'
    }
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'plan.approved',
      summary: `Auto-approved small scoped edit (${plan.affectedFiles.length} file(s))`,
      status: 'completed'
    })
    await executeApprovedPlanRun({
      host,
      conversationId: conv.id,
      planId: plan.id,
      run,
      gateway,
      activeRuns
    })
    return
  }

  const planMessage: IdeChatMessage = {
    id: randomUUID(),
    conversationId: conv.id,
    role: 'assistant',
    mode: run.config.mode,
    text: formatPlanIntroMarkdown(plan),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    teamMode: run.config.multiAgentEnabled,
    planId: plan.id,
    runId: run.runId
  }
  conv.messages.push(planMessage)
  host.appendActivity(conv, {
    runId: run.runId,
    role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
    type: 'plan.generated',
    summary: `Plan v${plan.version} ready for approval (${plan.affectedFiles.length} files, ${plan.steps.length} steps)`,
    status: 'completed',
    expandablePayload: { planId: plan.id, planHash: plan.planHash }
  })
  if (run.config.multiAgentEnabled) {
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'planner',
      type: 'agent.role_completed',
      summary: 'Planner Agent finished plan proposal',
      status: 'completed'
    })
  }
  host.emit({ type: 'plan_proposed', conversationId: conv.id, plan })
  host.setRunStatus(
    conv,
    null,
    'awaiting_approval',
    'Waiting for user approval before modifying files'
  )
}
