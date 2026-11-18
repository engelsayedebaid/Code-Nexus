import { randomUUID } from 'node:crypto'
import {
  isPlanApprovedForExecution,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeCheckpoint } from '../../shared/ide-agent/ide-agent-types'
import { AgentLoopGuard, MAX_EXECUTION_TOOL_TURNS } from './ide-agent-loop-guard'
import { executeSinglePlanStep } from './ide-agent-step-runner'
import { runPlanVerificationAndReport } from './ide-agent-verification'
import { IdeContextBudgetTracker } from './ide-context-budget'
import type { CoordinatorCallbacks } from './ide-file-edit-coordinator'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import { resolveModelExecutionProfile } from './harness/model-capability-registry'
import { extractDiagnosticErrorSignatures } from './harness/verification-policy'
import { loadTrustedWorkspaceInstructions } from './harness/workspace-instructions-loader'

function makeCoordinatorCallbacks(
  host: EngineHostOps,
  run: ActiveRunControl
): CoordinatorCallbacks {
  return {
    emit: host.emit,
    appendActivity: host.appendActivity,
    saveAndPublish: (c) => host.saveAndPublish(c),
    requestExplicitPermission: (c, p) => host.requestExplicitPermission(c, run, p),
    waitIfPausedOrAborted: (c) => host.waitIfPausedOrAborted(c, run),
    chunkDelayMs: host.chunkDelayMs
  }
}

export async function executeApprovedPlanRun(params: {
  host: EngineHostOps
  conversationId: string
  planId: string
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  activeRuns: Map<string, ActiveRunControl>
}): Promise<void> {
  const { host, conversationId, planId, run, gateway, activeRuns } = params
  const conv = host.requireConversation(conversationId)
  const plan = conv.plans.find((p) => p.id === planId)
  if (!plan) {
    throw new Error(`Approved plan "${planId}" missing.`)
  }

  const gateCheck = isPlanApprovedForExecution(plan)
  if (!gateCheck.ok) {
    throw new Error(gateCheck.reason)
  }

  const profile = resolveModelExecutionProfile({
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    taskKind: 'step',
    complexity: plan.estimatedComplexity
  })

  const checkpoint: IdeCheckpoint = {
    id: randomUUID(),
    conversationId: conv.id,
    runId: run.runId,
    label: `Before changes: ${plan.objective.slice(0, 48)}`,
    createdAt: Date.now(),
    files: []
  }
  const baselineShaByFile = new Map<string, string | null>()
  const callbacks = makeCoordinatorCallbacks(host, run)

  try {
    plan.status = 'executing'
    plan.updatedAt = Date.now()
    host.setRunStatus(conv, run.runId, 'executing', 'Starting implementation...')

    const shouldProbeBaselineDiag =
      plan.testsAndVerification.length === 0 && Boolean(gateway.getDiagnostics)
    const [instructions, baselineDiag] = await Promise.all([
      loadTrustedWorkspaceInstructions({
        gateway,
        maxRulesChars: profile.allocation.projectRulesTokens * 4,
        signal: run.abortController.signal
      }),
      shouldProbeBaselineDiag && gateway.getDiagnostics
        ? gateway.getDiagnostics(run.abortController.signal).catch(() => null)
        : Promise.resolve(null)
    ])
    const baselineDiagnosticErrors =
      baselineDiag && baselineDiag.available && !baselineDiag.passed
        ? extractDiagnosticErrorSignatures(baselineDiag.details)
        : new Set<string>()

    for (const item of plan.affectedFiles) {
      if (item.action === 'mkdir' || item.action === 'delete_folder') {
        continue
      }
      const normalized = normalizeWorkspaceRelativePath(
        item.action === 'rename' && item.fromPath ? item.fromPath : item.path
      )
      const readRes = await gateway.readTextFile(normalized, { allowSecretRead: false })
      if (!readRes.ok) {
        continue
      }
      const content = readRes.content
      baselineShaByFile.set(normalized, readRes.sha256)
      checkpoint.files.push({
        relativePath: normalized,
        existedBefore: content !== null,
        beforeContent: content,
        afterContent: content,
        status: 'pending'
      })
    }
    conv.checkpoints.push(checkpoint)
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'checkpoint.created',
      summary: `Saved recovery checkpoint (${checkpoint.files.length} scoped files)`,
      status: 'completed'
    })

    const completedSummaries: string[] = []
    const modifiedFilesSet = new Set<string>()
    const verificationCommands = new Set<string>(plan.testsAndVerification)
    const stepBudget = new IdeContextBudgetTracker({
      budgetTokens: profile.allocation.totalContextTokens
    })
    const writeGuard = new AgentLoopGuard(
      (MAX_EXECUTION_TOOL_TURNS + 2) * Math.max(1, plan.steps.length)
    )

    if (run.config.multiAgentEnabled) {
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'coder',
        type: 'agent.role_started',
        summary: 'Coder Agent applying requested changes',
        status: 'running'
      })
    }

    for (const step of plan.steps) {
      if (!(await host.waitIfPausedOrAborted(conv, run))) {
        plan.status = 'failed'
        host.setRunStatus(conv, null, 'canceled', 'Execution canceled by user')
        return
      }

      step.status = 'in_progress'
      host.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
        type: 'step.started',
        summary: `Step ${step.index + 1}/${plan.steps.length}: ${step.title}`,
        detail: step.detail,
        status: 'running'
      })

      const outcome = await executeSinglePlanStep({
        host,
        conv,
        plan,
        step,
        checkpoint,
        baselineShaByFile,
        run,
        gateway,
        callbacks,
        stepBudget,
        writeGuard,
        completedSummaries,
        modifiedFilesSet,
        verificationCommands,
        profile,
        instructions
      })
      if (outcome === 'canceled') {
        plan.status = 'failed'
        host.setRunStatus(conv, null, 'canceled')
        return
      }
    }

    if (run.config.multiAgentEnabled) {
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'coder',
        type: 'agent.role_completed',
        summary: `Coder Agent finished ${plan.steps.length} step(s)`,
        status: 'completed'
      })
    }

    await runPlanVerificationAndReport({
      host,
      callbacks,
      conv,
      plan,
      checkpoint,
      baselineShaByFile,
      run,
      gateway,
      modifiedFilesSet,
      verificationCommands,
      completedSummaries,
      baselineDiagnosticErrors
    })
  } finally {
    if (run.telemetry) {
      run.telemetry.finalizeIntoConversation(conv)
      host.saveAndPublish(conv)
    }
    if (activeRuns.get(conversationId) === run) {
      activeRuns.delete(conversationId)
    }
  }
}
