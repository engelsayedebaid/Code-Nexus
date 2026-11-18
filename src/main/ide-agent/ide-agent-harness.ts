import {
  classifySensitiveFilePath,
  isPlanApprovedForExecution,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeAgentRole,
  IdeConversation,
  IdeExecutionMode,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { AgentLoopGuard, MAX_READ_TOOL_TURNS } from './ide-agent-loop-guard'
import { parseToolCallsFromAiOutput } from './ide-agent-prompt-parsers'
import { executeAgentReadOnlyTool } from './ide-agent-tools'
import type { IdeAiCompletionResponse } from './ide-ai-client'
import type { IdeContextBudgetTracker } from './ide-context-budget'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import { StreamingOperationContentExtractor } from './ide-streaming-op-extractor'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import type { ResolvedModelExecutionProfile } from './harness/model-capability-registry'

export async function runToolAssistedInspectionLoop(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  budget: IdeContextBudgetTracker
  profile?: ResolvedModelExecutionProfile
  mode: IdeExecutionMode
  role: IdeAgentRole
  buildPrompt: (observations: readonly string[], allowTools: boolean) => string
  onProseDelta?: (text: string) => void
  onTurnReset?: () => void
}): Promise<IdeAiCompletionResponse> {
  const { host, conv, run, gateway, budget, profile } = params
  const guard = new AgentLoopGuard(MAX_READ_TOOL_TURNS)
  const observations: string[] = []
  const maxBatch = profile?.maxParallelTools ?? 6

  while (true) {
    if (run.abortController.signal.aborted) {
      return { ok: false, error: 'Canceled by user.', canceled: true }
    }
    const turnCheck = guard.nextTurn()
    if (!turnCheck.allowed) {
      return { ok: false, error: turnCheck.reason }
    }
    const allowTools = turnCheck.turn < MAX_READ_TOOL_TURNS
    if (turnCheck.turn > 1) {
      params.onTurnReset?.()
    }

    let bufferedDelta = ''
    let confirmedProse = false
    let suppressedAsToolJson = false
    const aiRes = await host.aiClient.complete({
      workspacePath: gateway.target.workspacePath,
      agentId: run.config.agentId,
      modelId: run.config.modelId,
      prompt: params.buildPrompt(observations, allowTools),
      thinkingLevel: profile?.selectedThinkingLevel,
      signal: run.abortController.signal,
      onDelta: params.onProseDelta
        ? (delta) => {
            if (suppressedAsToolJson) {
              return
            }
            if (confirmedProse) {
              params.onProseDelta!(delta)
              return
            }
            bufferedDelta += delta
            const trimmed = bufferedDelta.trimStart()
            if (!trimmed) {
              return
            }
            if (
              trimmed.startsWith('{"toolCalls"') ||
              /^```(?:json)?\s*\{\s*"(?:toolCalls|responseType)"/.test(trimmed)
            ) {
              suppressedAsToolJson = true
              return
            }
            if (trimmed.length >= 28 || (!trimmed.startsWith('{') && !trimmed.startsWith('```'))) {
              confirmedProse = true
              params.onProseDelta!(bufferedDelta)
              bufferedDelta = ''
            }
          }
        : undefined
    })

    if (!aiRes.ok) {
      return aiRes
    }

    const toolCalls = allowTools ? parseToolCallsFromAiOutput(aiRes.text) : null
    if (!toolCalls) {
      conv.contextBudget = budget.summary()
      host.saveAndPublish(conv)
      return aiRes
    }

    for (const call of toolCalls.slice(0, maxBatch)) {
      if (run.abortController.signal.aborted) {
        return { ok: false, error: 'Canceled by user.', canceled: true }
      }
      const allowed = guard.checkToolCall(call.tool, call.args)
      if (!allowed.allowed) {
        run.telemetry?.recordToolCall(true)
        observations.push(`[Tool guard] ${allowed.reason}`)
        continue
      }
      run.telemetry?.recordToolCall(false)
      const obs = await executeAgentReadOnlyTool({
        call,
        mode: params.mode,
        gateway,
        budget,
        conv,
        attachmentStore: host.attachmentStore,
        signal: run.abortController.signal
      })
      if (!obs.ok) {
        guard.recordFailure(call.tool, call.args)
      }
      observations.push(`[${obs.tool}] (${obs.ok ? 'ok' : 'error'}): ${obs.output}`)
      host.appendActivity(conv, {
        runId: run.runId,
        role: params.role,
        type: obs.activityType,
        summary: obs.summary,
        relativePath: obs.relativePath,
        status: obs.ok ? 'completed' : 'warning'
      })
    }
    conv.contextBudget = budget.summary()
    host.saveAndPublish(conv)
  }
}

export async function runExecutionStepWithLiveStream(params: {
  host: EngineHostOps
  conv: IdeConversation
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  plan: IdeTaskPlan
  prompt: string
  thinkingLevel?: string
}): Promise<{ aiRes: IdeAiCompletionResponse; streamedPaths: Set<string> }> {
  const { host, conv, run, gateway, plan } = params
  const extractor = new StreamingOperationContentExtractor()
  const streamedPaths = new Set<string>()
  const openedPaths = new Set<string>()

  const aiRes = await host.aiClient.complete({
    workspacePath: gateway.target.workspacePath,
    agentId: run.config.agentId,
    modelId: run.config.modelId,
    prompt: params.prompt,
    thinkingLevel: params.thinkingLevel,
    signal: run.abortController.signal,
    onDelta: (delta) => {
      if (run.abortController.signal.aborted || run.paused) {
        return
      }
      const snap = extractor.appendDelta(delta)
      if (!snap) {
        return
      }
      const lower = snap.path.toLowerCase()
      const scopeOk = isPlanApprovedForExecution(plan, [snap.path]).ok
      const sensitive = classifySensitiveFilePath(snap.path, 'write') !== null
      const dirty = run.dirtyPaths.has(lower)
      if (!scopeOk || sensitive || dirty) {
        return
      }
      if (!openedPaths.has(lower)) {
        openedPaths.add(lower)
        host.emit({
          type: 'editor_file_opened',
          conversationId: conv.id,
          runId: run.runId,
          relativePath: snap.path,
          reason: snap.action === 'create' ? `Creating ${snap.path}` : `Editing ${snap.path}`
        })
      }
      streamedPaths.add(lower)
      host.emit({
        type: 'editor_edit_chunk',
        conversationId: conv.id,
        runId: run.runId,
        relativePath: snap.path,
        startLine: snap.startLine,
        endLine: snap.endLine,
        chunkIndex: 0,
        totalChunks: 1,
        label: `Streaming ${normalizeWorkspaceRelativePath(snap.path)}`,
        beforeContent: snap.action === 'create' ? '' : undefined,
        afterContent: snap.content,
        speed: run.config.liveEditSpeed ?? 'natural',
        sourceKind: 'streamed'
      })
    }
  })

  return { aiRes, streamedPaths }
}
