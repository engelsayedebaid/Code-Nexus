import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeCheckpoint,
  IdeConversation,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { AgentLoopGuard, MAX_EXECUTION_TOOL_TURNS } from './ide-agent-loop-guard'
import { runExecutionStepWithLiveStream } from './ide-agent-harness'
import {
  buildExecutionStepPrompt,
  parseStepOperationsFromAiOutput,
  parseToolCallsFromAiOutput
} from './ide-agent-prompts'
import { executeAgentReadOnlyTool } from './ide-agent-tools'
import type { IdeContextBudgetTracker } from './ide-context-budget'
import {
  applyCoordinatedFileOperation,
  type CoordinatorCallbacks
} from './ide-file-edit-coordinator'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import type { ResolvedModelExecutionProfile } from './harness/model-capability-registry'
import type { WorkspaceInstructionsBundle } from './harness/workspace-instructions-loader'

const MAX_STEP_RECOVERY_ATTEMPTS = 2

async function loadStepContextFiles(
  gateway: IdeWorkspaceGateway,
  step: IdePlanStep,
  plan: IdeTaskPlan
): Promise<{ relativePath: string; content: string | null }[]> {
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
  return currentFiles
}

function isRecoverableStepEditError(message: string): boolean {
  return (
    message.startsWith('Patch failed for ') ||
    message.includes('Ambiguous patch search block') ||
    message.includes('Could not locate target search block') ||
    message.includes('Unified diff')
  )
}

export async function executeSinglePlanStep(params: {
  host: EngineHostOps
  conv: IdeConversation
  plan: IdeTaskPlan
  step: IdePlanStep
  checkpoint: IdeCheckpoint
  baselineShaByFile: Map<string, string | null>
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  callbacks: CoordinatorCallbacks
  stepBudget: IdeContextBudgetTracker
  writeGuard: AgentLoopGuard
  completedSummaries: string[]
  modifiedFilesSet: Set<string>
  verificationCommands: Set<string>
  profile: ResolvedModelExecutionProfile
  instructions: WorkspaceInstructionsBundle
}): Promise<'completed' | 'canceled'> {
  const {
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
  } = params

  const stepGuard = new AgentLoopGuard(MAX_EXECUTION_TOOL_TURNS + MAX_STEP_RECOVERY_ATTEMPTS)
  const stepObservations: string[] = []
  let currentFiles = await loadStepContextFiles(gateway, step, plan)
  let recoveryAttempts = 0

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
      thinkingLevel: profile.selectedThinkingLevel,
      prompt: buildExecutionStepPrompt({
        plan,
        step,
        currentFiles,
        completedSummaries,
        roleLabel: run.config.multiAgentEnabled ? 'Carver Coder Agent' : 'Carver Agent',
        toolObservations: stepObservations,
        profile,
        instructions
      })
    })
    const { aiRes, streamedPaths } = stepResult

    if (!aiRes.ok) {
      step.status = 'failed'
      if (aiRes.canceled || run.abortController.signal.aborted) {
        return 'canceled'
      }
      throw new Error(aiRes.error)
    }

    const toolCalls = parseToolCallsFromAiOutput(aiRes.text)
    if (toolCalls && turnCheck.turn < MAX_EXECUTION_TOOL_TURNS) {
      for (const call of toolCalls.slice(0, profile.maxParallelTools)) {
        if (!(await host.waitIfPausedOrAborted(conv, run))) {
          return 'canceled'
        }
        const allowed = stepGuard.checkToolCall(call.tool, call.args)
        if (!allowed.allowed) {
          run.telemetry?.recordToolCall(true)
          stepObservations.push(`[Tool guard] ${allowed.reason}`)
          continue
        }
        run.telemetry?.recordToolCall(false)
        const obs = await executeAgentReadOnlyTool({
          call,
          mode: 'plan',
          gateway,
          budget: stepBudget,
          conv,
          attachmentStore: host.attachmentStore,
          signal: run.abortController.signal
        })
        if (!obs.ok) {
          stepGuard.recordFailure(call.tool, call.args)
        }
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

    const stepOutput = parseStepOperationsFromAiOutput(aiRes.text)
    if (!stepOutput) {
      run.telemetry?.recordFailedEdit()
      if (recoveryAttempts < MAX_STEP_RECOVERY_ATTEMPTS) {
        recoveryAttempts += 1
        stepObservations.push(
          '[Edit recovery required]: Your previous response was not valid step operations JSON. Output ONLY ```json { "summary": "...", "operations": [...], "verificationCommands": [] } ```.'
        )
        host.appendActivity(conv, {
          runId: run.runId,
          role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
          type: 'step.retrying',
          summary: `Retrying step "${step.title}" after invalid JSON format`,
          status: 'warning'
        })
        continue
      }
      step.status = 'failed'
      throw new Error(
        `Model returned invalid structured JSON for step "${step.title}". Switch models or retry.`
      )
    }

    for (const cmd of stepOutput.verificationCommands) {
      verificationCommands.add(cmd)
    }

    let stepFailedWithRecoverableError: string | null = null
    for (const op of stepOutput.operations) {
      if (!(await host.waitIfPausedOrAborted(conv, run))) {
        return 'canceled'
      }
      const rewriteCheck = writeGuard.checkFileRewrite(op.path)
      if (!rewriteCheck.allowed) {
        throw new Error(rewriteCheck.reason)
      }
      try {
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        run.telemetry?.recordFailedEdit()
        if (recoveryAttempts < MAX_STEP_RECOVERY_ATTEMPTS && isRecoverableStepEditError(msg)) {
          stepFailedWithRecoverableError = msg
          break
        }
        step.status = 'failed'
        throw error
      }
    }

    if (stepFailedWithRecoverableError) {
      recoveryAttempts += 1
      currentFiles = await loadStepContextFiles(gateway, step, plan)
      stepObservations.push(
        `[Edit recovery required]: ${stepFailedWithRecoverableError} Re-inspect the updated file contents provided above and emit an exact unique patch or complete modify operation.`
      )
      host.appendActivity(conv, {
        runId: run.runId,
        role: run.config.multiAgentEnabled ? 'coder' : 'orchestrator',
        type: 'step.retrying',
        summary: `Recovering edit on "${step.title}" (attempt ${recoveryAttempts}/${MAX_STEP_RECOVERY_ATTEMPTS})`,
        detail: stepFailedWithRecoverableError,
        status: 'warning'
      })
      continue
    }

    if (recoveryAttempts > 0) {
      run.telemetry?.recordRecoveredError()
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
    return 'completed'
  }
}
