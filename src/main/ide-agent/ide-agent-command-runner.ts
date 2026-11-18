import { randomUUID } from 'node:crypto'
import {
  classifySensitiveCommand,
  isModeWriteAllowed,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeCheckpoint,
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { buildRepairFailurePrompt, parseStepOperationsFromAiOutput } from './ide-agent-prompts'
import {
  applyCoordinatedFileOperation,
  type CoordinatorCallbacks
} from './ide-file-edit-coordinator'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import { resolveModelExecutionProfile } from './harness/model-capability-registry'
import { redactSensitiveSecrets } from './harness/prompt-security-guard'
import { computeVerificationFailureSignature } from './harness/verification-policy'

export function inferCommandCategory(command: string): IdeCommandCategory {
  const lower = command.toLowerCase()
  if (/\b(vitest|jest|pytest|mocha|ava|test)\b/.test(lower)) {
    return 'test'
  }
  if (/\b(tsc|typecheck|tc|mypy|pyright)\b/.test(lower)) {
    return 'typecheck'
  }
  if (/\b(lint|eslint|oxlint|oxfmt|prettier|ruff|clippy)\b/.test(lower)) {
    return 'lint'
  }
  if (/\b(build|vite|webpack|rollup|cargo build)\b/.test(lower)) {
    return 'build'
  }
  return 'custom'
}

export function looksLikeExecutableCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 160 || trimmed.includes('\n')) {
    return false
  }
  return /^(?:\.\/gradlew|pnpm|npm|yarn|bun|npx|node|tsx|deno|vitest|jest|tsc|biome|eslint|prettier|oxlint|oxfmt|pytest|python3?|uv|poetry|ruff|mypy|cargo|go|make|dotnet|mvn|gradle|composer|php|bundle|rspec)\b/i.test(
    trimmed
  )
}

export async function executeVerifiedCommand(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  command: string
  category?: IdeCommandCategory
}): Promise<IdeCommandExecutionRecord | null> {
  const { host, conv, run, gateway, command, category } = params
  if (!isModeWriteAllowed(run.config.mode)) {
    throw new Error(`Command execution is disabled in ${run.config.mode} mode.`)
  }
  const sensitive = classifySensitiveCommand(command)
  if (sensitive) {
    const approved = await host.requestExplicitPermission(conv, run, {
      kind: sensitive.kind,
      title: `Allow sensitive command: ${command}`,
      detail: sensitive.reason,
      command
    })
    if (!approved) {
      const denied: IdeCommandExecutionRecord = {
        id: randomUUID(),
        conversationId: conv.id,
        runId: run.runId,
        command,
        cwd: gateway.target.workspacePath,
        category: category ?? inferCommandCategory(command),
        status: 'denied',
        exitCode: null,
        stdoutTail: '',
        stderrTail: 'Denied by user policy.',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        durationMs: 0
      }
      conv.commandExecutions.push(denied)
      host.saveAndPublish(conv)
      host.emit({ type: 'command_done', conversationId: conv.id, execution: denied })
      return denied
    }
  }

  const record: IdeCommandExecutionRecord = {
    id: randomUUID(),
    conversationId: conv.id,
    runId: run.runId,
    command,
    cwd: gateway.target.workspacePath,
    category: category ?? inferCommandCategory(command),
    status: 'running',
    exitCode: null,
    stdoutTail: '',
    stderrTail: '',
    startedAt: Date.now()
  }
  conv.commandExecutions.push(record)
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'orchestrator',
    type: 'command.started',
    summary: `Running: ${command}`,
    command,
    status: 'running'
  })

  const res = await gateway.runShellCommand(command, {
    signal: run.abortController.signal,
    onOutput: (stream, chunk) => {
      const safeChunk = redactSensitiveSecrets(chunk).text
      if (stream === 'stdout') {
        record.stdoutTail = (record.stdoutTail + safeChunk).slice(-16_000)
      } else {
        record.stderrTail = (record.stderrTail + safeChunk).slice(-16_000)
      }
      host.emit({
        type: 'command_output',
        conversationId: conv.id,
        commandId: record.id,
        stream,
        chunk: safeChunk
      })
    }
  })

  record.exitCode = res.exitCode
  record.stdoutTail = redactSensitiveSecrets(res.stdout.slice(-16_000)).text
  record.stderrTail = redactSensitiveSecrets(res.stderr.slice(-16_000)).text
  record.finishedAt = Date.now()
  record.durationMs = res.durationMs
  record.status = res.canceled
    ? 'canceled'
    : !res.timedOut && res.exitCode === 0
      ? 'passed'
      : 'failed'
  run.telemetry?.recordVerificationOutcome(record.status === 'passed')

  host.saveAndPublish(conv)
  host.emit({ type: 'command_done', conversationId: conv.id, execution: record })
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'orchestrator',
    type: 'command.finished',
    summary: `${command} -> ${record.status} (exit ${record.exitCode ?? 'n/a'})`,
    command,
    status: record.status === 'passed' ? 'completed' : 'error',
    expandablePayload: { stdoutTail: record.stdoutTail, stderrTail: record.stderrTail }
  })
  return record
}

export async function attemptTestFailureRepair(params: {
  host: EngineHostOps
  callbacks: CoordinatorCallbacks
  conv: IdeConversation
  plan: IdeTaskPlan
  checkpoint: IdeCheckpoint
  baselineShaByFile: Map<string, string | null>
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  failedCommand: IdeCommandExecutionRecord
  modifiedFilesSet: Set<string>
  executedCmdIds: string[]
  seenFailureSignatures?: Set<string>
}): Promise<{ fixed: boolean; latestRecord: IdeCommandExecutionRecord }> {
  const { host, conv, plan, run, gateway, failedCommand } = params
  const sig = computeVerificationFailureSignature({
    command: failedCommand.command,
    exitCode: failedCommand.exitCode,
    stdoutTail: failedCommand.stdoutTail,
    stderrTail: failedCommand.stderrTail
  })
  if (params.seenFailureSignatures?.has(sig)) {
    return { fixed: false, latestRecord: failedCommand }
  }
  params.seenFailureSignatures?.add(sig)

  host.appendActivity(conv, {
    runId: run.runId,
    role: 'test-fixer',
    type: 'agent.role_started',
    summary: `Analyzing failure in "${failedCommand.command}"`,
    status: 'running'
  })
  const repairProfile = resolveModelExecutionProfile({
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    taskKind: 'repair'
  })
  const currentFiles: { relativePath: string; content: string | null }[] = []
  for (const f of plan.affectedFiles.slice(0, 10)) {
    const readRes = await gateway.readTextFile(f.path)
    currentFiles.push({
      relativePath: normalizeWorkspaceRelativePath(f.path),
      content: readRes.ok ? readRes.content : null
    })
  }
  const aiRes = await host.aiClient.complete({
    workspacePath: gateway.target.workspacePath,
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    thinkingLevel: repairProfile.selectedThinkingLevel,
    prompt: buildRepairFailurePrompt({
      plan,
      failedCommand: failedCommand.command,
      stdoutTail: failedCommand.stdoutTail,
      stderrTail: failedCommand.stderrTail,
      currentFiles,
      profile: repairProfile
    }),
    signal: run.abortController.signal
  })
  if (!aiRes.ok) {
    return { fixed: false, latestRecord: failedCommand }
  }
  const parsed = parseStepOperationsFromAiOutput(aiRes.text)
  if (!parsed || parsed.operations.length === 0) {
    return { fixed: false, latestRecord: failedCommand }
  }
  let appliedAny = false
  for (const op of parsed.operations) {
    try {
      await applyCoordinatedFileOperation(
        {
          conv,
          plan,
          checkpoint: params.checkpoint,
          baselineShaByFile: params.baselineShaByFile,
          runId: run.runId,
          mode: run.config.mode,
          multiAgentEnabled: run.config.multiAgentEnabled,
          liveEditSpeed: run.config.liveEditSpeed,
          dirtyPaths: run.dirtyPaths,
          gateway,
          op,
          modifiedFilesSet: params.modifiedFilesSet
        },
        params.callbacks
      )
      appliedAny = true
    } catch {
      run.telemetry?.recordFailedEdit()
    }
  }
  if (!appliedAny) {
    return { fixed: false, latestRecord: failedCommand }
  }
  const retryCmd = await executeVerifiedCommand({
    host,
    conv,
    run,
    gateway,
    command: failedCommand.command,
    category: failedCommand.category
  })
  if (retryCmd) {
    params.executedCmdIds.push(retryCmd.id)
  }
  const fixed = retryCmd?.status === 'passed'
  if (fixed) {
    run.telemetry?.recordRecoveredError()
  }
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'test-fixer',
    type: 'agent.role_completed',
    summary: `Repair retry finished: ${retryCmd?.status ?? 'done'}`,
    status: fixed ? 'completed' : 'warning'
  })
  return { fixed, latestRecord: retryCmd ?? failedCommand }
}
