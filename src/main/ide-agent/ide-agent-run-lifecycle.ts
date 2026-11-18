import type { IdeChatAttachment } from '../../shared/ide-agent/ide-agent-types'
import { runToolAssistedInspectionLoop } from './ide-agent-harness'
import {
  buildAskPrompt,
  buildPlanPrompt,
  isClarificationOrQuestionPrompt,
  isExplicitPlanRequestPrompt
} from './ide-agent-prompts'
import { finalizePlannerOutput } from './ide-agent-planner-turn'
import {
  executeReadOnlyChatTurn,
  filterAndHydrateAttachments,
  inspectWorkspaceForTurn,
  runReviewModeTurn
} from './ide-agent-turn-helpers'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import { AgentRunTelemetryCollector } from './harness/agent-telemetry'
import { extractExplicitFileMentions } from './harness/context-engine'
import { runBoundedReadOnlySubagents } from './harness/subagent-coordinator'

export { buildPlanRecord } from './ide-agent-turn-helpers'
export { dispatchIdePrompt } from './ide-agent-prompt-dispatch'

export async function runPromptLifecycle(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  conversationId: string
  run: ActiveRunControl
  gateway: IdeWorkspaceGateway
  input: {
    text: string
    attachments?: IdeChatAttachment[]
    activeFilePath?: string
    openFilePaths?: string[]
  }
}): Promise<void> {
  const { activeRuns, conversationId, run, gateway, input } = params
  const telemetry = new AgentRunTelemetryCollector(
    run.runId,
    run.config.agentId,
    run.config.modelId
  )
  run.telemetry = telemetry
  const host: EngineHostOps = {
    ...params.host,
    aiClient: telemetry.wrapAiClient(params.host.aiClient)
  }
  const conv = host.requireConversation(conversationId)

  try {
    host.setRunStatus(conv, run.runId, 'analyzing', 'Inspecting workspace context...')
    const attachments =
      (input.attachments?.length ?? 0) > 0
        ? await filterAndHydrateAttachments(host, conv, run, gateway, input.attachments ?? [])
        : []
    if (run.abortController.signal.aborted) {
      host.setRunStatus(conv, null, 'canceled')
      return
    }

    const { snapshot, budget, activeFileContent, rankedSnippets, instructions, profile } =
      await inspectWorkspaceForTurn({
        host,
        conv,
        run,
        gateway,
        text: input.text,
        activeFilePath: input.activeFilePath,
        openFilePaths: input.openFilePaths,
        attachments
      })
    if (run.abortController.signal.aborted) {
      host.setRunStatus(conv, null, 'canceled')
      return
    }

    if (
      run.config.mode === 'ask' ||
      (run.config.mode === 'agent' && isClarificationOrQuestionPrompt(input.text))
    ) {
      const activePlan =
        conv.plans.find((p) => p.id === conv.activePlanId) ?? conv.plans.at(-1) ?? null
      await executeReadOnlyChatTurn({
        host,
        conv,
        run,
        gateway,
        budget,
        profile,
        mode: 'ask',
        preserveAwaitingPlan: activePlan?.status === 'awaiting_approval',
        buildPrompt: (observations, allowTools) =>
          buildAskPrompt({
            question: input.text,
            snapshot,
            attachments,
            activeFileContent,
            rankedSnippets,
            instructions,
            profile,
            history: conv.messages.slice(0, -1),
            conversation: conv,
            activePlan,
            toolObservations: observations,
            allowTools,
            onCompacted: (count) => telemetry.recordCompactedMessages(count)
          })
      })
      return
    }

    if (run.config.mode === 'review') {
      await runReviewModeTurn({
        host,
        conv,
        run,
        gateway,
        budget,
        snapshot,
        attachments,
        activeFileContent,
        rankedSnippets,
        instructions,
        profile,
        requestText: input.text
      })
      return
    }

    const explicitPlanRequested =
      run.config.mode === 'agent' && isExplicitPlanRequestPrompt(input.text)
    const approvalRequired = run.config.mode === 'plan' || explicitPlanRequested
    host.setRunStatus(
      conv,
      run.runId,
      'planning',
      approvalRequired ? 'Generating implementation plan...' : 'Preparing implementation...'
    )

    let subagentFindings = ''
    const mentions = extractExplicitFileMentions(input.text)
    if (run.config.multiAgentEnabled && mentions.length >= 2) {
      const subResults = await runBoundedReadOnlySubagents({
        host,
        conv,
        run,
        gateway,
        tasks: mentions.slice(0, 2).map((m, idx) => ({
          id: `explorer-${idx + 1}`,
          role: 'planner',
          specialistTitle: `Codebase Explorer #${idx + 1}`,
          objective: `Inspect ${m.relativePath} and its direct imports/dependents relevant to: ${input.text.slice(0, 240)}`
        }))
      })
      telemetry.recordSubagentRun(subResults.length)
      subagentFindings = subResults
        .filter((r) => r.ok && r.findings)
        .map((r) => `[${r.specialistTitle}]: ${r.findings}`)
        .join('\n\n')
    } else if (run.config.multiAgentEnabled) {
      host.appendActivity(conv, {
        runId: run.runId,
        role: 'planner',
        type: 'agent.role_started',
        summary: approvalRequired
          ? 'Planner Agent drafting implementation plan'
          : 'Agent preparing implementation',
        status: 'running'
      })
    }

    const aiRes = await runToolAssistedInspectionLoop({
      host,
      conv,
      run,
      gateway,
      budget,
      profile,
      mode: 'plan',
      role: run.config.multiAgentEnabled ? 'planner' : 'orchestrator',
      buildPrompt: (observations, allowTools) =>
        buildPlanPrompt({
          request: input.text,
          snapshot,
          attachments,
          activeFileContent,
          rankedSnippets,
          instructions,
          profile,
          subagentFindings: subagentFindings || undefined,
          history: conv.messages.slice(0, -1),
          conversation: conv,
          mode: approvalRequired ? 'plan' : 'agent',
          toolObservations: observations,
          allowTools,
          onCompacted: (count) => telemetry.recordCompactedMessages(count)
        })
    })

    if (!aiRes.ok) {
      if (aiRes.canceled || run.abortController.signal.aborted) {
        host.appendActivity(conv, {
          runId: run.runId,
          role: 'planner',
          type: 'run.canceled',
          summary: 'Planning canceled',
          status: 'warning'
        })
        host.setRunStatus(conv, null, 'canceled')
        return
      }
      throw new Error(aiRes.error)
    }

    await finalizePlannerOutput({
      host,
      activeRuns,
      conv,
      run,
      gateway,
      requestText: input.text,
      aiText: aiRes.text,
      approvalRequired
    })
  } finally {
    telemetry.finalizeIntoConversation(conv)
    host.saveAndPublish(conv)
    if (activeRuns.get(conversationId) === run) {
      activeRuns.delete(conversationId)
    }
  }
}
