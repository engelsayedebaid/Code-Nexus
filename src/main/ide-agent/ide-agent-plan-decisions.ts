import { randomUUID } from 'node:crypto'
import { computeIdePlanHash } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import { executeApprovedPlanRun } from './ide-agent-plan-execution'
import {
  buildRevisePlanPrompt,
  formatPlanIntroMarkdown,
  parsePlanJsonFromAiOutput
} from './ide-agent-prompts'
import { buildPlanRecord } from './ide-agent-run-lifecycle'
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
    plan.status = 'superseded'
    plan.updatedAt = Date.now()
    plan.approvalRecord = {
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      decision: 'revision_requested',
      decidedAt: Date.now(),
      agentId: conv.agentId,
      modelId: conv.modelId,
      note
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

    void (async () => {
      try {
        const snapshot = await gateway.inspectWorkspace()
        const aiRes = await host.aiClient.complete({
          workspacePath: gateway.target.workspacePath,
          agentId: runControl.config.agentId,
          modelId: runControl.config.modelId,
          prompt: buildRevisePlanPrompt({
            previousPlan: plan,
            revisionNote: note,
            snapshot,
            attachments: []
          }),
          signal: runControl.abortController.signal
        })
        if (!aiRes.ok) {
          if (aiRes.canceled || runControl.abortController.signal.aborted) {
            host.setRunStatus(conv, null, 'canceled')
            return
          }
          throw new Error(aiRes.error)
        }
        const rawNext = parsePlanJsonFromAiOutput(aiRes.text, plan.requestSummary)
        if (!rawNext) {
          throw new Error('Model did not return a valid revised plan JSON.')
        }
        const revised = buildPlanRecord({
          conversation: conv,
          requestSummary: plan.requestSummary,
          raw: rawNext,
          version: plan.version + 1,
          revisionNotes: [...plan.revisionNotes, note]
        })
        conv.plans.push(revised)
        conv.activePlanId = revised.id
        conv.messages.push({
          id: randomUUID(),
          conversationId: conv.id,
          role: 'assistant',
          mode: conv.mode,
          text: formatPlanIntroMarkdown(revised),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: conv.agentId,
          modelId: conv.modelId,
          planId: revised.id,
          runId: runControl.runId
        })
        host.appendActivity(conv, {
          runId: runControl.runId,
          role: 'planner',
          type: 'plan.generated',
          summary: `Revised Plan v${revised.version} awaiting approval`,
          status: 'completed'
        })
        host.emit({ type: 'plan_proposed', conversationId: conv.id, plan: revised })
        host.setRunStatus(conv, null, 'awaiting_approval')
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        conv.messages.push({
          id: randomUUID(),
          conversationId: conv.id,
          role: 'assistant',
          mode: conv.mode,
          text: `Error revising plan: ${msg}`,
          error: msg,
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
        host.setRunStatus(conv, null, 'failed', msg)
      } finally {
        if (activeRuns.get(conv.id) === runControl) {
          activeRuns.delete(conv.id)
        }
      }
    })()
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
      const latest = host.store.getConversation(conv.id)
      if (!latest) {
        return
      }
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
      latest.messages.push({
        id: randomUUID(),
        conversationId: latest.id,
        role: 'assistant',
        mode: 'agent',
        text: `Execution failed: ${errText}`,
        error: errText,
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
