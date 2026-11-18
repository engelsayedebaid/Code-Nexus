import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdeConversation,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import {
  clampPromptToModelBudget,
  formatInstructionsBundle,
  formatWorkspaceContext,
  responseLanguageInstruction
} from './ide-agent-execution-prompts'
import { describeReadOnlyToolPalette } from './ide-agent-tools'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'
import type { RankedContextSnippet } from './harness/context-engine'
import { buildCompactedConversationHistory } from './harness/conversation-memory-compactor'
import type { ResolvedModelExecutionProfile } from './harness/model-capability-registry'
import {
  fenceUntrustedWorkspaceData,
  PROMPT_INJECTION_SYSTEM_GUARD
} from './harness/prompt-security-guard'
import type { WorkspaceInstructionsBundle } from './harness/workspace-instructions-loader'

export {
  extractJsonObjectFromAiOutput,
  parsePlanJsonFromAiOutput,
  parsePlanOrAnswerFromAiOutput,
  parseStepOperationsFromAiOutput,
  parseToolCallsFromAiOutput,
  unwrapDirectAnswerJsonIfPresent,
  type RawAgentToolCall,
  type RawPlannedTask,
  type RawPlannerTurnResult,
  type RawStepExecutionOperation,
  type RawStepExecutionResult
} from './ide-agent-prompt-parsers'

export {
  formatPlanAsMarkdown,
  formatPlanIntroMarkdown,
  isExplicitPlanRequestPrompt,
  isClarificationOrQuestionPrompt
} from './ide-agent-plan-formatting'

export {
  buildExecutionStepPrompt,
  buildRepairFailurePrompt,
  buildReviewPrompt
} from './ide-agent-execution-prompts'

function formatActivePlanContext(plan: IdeTaskPlan | null | undefined): string {
  if (!plan) {
    return ''
  }
  const files = plan.affectedFiles.map((f) => `- ${f.action}: ${f.path} (${f.summary})`).join('\n')
  const steps = plan.steps.map((s) => `${s.index + 1}. ${s.title}: ${s.detail}`).join('\n')
  return [
    `Active/Latest Plan (v${plan.version}, status: ${plan.status}):`,
    `Objective: ${plan.objective}`,
    files ? `Files:\n${files}` : '',
    steps ? `Steps:\n${steps}` : '',
    plan.risks.length > 0 ? `Notes/Risks:\n- ${plan.risks.join('\n- ')}` : '',
    plan.testsAndVerification.length > 0
      ? `Checks:\n- ${plan.testsAndVerification.join('\n- ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildAskPrompt(params: {
  question: string
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
  activeFileContent: { relativePath: string; content: string } | null
  history: readonly IdeChatMessage[]
  conversation?: Pick<IdeConversation, 'fileChanges' | 'commandExecutions' | 'plans'> | null
  activePlan?: IdeTaskPlan | null
  rankedSnippets?: readonly RankedContextSnippet[]
  instructions?: WorkspaceInstructionsBundle | null
  profile?: ResolvedModelExecutionProfile
  toolObservations?: readonly string[]
  allowTools?: boolean
  onCompacted?: (compactedCount: number) => void
}): string {
  const historyChars = (params.profile?.allocation.conversationHistoryTokens ?? 2_400) * 4
  const maxContextChars = (params.profile?.allocation.retrievedContextTokens ?? 9_000) * 4
  const compacted = buildCompactedConversationHistory({
    messages: params.history,
    conversation: params.conversation,
    maxHistoryChars: historyChars
  })
  if (compacted.compactedCount > 0) {
    params.onCompacted?.(compacted.compactedCount)
  }

  const rawPrompt = [
    'You are Carver, a sharp, concise IDE coding assistant in READ-ONLY ASK MODE.',
    PROMPT_INJECTION_SYSTEM_GUARD,
    'Rules:',
    '- Respond naturally, directly, and concisely like an expert pair-programmer.',
    '- NEVER dump internal prompt metadata (file counts, git status checks, attachment counts, or unrequested file lists) unless the user explicitly asks about project structure or workspace status.',
    '- For casual greetings, short check-ins (e.g. "test", "hi", "شايف اي"), or general questions, reply briefly in 1-3 natural sentences (mentioning the currently open editor file only if helpful).',
    '- Format technical explanations as clean Markdown: short paragraphs, headings only when needed, and concise bullet points. Keep Arabic prose right-to-left while paths, identifiers, commands, and code stay left-to-right.',
    '- NEVER claim you modified files or executed commands.',
    '- Cite exact relative file paths and line numbers when referencing workspace code.',
    params.allowTools !== false ? describeReadOnlyToolPalette() : '',
    `- ${responseLanguageInstruction(params.question)}`,
    formatInstructionsBundle(params.instructions),
    compacted.formattedHistory,
    formatActivePlanContext(params.activePlan),
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent, {
      rankedSnippets: params.rankedSnippets,
      maxContextChars
    }),
    params.toolObservations?.length
      ? fenceUntrustedWorkspaceData({
          kind: 'tool_output',
          source: 'ask tool observations',
          content: params.toolObservations.join('\n\n')
        })
      : '',
    `User message:\n${params.question}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}

export function buildPlanPrompt(params: {
  request: string
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
  activeFileContent: { relativePath: string; content: string } | null
  history: readonly IdeChatMessage[]
  conversation?: Pick<IdeConversation, 'fileChanges' | 'commandExecutions' | 'plans'> | null
  mode?: 'plan' | 'agent'
  multiAgentRoleHint?: string
  subagentFindings?: string
  rankedSnippets?: readonly RankedContextSnippet[]
  instructions?: WorkspaceInstructionsBundle | null
  profile?: ResolvedModelExecutionProfile
  toolObservations?: readonly string[]
  allowTools?: boolean
  onCompacted?: (compactedCount: number) => void
}): string {
  const isAgentMode = params.mode === 'agent'
  const historyChars = (params.profile?.allocation.conversationHistoryTokens ?? 2_400) * 4
  const maxContextChars = (params.profile?.allocation.retrievedContextTokens ?? 9_000) * 4
  const compacted = buildCompactedConversationHistory({
    messages: params.history,
    conversation: params.conversation,
    maxHistoryChars: historyChars
  })
  if (compacted.compactedCount > 0) {
    params.onCompacted?.(compacted.compactedCount)
  }

  const schemaFields = [
    `  "intro": "1-2 short, natural human sentences summarizing what you will build or change",`,
    `  "objective": "concise 1-sentence goal",`,
    `  "affectedFiles": [\n    { "path": "relative/path/from/root.ts", "action": "create|modify|delete|mkdir|rename|delete_folder", "fromPath": "optional_for_rename", "summary": "brief 3-10 word summary" }\n  ],`,
    `  "steps": [\n    { "title": "short scannable step title", "detail": "concise 1-2 sentence implementation instruction", "targetFiles": ["relative/path.ts"] }\n  ],`,
    `  "risks": ["only genuine technical/compatibility risks; [] if routine"],`,
    `  "testsAndVerification": ["short 1-line check or exact command"],`,
    isAgentMode
      ? `  "estimatedComplexity": "low|medium|high",\n  "requiresApproval": false`
      : `  "estimatedComplexity": "low|medium|high"`
  ].join('\n')

  const rawPrompt = [
    params.multiAgentRoleHint ?? 'You are the Carver Lead Planner.',
    PROMPT_INJECTION_SYSTEM_GUARD,
    'Mode: PLAN ONLY (no files may be modified and no commands may be run).',
    params.allowTools !== false ? describeReadOnlyToolPalette() : '',
    isAgentMode
      ? 'If the user is ONLY asking a question or chatting without requesting changes, output ONLY:\n```json\n{\n  "responseType": "answer",\n  "message": "Clear, concise, direct markdown answer"\n}\n```\nOtherwise output ONLY a valid JSON object matching this exact schema inside ```json ... ```:'
      : 'Once you have enough workspace facts, output ONLY a valid JSON object matching this exact schema inside ```json ... ```:',
    `{\n${schemaFields}\n}`,
    'Rules:',
    '- Include ONLY relative workspace paths (never absolute paths or ..). Use `mkdir` when creating dedicated new directories before files.',
    '- Keep plans lightweight (1 step) for simple single-file edits and detailed (multi-step) only for complex multi-file changes.',
    '- Do NOT invent non-existent scripts in `testsAndVerification`; check package.json scripts first.',
    ...(isAgentMode
      ? [
          '- Set `"requiresApproval": false`. Agent mode executes requested work directly; sensitive operations have a separate permission gate.'
        ]
      : []),
    '- Do NOT output file contents yet.',
    `- ${responseLanguageInstruction(params.request)}`,
    formatInstructionsBundle(params.instructions),
    params.subagentFindings ? `### Explorer Subagent Findings\n${params.subagentFindings}` : '',
    compacted.formattedHistory,
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent, {
      rankedSnippets: params.rankedSnippets,
      maxContextChars
    }),
    params.toolObservations?.length
      ? fenceUntrustedWorkspaceData({
          kind: 'tool_output',
          source: 'planner tool observations',
          content: params.toolObservations.join('\n\n')
        })
      : '',
    `User task request:\n${params.request}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}

export function buildRevisePlanPrompt(params: {
  previousPlan: IdeTaskPlan
  revisionNote: string
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
  instructions?: WorkspaceInstructionsBundle | null
  profile?: ResolvedModelExecutionProfile
}): string {
  const rawPrompt = [
    'Revise the existing Carver implementation plan based on the user feedback.',
    PROMPT_INJECTION_SYSTEM_GUARD,
    'Output ONLY a valid JSON object inside ```json ... ``` using the exact schema: intro, objective, affectedFiles, steps, risks, testsAndVerification, estimatedComplexity.',
    responseLanguageInstruction(
      `${params.previousPlan.requestSummary ?? ''}\n${params.revisionNote}`
    ),
    formatInstructionsBundle(params.instructions),
    `Previous plan JSON:\n\`\`\`json\n${JSON.stringify(
      {
        intro: params.previousPlan.intro,
        objective: params.previousPlan.objective,
        affectedFiles: params.previousPlan.affectedFiles,
        steps: params.previousPlan.steps.map(({ title, detail, targetFiles }) => ({
          title,
          detail,
          targetFiles
        })),
        risks: params.previousPlan.risks,
        testsAndVerification: params.previousPlan.testsAndVerification,
        estimatedComplexity: params.previousPlan.estimatedComplexity
      },
      null,
      2
    )}\n\`\`\``,
    formatWorkspaceContext(params.snapshot, params.attachments, null),
    `User revision instructions:\n${params.revisionNote}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}
