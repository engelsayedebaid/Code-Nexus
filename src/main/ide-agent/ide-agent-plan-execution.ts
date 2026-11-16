import { randomUUID } from 'node:crypto'
import {
  isPlanApprovedForExecution,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeCheckpoint } from '../../shared/ide-agent/ide-agent-types'
import { AgentLoopGuard, MAX_EXECUTION_TOOL_TURNS } from './ide-agent-loop-guard'
import { runExecutionStepWithLiveStream } from './ide-agent-harness'
import {
  buildExecutionStepPrompt,
  parseStepOperationsFromAiOutput,
  parseToolCallsFromAiOutput
} from './ide-agent-prompts'
import { executeAgentReadOnlyTool } from './ide-agent-tools'
import { runPlanVerificationAndReport } from './ide-agent-verification'
import { IdeContextBudgetTracker } from './ide-context-budget'
import {
  applyCoordinatedFileOperation,
  type CoordinatorCallbacks
} from './ide-file-edit-coordinator'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

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

  const checkpoint: IdeCheckpoint = {
    id: randomUUID(),
    conversationId: conv.id,
    runId: run.runId,
    label: `Before Plan v${plan.version}: ${plan.objective.slice(0, 48)}`,
    createdAt: Date.now(),
    files: []
  }
  const baselineShaByFile = new Map<string, string | null>()
  const callbacks = makeCoordinatorCallbacks(host, run)

  try {
    plan.status = 'executing'
    plan.updatedAt = Date.now()
    host.setRunStatus(conv, run.runId, 'executing', 'Starting approved implementation...')

    for (const item of plan.affectedFiles) {
      if (item.action === 'mkdir' || item.action === 'delete_folder') {
        continue
      }
      const normalized = normalizeWorkspaceRelativePath(item.path)
      const readRes = await gateway.readTextFile(normalized, { allowSecretRead: false })
      const content = readRes.ok ? readRes.content : null
      baselineShaByFile.set(normalized, readRes.ok ? readRes.sha256 : null)
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
    const stepBudget = new IdeContextBudgetTracker()
    const writeGuard = new AgentLoopGuard(MAX_EXECUTION_TOOL_TURNS * Math.max(1, plan.steps.length))

    if (run.config.multiAgentEnabled) {
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'coder',
        type: 'agent.role_started',
        summary: 'Coder Agent applying approved steps',
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

      const contextPaths = Array.from(
        new Set(
          [...step.targetFiles, ...plan.affectedFiles.map((f) => f.path)].map(
            normalizeWorkspaceRelativePath
          )
        )
      ).slice(0, 12)

      const currentFiles: { relativePath: string; content: string | null }[] = []
      for (const relPath of contextPaths) {
        const readRes = await gateway.readTextFile(relPath)
        currentFiles.push({
          relativePath: relPath,
          content: readRes.ok ? readRes.content : null
        })
      }

      const stepGuard = new AgentLoopGuard(MAX_EXECUTION_TOOL_TURNS)
      const stepObservations: string[] = []
      let stepOutput = null as ReturnType<typeof parseStepOperationsFromAiOutput>
      let streamedPaths = new Set<string>()

      while (true) {
        const turnCheck = stepGuard.nextTurn()
        if (!turnCheck.allowed) {
          step.status = 'failed'
          throw new Error(turnCheck.reason)
        }

        const stepResult = await runExecutionStepWithLiveStream({
          host,
          conv,
          run,
          gateway,
          plan,
          prompt: buildExecutionStepPrompt({
            plan,
            step,
            currentFiles,
            completedSummaries,
            roleLabel: run.config.multiAgentEnabled ? 'Carver Coder Agent' : 'Carver Agent',
            toolObservations: stepObservations
          })
        })
        const aiRes = stepResult.aiRes
        streamedPaths = stepResult.streamedPaths

        if (!aiRes.ok) {
          step.status = 'failed'
          if (aiRes.canceled || run.abortController.signal.aborted) {
            host.setRunStatus(conv, null, 'canceled')
            return
          }
          throw new Error(aiRes.error)
        }

        const toolCalls = parseToolCallsFromAiOutput(aiRes.text)
        if (toolCalls && turnCheck.turn < MAX_EXECUTION_TOOL_TURNS) {
          for (const call of toolCalls.slice(0, 5)) {
            const obs = await executeAgentReadOnlyTool({
              call,
              mode: 'plan',
              gateway,
              budget: stepBudget,
              signal: run.abortController.signal
            })
            stepObservations.push(`[${obs.tool}] (${obs.ok ? 'ok' : 'error'}): ${obs.output}`)
            host.appendActivity(conv, {
              runId: run.runId,
              role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
              type: obs.activityType,
              summary: obs.summary,
              relativePath: obs.relativePath,
              status: obs.ok ? 'completed' : 'warning'
            })
          }
          continue
        }

        stepOutput = parseStepOperationsFromAiOutput(aiRes.text)
        if (!stepOutput) {
          step.status = 'failed'
          throw new Error(
            `Model returned invalid structured JSON for step "${step.title}". Switch models or retry.`
          )
        }
        break
      }

      for (const cmd of stepOutput.verificationCommands) {
        verificationCommands.add(cmd)
      }

      for (const op of stepOutput.operations) {
        if (!(await host.waitIfPausedOrAborted(conv, run))) {
          plan.status = 'failed'
          host.setRunStatus(conv, null, 'canceled')
          return
        }
        const rewriteCheck = writeGuard.checkFileRewrite(op.path)
        if (!rewriteCheck.allowed) {
          throw new Error(rewriteCheck.reason)
        }
        await applyCoordinatedFileOperation(
          {
            conv,
            plan,
            checkpoint,
            baselineShaByFile,
            runId: run.runId,
            mode: run.config.mode,
            multiAgentEnabled: run.config.multiAgentEnabled,
            liveEditSpeed: run.config.liveEditSpeed,
            dirtyPaths: run.dirtyPaths,
            gateway,
            op,
            modifiedFilesSet,
            alreadyStreamedPaths: streamedPaths
          },
          callbacks
        )
      }

      step.status = 'completed'
      completedSummaries.push(`${step.title}: ${stepOutput.summary}`)
      host.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
        type: 'step.completed',
        summary: stepOutput.summary,
        status: 'completed'
      })
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
      completedSummaries
    })
  } finally {
    if (activeRuns.get(conversationId) === run) {
      activeRuns.delete(conversationId)
    }
  }
}
