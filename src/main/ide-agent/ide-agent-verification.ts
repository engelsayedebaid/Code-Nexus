import { randomUUID } from 'node:crypto'
import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeCheckpoint,
  IdeConversation,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import {
  attemptTestFailureRepair,
  executeVerifiedCommand,
  looksLikeExecutableCommand
} from './ide-agent-command-runner'
import { MAX_REPAIR_ATTEMPTS } from './ide-agent-loop-guard'
import { buildReviewPrompt } from './ide-agent-prompts'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { CoordinatorCallbacks } from './ide-file-edit-coordinator'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import {
  filterNewDiagnosticRegressions,
  selectPolicyVerificationCommands
} from './harness/verification-policy'

export async function runPlanVerificationAndReport(params: {
  host: EngineHostOps
  callbacks: CoordinatorCallbacks
  conv: IdeConversation
  plan: IdeTaskPlan
  checkpoint: IdeCheckpoint
  baselineShaByFile: Map<string, string | null>
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  modifiedFilesSet: Set<string>
  verificationCommands: Set<string>
  completedSummaries: readonly string[]
  baselineDiagnosticErrors?: ReadonlySet<string>
}): Promise<void> {
  const {
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
  } = params

  const executedCmdIds: string[] = []
  const failedChecks: string[] = []
  const explicitRunnable = Array.from(verificationCommands).filter((cmd) =>
    looksLikeExecutableCommand(cmd)
  )

  let runnableCommands = explicitRunnable
  if (
    runnableCommands.length === 0 &&
    modifiedFilesSet.size > 0 &&
    !run.abortController.signal.aborted
  ) {
    const snap = await gateway.inspectWorkspace([], run.abortController.signal).catch(() => null)
    runnableCommands = selectPolicyVerificationCommands({
      explicitCommands: explicitRunnable,
      modifiedFiles: modifiedFilesSet,
      architecture: snap?.architecture
    })
  }

  if (runnableCommands.length > 0) {
    host.setRunStatus(conv, run.runId, 'verifying', 'Running verification checks...')
    for (const command of runnableCommands) {
      if (run.abortController.signal.aborted) {
        break
      }
      const cmdRecord = await executeVerifiedCommand({ host, conv, run, gateway, command })
      if (cmdRecord) {
        executedCmdIds.push(cmdRecord.id)
      }
      if (cmdRecord?.status === 'failed') {
        let fixed = false
        let latestFailed = cmdRecord
        const seenFailureSignatures = new Set<string>()
        for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && !fixed; attempt += 1) {
          if (run.abortController.signal.aborted) {
            break
          }
          const repairOut = await attemptTestFailureRepair({
            host,
            callbacks,
            conv,
            plan,
            checkpoint,
            baselineShaByFile,
            run,
            gateway,
            failedCommand: latestFailed,
            modifiedFilesSet,
            executedCmdIds,
            seenFailureSignatures
          })
          fixed = repairOut.fixed
          latestFailed = repairOut.latestRecord
        }
        if (!fixed) {
          failedChecks.push(command)
        }
      }
    }
  } else if (
    gateway.getDiagnostics &&
    modifiedFilesSet.size > 0 &&
    !run.abortController.signal.aborted
  ) {
    host.setRunStatus(conv, run.runId, 'verifying', 'Checking project diagnostics...')
    const diag = await gateway.getDiagnostics(run.abortController.signal)
    if (diag.available) {
      const regressionAnalysis = filterNewDiagnosticRegressions(
        params.baselineDiagnosticErrors ?? new Set(),
        diag.details
      )
      const regressionFailed = !diag.passed && regressionAnalysis.newErrors.length > 0
      const summary = diag.passed
        ? diag.summary
        : regressionFailed
          ? `${diag.summary} (${regressionAnalysis.newErrors.length} new regression(s))`
          : `No new TypeScript regressions introduced (${regressionAnalysis.preExistingCount} pre-existing error(s) unchanged).`
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'orchestrator',
        type: 'diagnostics.checked',
        summary,
        detail: diag.details || undefined,
        status: regressionFailed ? 'error' : 'completed'
      })
      run.telemetry?.recordVerificationOutcome(!regressionFailed)
      if (regressionFailed) {
        failedChecks.push(summary)
      }
    }
  }

  let reviewerReport = ''
  if (run.config.multiAgentEnabled && !run.abortController.signal.aborted) {
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'reviewer',
      type: 'agent.role_started',
      summary: 'Reviewer Agent checking changes & test output',
      status: 'running'
    })
    const diffSummary = await gateway.getGitDiffSummary()
    const snapshot = await gateway.inspectWorkspace([], run.abortController.signal)
    run.telemetry?.recordSubagentRun(1)
    const revRes = await host.aiClient.complete({
      workspacePath: gateway.target.workspacePath,
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      prompt: buildReviewPrompt({
        request: plan.objective,
        diffSummary:
          diffSummary ??
          Array.from(modifiedFilesSet)
            .map((p) => `Modified: ${p}`)
            .join('\n'),
        commandHistorySummary: conv.commandExecutions
          .filter((c) => executedCmdIds.includes(c.id))
          .map((c) => `${c.command}: ${c.status} (exit ${c.exitCode ?? 'n/a'})`)
          .join('\n'),
        snapshot,
        multiAgentReviewer: true
      }),
      signal: run.abortController.signal
    })
    if (revRes.ok) {
      reviewerReport = `\n\n### Reviewer Check\n${revRes.text}`
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'reviewer',
        type: 'agent.role_completed',
        summary: 'Reviewer Agent completed inspection',
        status: 'completed'
      })
    }
  }

  if (run.abortController.signal.aborted) {
    plan.status = 'failed'
    plan.updatedAt = Date.now()
    host.setRunStatus(conv, null, 'canceled', 'Stopped by user')
    return
  }

  const plannedPaths = plan.affectedFiles
    .filter((f) => f.action !== 'mkdir' && f.action !== 'delete_folder')
    .map((f) => normalizeWorkspaceRelativePath(f.path))
  const expectedFileChanges =
    plannedPaths.length > 0 || plan.steps.some((s) => s.targetFiles.length > 0)
  const unmodifiedPlannedFiles = plannedPaths.filter((p) => !modifiedFilesSet.has(p))
  const bulletSummaries =
    completedSummaries.length > 0
      ? completedSummaries.map((s) => `- ${s.replace(/^\s*\d+[.)]\s*/, '')}`).join('\n')
      : ''

  if (
    expectedFileChanges &&
    modifiedFilesSet.size === 0 &&
    plan.affectedFiles.every((f) => f.action !== 'mkdir' && f.action !== 'delete_folder')
  ) {
    plan.status = 'failed'
    plan.updatedAt = Date.now()
    conv.messages.push({
      id: randomUUID(),
      conversationId: conv.id,
      role: 'assistant',
      mode: 'agent',
      text: [
        `### Implementation Incomplete: ${plan.objective}`,
        '**No file changes were applied.** The agent finished its steps without writing or modifying any files in the approved scope.',
        bulletSummaries
      ]
        .filter(Boolean)
        .join('\n\n'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      teamMode: run.config.multiAgentEnabled,
      planId: plan.id,
      runId: run.runId
    })
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.failed',
      summary: 'Execution finished with no file changes applied',
      status: 'error'
    })
    host.setRunStatus(conv, null, 'failed')
    return
  }

  const modifiedList = Array.from(modifiedFilesSet)
  const hasFailures = failedChecks.length > 0
  plan.status = hasFailures ? 'failed' : 'completed'
  plan.updatedAt = Date.now()

  conv.messages.push({
    id: randomUUID(),
    conversationId: conv.id,
    role: 'assistant',
    mode: 'agent',
    text: [
      hasFailures
        ? `### Changes Applied (Verification Failed)\n${plan.objective}`
        : `### Changes Applied\n${plan.objective}`,
      bulletSummaries,
      unmodifiedPlannedFiles.length > 0
        ? `**Note — planned files unchanged:** ${unmodifiedPlannedFiles.map((f) => `\`${f}\``).join(', ')}`
        : '',
      hasFailures ? `**Failed checks:** ${failedChecks.map((c) => `\`${c}\``).join(', ')}` : '',
      reviewerReport
    ]
      .filter(Boolean)
      .join('\n\n'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    teamMode: run.config.multiAgentEnabled,
    planId: plan.id,
    runId: run.runId,
    modifiedFiles: modifiedList,
    commandIds: executedCmdIds,
    ...(hasFailures ? { error: `Verification failed: ${failedChecks.join(', ')}` } : {})
  })

  host.appendActivity(conv, {
    runId: run.runId,
    role: 'orchestrator',
    type: hasFailures ? 'run.failed' : 'run.completed',
    summary: hasFailures
      ? `Plan v${plan.version} applied ${modifiedList.length} file(s), verification failed`
      : `Completed Plan v${plan.version} (${modifiedList.length} files updated)`,
    status: hasFailures ? 'error' : 'completed'
  })
  host.setRunStatus(conv, null, hasFailures ? 'failed' : 'completed')
}
