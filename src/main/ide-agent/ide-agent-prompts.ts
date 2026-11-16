import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { formatWorkspaceContext, responseLanguageInstruction } from './ide-agent-execution-prompts'
import { describeReadOnlyToolPalette } from './ide-agent-tools'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'

export {
  extractJsonObjectFromAiOutput,
  parsePlanJsonFromAiOutput,
  parsePlanOrAnswerFromAiOutput,
  parseStepOperationsFromAiOutput,
  parseToolCallsFromAiOutput,
  type RawAgentToolCall,
  type RawPlannedTask,
  type RawPlannerTurnResult,
  type RawStepExecutionOperation,
  type RawStepExecutionResult
} from './ide-agent-prompt-parsers'

export {
  formatPlanAsMarkdown,
  formatPlanIntroMarkdown,
  isClarificationOrQuestionPrompt
} from './ide-agent-plan-formatting'

export {
  buildExecutionStepPrompt,
  buildRepairFailurePrompt,
  buildReviewPrompt
} from './ide-agent-execution-prompts'

function formatRecentConversation(messages: readonly IdeChatMessage[]): string {
  const recent = messages.slice(-6)
  if (recent.length === 0) {
    return ''
  }
  return recent
    .map((m) => `[${m.role.toUpperCase()} - ${m.mode}]: ${m.text.slice(0, 2000)}`)
    .join('\n\n')
}

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
  activePlan?: IdeTaskPlan | null
  toolObservations?: readonly string[]
}): string {
  return [
    'You are the Carver IDE AI Assistant in READ-ONLY ASK MODE.',
    'Rules:',
    '- Answer clearly, politely, and directly based strictly on inspected workspace files, conversation history, and active plan (if any).',
    '- NEVER claim you modified files or executed tests or commands.',
    '- Cite exact relative file paths and line numbers when referencing workspace code.',
    describeReadOnlyToolPalette(),
    `- ${responseLanguageInstruction(params.question)}`,
    formatRecentConversation(params.history),
    formatActivePlanContext(params.activePlan),
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent),
    params.toolObservations?.length
      ? `Tool observations gathered:\n${params.toolObservations.join('\n\n')}`
      : '',
    `User question:\n${params.question}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildPlanPrompt(params: {
  request: string
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
  activeFileContent: { relativePath: string; content: string } | null
  history: readonly IdeChatMessage[]
  mode?: 'plan' | 'agent'
  multiAgentRoleHint?: string
  toolObservations?: readonly string[]
}): string {
  const isAgentMode = params.mode === 'agent'
  const schemaFields = [
    `  "intro": "1-2 short, natural human sentences summarizing what you will build or change",`,
    `  "objective": "concise 1-sentence goal",`,
    `  "affectedFiles": [\n    { "path": "relative/path/from/root.ts", "action": "create|modify|delete|mkdir|rename|delete_folder", "fromPath": "optional_for_rename", "summary": "brief 3-10 word summary" }\n  ],`,
    `  "steps": [\n    { "title": "short scannable step title", "detail": "concise 1-2 sentence implementation instruction", "targetFiles": ["relative/path.ts"] }\n  ],`,
    `  "risks": ["only genuine technical/compatibility risks; [] if routine"],`,
    `  "testsAndVerification": ["short 1-line check or exact command"],`,
    isAgentMode
      ? `  "estimatedComplexity": "low|medium|high",\n  "requiresApproval": true`
      : `  "estimatedComplexity": "low|medium|high"`
  ].join('\n')

  return [
    params.multiAgentRoleHint ?? 'You are the Carver Lead Planner.',
    'Mode: PLAN ONLY (no files may be modified and no commands may be run).',
    describeReadOnlyToolPalette(),
    isAgentMode
      ? 'If the user is ONLY asking a question or chatting without requesting changes, output ONLY:\n```json\n{\n  "responseType": "answer",\n  "message": "Clear, concise, direct markdown answer"\n}\n```\nOtherwise output ONLY a valid JSON object matching this exact schema inside ```json ... ```:'
      : 'Once you have enough workspace facts, output ONLY a valid JSON object matching this exact schema inside ```json ... ```:',
    `{\n${schemaFields}\n}`,
    'Rules:',
    '- Include ONLY relative workspace paths (never absolute paths or ..). Use `mkdir` when creating dedicated new directories before files.',
    '- Keep `intro`, step titles, summaries, and verification checks crisp and easy to scan.',
    '- Do NOT invent non-existent scripts in `testsAndVerification`; check package.json scripts first.',
    ...(isAgentMode
      ? [
          '- Set `"requiresApproval": false` ONLY for small, unambiguous, low-risk edits (1-2 files, `low` complexity, no deletions or sensitive/config files).'
        ]
      : []),
    '- Do NOT output file contents yet.',
    `- ${responseLanguageInstruction(params.request)}`,
    formatRecentConversation(params.history),
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent),
    params.toolObservations?.length
      ? `Tool observations gathered:\n${params.toolObservations.join('\n\n')}`
      : '',
    `User task request:\n${params.request}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildRevisePlanPrompt(params: {
  previousPlan: IdeTaskPlan
  revisionNote: string
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
}): string {
  return [
    'Revise the existing Carver implementation plan based on the user feedback.',
    'Output ONLY a valid JSON object inside ```json ... ``` using the exact schema: intro, objective, affectedFiles, steps, risks, testsAndVerification, estimatedComplexity.',
    responseLanguageInstruction(
      `${params.previousPlan.requestSummary ?? ''}\n${params.revisionNote}`
    ),
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
  ].join('\n\n')
}
