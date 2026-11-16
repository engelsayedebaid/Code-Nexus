import { randomUUID } from 'node:crypto'
import {
  classifySensitiveCommand,
  isModeWriteAllowed,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeCheckpoint,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { parseStepOperationsFromAiOutput } from './ide-agent-prompts'
import { buildRepairFailurePrompt } from './ide-agent-prompts'
import {
  applyCoordinatedFileOperation,
  type CoordinatorCallbacks
} from './ide-file-edit-coordinator'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

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
  return /^(?:pnpm|npm|yarn|bun|npx|node|vitest|jest|tsc|oxlint|oxfmt|pytest|python|cargo|go|make)\b/i.test(
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
      if (stream === 'stdout') {
        record.stdoutTail = (record.stdoutTail + chunk).slice(-16_000)
      } else {
        record.stderrTail = (record.stderrTail + chunk).slice(-16_000)
      }
      host.emit({
        type: 'command_output',
        conversationId: conv.id,
        commandId: record.id,
        stream,
        chunk
      })
    }
  })

  record.exitCode = res.exitCode
  record.stdoutTail = res.stdout.slice(-16_000)
  record.stderrTail = res.stderr.slice(-16_000)
  record.finishedAt = Date.now()
  record.durationMs = res.durationMs
  record.status = res.canceled
    ? 'canceled'
    : !res.timedOut && res.exitCode === 0
      ? 'passed'
      : 'failed'

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
}): Promise<boolean> {
  const { host, conv, plan, run, gateway, failedCommand } = params
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'test-fixer',
    type: 'agent.role_started',
    summary: `Analyzing failure in "${failedCommand.command}"`,
    status: 'running'
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
    prompt: buildRepairFailurePrompt({
      plan,
      failedCommand: failedCommand.command,
      stdoutTail: failedCommand.stdoutTail,
      stderrTail: failedCommand.stderrTail,
      currentFiles
    }),
    signal: run.abortController.signal
  })
  if (!aiRes.ok) {
    return false
  }
  const parsed = parseStepOperationsFromAiOutput(aiRes.text)
  if (!parsed || parsed.operations.length === 0) {
    return false
  }
  for (const op of parsed.operations) {
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
  host.appendActivity(conv, {
    runId: run.runId,
    role: 'test-fixer',
    type: 'agent.role_completed',
    summary: `Repair retry finished: ${retryCmd?.status ?? 'done'}`,
    status: fixed ? 'completed' : 'warning'
  })
  return fixed
}
