import { mergeCommandEnvironment } from '../../../shared/command-environment'
import { textGenerationFailure } from '../../../shared/text-generation-failure-copy'
import {
  cleanGeneratedCommitMessage,
  sanitizeAgentFailureDetail
} from '../../../shared/source-control/ai/generation/commit-message-agent-output'
import { wslDistroForCommand } from '../../../shared/wsl-paths'
import type { CommitMessagePlan } from '../../../shared/source-control/ai/generation/commit-message-plan'
import { OpenCodeTextTaskError, runOwnedOpenCodeTextTask } from './opencode-owned-text-task'
import { runOpenCodeWslTextTask } from './wsl/opencode-wsl-text-task'
import { killSourceControlAgentProcess } from '../../text-generation/source-control-agent-termination'
import {
  clearLocalGenerationCancelToken,
  localGenerationLaneKey,
  setLocalGenerationCancelToken
} from '../../text-generation/source-control-generation-lanes'
import { processEnvWithoutAgentSession } from '../../../shared/agent-launch/startup/parent-agent-session-env'
import { textGenerationTimeoutMs } from '../../text-generation/source-control-generation-limits'
import { captureAgentGenerationFailureOutput } from '../../text-generation/agent-failure-output'
import type {
  InternalTextGenerationResult,
  LocalGenerationTarget,
  SpawnSourceControlAgent,
  TextGenerationOperation
} from '../../text-generation/source-control-text-generation-types'

export async function runOpenCodeTextTask(input: {
  plan: CommitMessagePlan
  target: LocalGenerationTarget
  operation: TextGenerationOperation
  spawnAgent: SpawnSourceControlAgent
  shouldExecute?: () => boolean
  legacyVariantFlag?: boolean
  laneId?: string
  timeoutMs?: number
}): Promise<InternalTextGenerationResult> {
  const task = input.plan.openCodeTask
  if (!task || input.plan.stdinPayload === null) {
    return {
      success: false,
      ...textGenerationFailure('agentCouldNotStart', { label: input.plan.label })
    }
  }
  const budgetMs = textGenerationTimeoutMs(input.operation, input.timeoutMs)
  const canceled = new AbortController()
  // WSL runtime preparation counts against this deadline too; it is not a separate budget.
  const deadline = AbortSignal.timeout(budgetMs)
  const signal = AbortSignal.any([canceled.signal, deadline])
  const cancel = () => canceled.abort()
  const lane = localGenerationLaneKey(input.operation, input.target.cwd, input.laneId)
  setLocalGenerationCancelToken(lane, cancel)
  try {
    if (input.shouldExecute?.() === false) {
      cancel()
      canceled.signal.throwIfAborted()
    }
    const distro =
      process.platform === 'win32'
        ? wslDistroForCommand(input.target.cwd, input.target.wslDistro)
        : null
    const common = {
      binary: input.plan.binary,
      prefixArgs: task.prefixArgs,
      cwd: input.target.cwd,
      prompt: input.plan.stdinPayload,
      runArgs: task.runArgs,
      legacyVariantFlag: input.legacyVariantFlag,
      operation: input.operation,
      signal
    }
    const rawOutput = distro
      ? await runOpenCodeWslTextTask(
          {
            ...common,
            distro,
            env: input.target.env,
            commandEnv: input.plan.env,
            timeoutMs: budgetMs,
            shouldExecute: input.shouldExecute
          },
          { spawnAgent: input.spawnAgent }
        )
      : await runOwnedOpenCodeTextTask({
          ...common,
          env:
            mergeCommandEnvironment(input.target.env, input.plan.env, process.platform) ??
            processEnvWithoutAgentSession(),
          spawn: input.spawnAgent,
          stop: killSourceControlAgentProcess,
          shouldExecute: input.shouldExecute
        })
    const cleaned = cleanGeneratedCommitMessage(rawOutput)
    if (!cleaned) {
      throw new OpenCodeTextTaskError('session')
    }
    return { success: true, rawOutput: cleaned, agentLabel: input.plan.label }
  } catch (error) {
    if (
      canceled.signal.aborted ||
      (error instanceof OpenCodeTextTaskError && error.stage === 'superseded')
    ) {
      return { success: false, error: 'Generation canceled.', canceled: true }
    }
    if (deadline.aborted) {
      return {
        success: false,
        ...textGenerationFailure('timedOut', {
          seconds: Math.round(budgetMs / 1000)
        })
      }
    }
    const rawCause =
      error instanceof OpenCodeTextTaskError
        ? error.cause instanceof Error
          ? error.cause.message
          : typeof error.cause === 'string'
            ? error.cause
            : error.message
        : error instanceof Error
          ? error.message
          : ''
    const detail = rawCause ? sanitizeAgentFailureDetail(rawCause) : ''
    const failure = textGenerationFailure(
      error instanceof OpenCodeTextTaskError && error.stage === 'session'
        ? 'agentReportedError'
        : 'agentCouldNotStart',
      { label: input.plan.label }
    )
    const failureOutput = detail
      ? (captureAgentGenerationFailureOutput(input.plan.label, null, '', detail) ?? undefined)
      : undefined
    return {
      success: false,
      ...failure,
      ...(detail ? { error: `${failure.error} ${detail}`, errorDetail: detail } : {}),
      ...(failureOutput ? { failureOutput } : {})
    }
  } finally {
    clearLocalGenerationCancelToken(lane, cancel)
  }
}
