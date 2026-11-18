import { randomUUID } from 'node:crypto'
import { computeIdePlanHash } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import { executeApprovedPlanRun } from './ide-agent-plan-execution'
import { launchPlanRevisionRun } from './ide-agent-plan-revision'
import {
  pickExecutionSettings,
  type ActiveRunControl,
  type EngineHostOps,
  type ResolveWorkspaceGateway
} from './ide-agent-runtime-types'

export async function processPlanDecision(params: {
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
  planId: string
  worktreeSelector?: string
  decision: 'approve' | 'reject' | 'revise'
  revisionNote?: string
  agentId?: string
  modelId?: string
}): Promise<IdeConversation> {
  const { host, activeRuns, resolveGateway, dirtySet } = params
  const conv = host.requireConversation(params.conversationId)
  const plan = conv.plans.find((p) => p.id === params.planId)
  if (!plan) {
    throw new Error(`Plan "${params.planId}" not found.`)
  }
  if (params.agentId !== undefined || params.modelId !== undefined) {
    const selection = params.resolveSelectionUpdate(conv, params)
    conv.agentId = selection.agentId
    conv.modelId = selection.modelId
  }

  if (params.decision === 'reject') {
    if (activeRuns.has(conv.id) || plan.status === 'executing') {
      throw new Error('Stop the active execution first before rejecting the plan.')
    }
    if (plan.status !== 'awaiting_approval' && plan.status !== 'draft') {
      throw new Error(`Plan v${plan.version} is "${plan.status}" and cannot be rejected.`)
    }
    plan.status = 'rejected'
    plan.updatedAt = Date.now()
    plan.approvalRecord = {
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      decision: 'rejected',
      decidedAt: Date.now(),
      agentId: conv.agentId,
      modelId: conv.modelId,
      ...(params.revisionNote ? { note: params.revisionNote } : {})
    }
    host.appendActivity(conv, {
      runId: randomUUID(),
      role: 'orchestrator',
      type: 'plan.rejected',
      summary: `Plan v${plan.version} rejected by user`,
      status: 'warning'
    })
    conv.messages.push({
      id: randomUUID(),
      conversationId: conv.id,
      role: 'system',
      mode: conv.mode,
      text: `Plan v${plan.version} rejected. No workspace files were modified.`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      planId: plan.id
    })
    host.setRunStatus(conv, null, 'idle', 'Plan rejected')
    return conv
  }

  if (params.decision === 'revise') {
    const note = params.revisionNote?.trim()
    if (!note) {
      throw new Error('Revision instructions are required to revise the plan.')
    }
    if (activeRuns.has(conv.id)) {
      throw new Error('An active run is already in progress.')
    }
    const selector = params.worktreeSelector ?? conv.workspacePath
    const gateway = await resolveGateway(selector)
    const runControl = params.createRunControl(conv, selector, dirtySet)
    host.appendActivity(conv, {
      runId: runControl.runId,
      role: 'planner',
      type: 'plan.revision_requested',
      summary: `Revising Plan v${plan.version}`,
      detail: note,
      status: 'running'
    })
    conv.messages.push({
      id: randomUUID(),
      conversationId: conv.id,
      role: 'user',
      mode: conv.mode,
      text: `Revise plan: ${note}`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    host.setRunStatus(
      conv,
      runControl.runId,
      'planning',
      'Generating revised implementation plan...'
    )
    launchPlanRevisionRun({ host, activeRuns, conv, plan, note, runControl, gateway })
    return conv
  }

  if (activeRuns.has(conv.id)) {
    throw new Error('Another run is already active in this conversation.')
  }
  if (plan.status !== 'awaiting_approval') {
    throw new Error(`Plan v${plan.version} is "${plan.status}" and cannot be approved.`)
  }
  if (computeIdePlanHash(plan) !== plan.planHash) {
    throw new Error('Plan integrity check failed: plan content no longer matches its hash.')
  }

  conv.mode = 'agent'
  plan.status = 'approved'
  plan.updatedAt = Date.now()
  plan.approvalRecord = {
    planId: plan.id,
    planVersion: plan.version,
    planHash: plan.planHash,
    decision: 'approved',
    decidedAt: Date.now(),
    agentId: conv.agentId,
    modelId: conv.modelId
  }

  const selector = params.worktreeSelector ?? conv.workspacePath
  const gateway = await resolveGateway(selector)
  const runControl = params.createRunControl(conv, selector, dirtySet)
  host.appendActivity(conv, {
    runId: runControl.runId,
    role: 'orchestrator',
    type: 'plan.approved',
    summary: `Approved Plan v${plan.version} (hash ${plan.planHash.slice(0, 8)})`,
    status: 'completed',
    expandablePayload: { planId: plan.id, planVersion: plan.version, planHash: plan.planHash }
  })
  host.saveAndPublish(conv, pickExecutionSettings(conv))

  void executeApprovedPlanRun({
    host,
    conversationId: conv.id,
    planId: plan.id,
    run: runControl,
    gateway,
    activeRuns
  }).catch((error) => {
    if (runControl.abortController.signal.aborted) {
      return
    }
    try {
      const latest = host.requireConversation(conv.id)
      const errText = error instanceof Error ? error.message : String(error)
      const latestPlan = latest.plans.find((p) => p.id === plan.id)
      if (latestPlan) {
        latestPlan.status = 'failed'
      }
      host.appendActivity(latest, {
        runId: runControl.runId,
        role: 'orchestrator',
        type: 'run.failed',
        summary: `Execution failed: ${errText}`,
        status: 'error'
      })
      const now = Date.now()
      latest.messages.push({
        id: randomUUID(),
        conversationId: latest.id,
        role: 'assistant',
        mode: 'agent',
        text: `Execution failed: ${errText}`,
        error: errText,
        createdAt: now,
        updatedAt: now,
        runId: runControl.runId,
        planId: plan.id
      })
      host.setRunStatus(latest, null, 'failed', errText)
    } catch {
      // Ignore post-disposal errors when DB store was closed after cancellation or shutdown.
    }
  })

  return conv
}
