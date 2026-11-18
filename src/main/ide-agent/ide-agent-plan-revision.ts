import { randomUUID } from 'node:crypto'
import type { IdeConversation, IdeTaskPlan } from '../../shared/ide-agent/ide-agent-types'
import {
  buildRevisePlanPrompt,
  formatPlanIntroMarkdown,
  parsePlanJsonFromAiOutput
} from './ide-agent-prompts'
import { buildPlanRecord } from './ide-agent-run-lifecycle'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import { resolveModelExecutionProfile } from './harness/model-capability-registry'
import { loadTrustedWorkspaceInstructions } from './harness/workspace-instructions-loader'

export function launchPlanRevisionRun(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  conv: IdeConversation
  plan: IdeTaskPlan
  note: string
  runControl: ActiveRunControl
  gateway: IdeWorkspaceGateway
}): void {
  const { host, activeRuns, conv, plan, note, runControl, gateway } = params
  void (async () => {
    try {
      const profile = resolveModelExecutionProfile({
        agentId: runControl.config.agentId,
        modelId: runControl.config.modelId,
        taskKind: 'plan'
      })
      const [snapshot, instructions] = await Promise.all([
        gateway.inspectWorkspace([], runControl.abortController.signal),
        loadTrustedWorkspaceInstructions({
          gateway,
          maxRulesChars: profile.allocation.projectRulesTokens * 4,
          signal: runControl.abortController.signal
        })
      ])
      const aiRes = await host.aiClient.complete({
        workspacePath: gateway.target.workspacePath,
        agentId: runControl.config.agentId,
        modelId: runControl.config.modelId,
        thinkingLevel: profile.selectedThinkingLevel,
        prompt: buildRevisePlanPrompt({
          previousPlan: plan,
          revisionNote: note,
          snapshot,
          attachments: [],
          instructions,
          profile
        }),
        signal: runControl.abortController.signal
      })
      if (!aiRes.ok) {
        if (aiRes.canceled || runControl.abortController.signal.aborted) {
          const nextStatus = plan.status === 'awaiting_approval' ? 'awaiting_approval' : 'canceled'
          host.setRunStatus(conv, null, nextStatus)
          return
        }
        throw new Error(aiRes.error)
      }
      const rawNext = parsePlanJsonFromAiOutput(aiRes.text, plan.requestSummary)
      if (!rawNext) {
        throw new Error('Model did not return a valid revised plan JSON.')
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
      const fallbackStatus = plan.status === 'awaiting_approval' ? 'awaiting_approval' : 'canceled'
      if (runControl.abortController.signal.aborted) {
        host.setRunStatus(conv, null, fallbackStatus)
        return
      }
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
      host.setRunStatus(
        conv,
        null,
        plan.status === 'awaiting_approval' ? 'awaiting_approval' : 'failed',
        msg
      )
    } finally {
      if (activeRuns.get(conv.id) === runControl) {
        activeRuns.delete(conv.id)
      }
    }
  })()
}
