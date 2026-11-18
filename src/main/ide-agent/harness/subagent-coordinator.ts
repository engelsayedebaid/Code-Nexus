import type { IdeAgentRole, IdeConversation } from '../../../shared/ide-agent/ide-agent-types'
import { AgentLoopGuard } from '../ide-agent-loop-guard'
import { parseToolCallsFromAiOutput } from '../ide-agent-prompt-parsers'
import type { ActiveRunControl, EngineHostOps } from '../ide-agent-runtime-types'
import { describeReadOnlyToolPalette, executeAgentReadOnlyTool } from '../ide-agent-tools'
import { IdeContextBudgetTracker } from '../ide-context-budget'
import type { IdeWorkspaceGateway } from '../ide-workspace-gateway'
import {
  fenceUntrustedWorkspaceData,
  PROMPT_INJECTION_SYSTEM_GUARD,
  redactSensitiveSecrets
} from './prompt-security-guard'

export type SubagentTaskSpec = {
  id: string
  role: Extract<IdeAgentRole, 'planner' | 'reviewer'>
  specialistTitle: string
  objective: string
  budgetTokens?: number
  maxToolTurns?: number
}

export type SubagentTaskResult = {
  id: string
  specialistTitle: string
  ok: boolean
  findings: string
  inspectedFiles: string[]
  durationMs: number
}

const MAX_PARALLEL_SUBAGENTS = 2

async function executeSingleReadOnlySubagent(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  spec: SubagentTaskSpec
}): Promise<SubagentTaskResult> {
  const { host, conv, run, gateway, spec } = params
  const startedAt = Date.now()
  const subBudget = new IdeContextBudgetTracker({
    budgetTokens: Math.max(4_000, spec.budgetTokens ?? 10_000)
  })
  const guard = new AgentLoopGuard(Math.max(1, Math.min(3, spec.maxToolTurns ?? 2)))
  const observations: string[] = []
  const inspectedFiles: string[] = []

  host.appendActivity(conv, {
    runId: run.runId,
    role: spec.role,
    type: 'agent.role_started',
    summary: `${spec.specialistTitle}: ${spec.objective.slice(0, 80)}`,
    status: 'running'
  })

  while (true) {
    if (run.abortController.signal.aborted) {
      return {
        id: spec.id,
        specialistTitle: spec.specialistTitle,
        ok: false,
        findings: 'Canceled by parent run.',
        inspectedFiles,
        durationMs: Date.now() - startedAt
      }
    }
    const turn = guard.nextTurn()
    if (!turn.allowed) {
      break
    }
    const allowTools = turn.turn < (spec.maxToolTurns ?? 2)
    const prompt = [
      `You are a bounded read-only specialist subagent: ${spec.specialistTitle}.`,
      PROMPT_INJECTION_SYSTEM_GUARD,
      'Strict contract: You have READ-ONLY workspace access. Never propose out-of-scope actions. Return concise, factual bullet findings with exact relative file:line citations.',
      allowTools ? describeReadOnlyToolPalette() : '',
      observations.length > 0
        ? fenceUntrustedWorkspaceData({
            kind: 'tool_output',
            source: `${spec.specialistTitle} observations`,
            content: observations.join('\n\n')
          })
        : '',
      `Subagent objective:\n${spec.objective}`
    ]
      .filter(Boolean)
      .join('\n\n')

    const res = await host.aiClient.complete({
      workspacePath: gateway.target.workspacePath,
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      prompt,
      signal: run.abortController.signal
    })
    if (!res.ok) {
      return {
        id: spec.id,
        specialistTitle: spec.specialistTitle,
        ok: false,
        findings: res.error,
        inspectedFiles,
        durationMs: Date.now() - startedAt
      }
    }

    const calls = allowTools ? parseToolCallsFromAiOutput(res.text) : null
    if (!calls) {
      const cleanFindings = redactSensitiveSecrets(res.text.trim()).text
      host.appendActivity(conv, {
        runId: run.runId,
        role: spec.role,
        type: 'agent.role_completed',
        summary: `${spec.specialistTitle} finished (${inspectedFiles.length} file(s) inspected)`,
        status: 'completed'
      })
      return {
        id: spec.id,
        specialistTitle: spec.specialistTitle,
        ok: true,
        findings: cleanFindings.slice(0, 4_000),
        inspectedFiles,
        durationMs: Date.now() - startedAt
      }
    }

    for (const call of calls.slice(0, 4)) {
      if (run.abortController.signal.aborted) {
        break
      }
      const allowed = guard.checkToolCall(call.tool, call.args)
      if (!allowed.allowed) {
        observations.push(`[Tool guard] ${allowed.reason}`)
        continue
      }
      const obs = await executeAgentReadOnlyTool({
        call,
        mode: 'ask',
        gateway,
        budget: subBudget,
        conv,
        attachmentStore: host.attachmentStore,
        signal: run.abortController.signal
      })
      if (!obs.ok) {
        guard.recordFailure(call.tool, call.args)
      }
      if (obs.relativePath && !inspectedFiles.includes(obs.relativePath)) {
        inspectedFiles.push(obs.relativePath)
      }
      observations.push(`[${obs.tool}] (${obs.ok ? 'ok' : 'error'}): ${obs.output}`)
    }
  }

  return {
    id: spec.id,
    specialistTitle: spec.specialistTitle,
    ok: observations.length > 0,
    findings: observations.join('\n').slice(0, 3_000),
    inspectedFiles,
    durationMs: Date.now() - startedAt
  }
}

export async function runBoundedReadOnlySubagents(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  tasks: readonly SubagentTaskSpec[]
}): Promise<SubagentTaskResult[]> {
  const { tasks } = params
  if (tasks.length === 0 || params.run.abortController.signal.aborted) {
    return []
  }
  const results: SubagentTaskResult[] = []
  for (let i = 0; i < tasks.length; i += MAX_PARALLEL_SUBAGENTS) {
    if (params.run.abortController.signal.aborted) {
      break
    }
    const batch = tasks.slice(i, i + MAX_PARALLEL_SUBAGENTS)
    const batchResults = await Promise.all(
      batch.map((spec) =>
        executeSingleReadOnlySubagent({
          host: params.host,
          conv: params.conv,
          run: params.run,
          gateway: params.gateway,
          spec
        })
      )
    )
    results.push(...batchResults)
  }
  return results
}
