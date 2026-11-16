import { hasArabicText } from '../../shared/ide-agent/ide-language'
import type {
  IdeChatAttachment,
  IdeChatMessage,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'

export {
  extractJsonObjectFromAiOutput,
  parsePlanJsonFromAiOutput,
  parsePlanOrAnswerFromAiOutput,
  parseStepOperationsFromAiOutput,
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

function formatWorkspaceContext(
  snapshot: WorkspaceInspectionSnapshot,
  attachments: readonly IdeChatAttachment[],
  activeFileContent?: { relativePath: string; content: string } | null
): string {
  const parts: string[] = [
    `Workspace root: ${snapshot.workspacePath}`,
    `Git repository: ${snapshot.isGitRepo ? 'yes' : 'no (folder workspace)'}`,
    `Files (${snapshot.fileList.length}):\n${snapshot.fileList.slice(0, 120).join('\n')}`
  ]

  if (snapshot.blockedSecretFiles.length > 0) {
    parts.push(
      `Secret files excluded from context (require explicit permission): ${snapshot.blockedSecretFiles.join(', ')}`
    )
  }

  if (activeFileContent) {
    parts.push(
      `Active editor file (${activeFileContent.relativePath}):\n\`\`\`\n${activeFileContent.content.slice(0, 14_000)}\n\`\`\``
    )
  }

  for (const file of snapshot.keyFiles) {
    parts.push(`File ${file.relativePath}:\n\`\`\`\n${file.content}\n\`\`\``)
  }

  for (const att of attachments) {
    if (att.kind === 'image') {
      parts.push(`Attached image: ${att.name} (${att.mimeType ?? 'image'})`)
      continue
    }
    if (att.previewText !== undefined) {
      parts.push(
        `Attached context (${att.relativePath ?? att.name}):\n\`\`\`\n${att.previewText.slice(0, 16_000)}\n\`\`\``
      )
    }
  }

  return parts.join('\n\n')
}

function formatRecentConversation(messages: readonly IdeChatMessage[]): string {
  const recent = messages.slice(-6)
  if (recent.length === 0) {
    return ''
  }
  return recent
    .map((m) => `[${m.role.toUpperCase()} - ${m.mode}]: ${m.text.slice(0, 2000)}`)
    .join('\n\n')
}

function responseLanguageInstruction(userText: string): string {
  const language = hasArabicText(userText) ? 'Arabic' : 'the same language as the user'
  return `Write every human-readable response field in ${language}. Keep it clear, natural, and concise—avoid robotic filler or overly long essays. Keep file paths, identifiers, code, and shell commands unchanged.`
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
}): string {
  return [
    'You are Code Nexus IDE AI Assistant in READ-ONLY ASK MODE.',
    'Rules:',
    '- Answer clearly, politely, and directly based strictly on the provided workspace context, conversation history, and active plan (if any).',
    '- If the user asks for clarification (e.g. "مش فاهم وضح" / "explain"), break down what is proposed in simple, practical human terms—avoid unnecessary technical jargon.',
    '- Use short paragraphs and crisp bullet points; avoid repeating raw JSON or long walls of text.',
    '- NEVER claim you modified files or executed tests or commands.',
    '- Cite exact inspected file paths when referencing workspace files.',
    `- ${responseLanguageInstruction(params.question)}`,
    formatRecentConversation(params.history),
    formatActivePlanContext(params.activePlan),
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent),
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
}): string {
  const isAgentMode = params.mode === 'agent'
  const schemaFields = [
    `  "intro": "1-2 short, natural human sentences summarizing what you will build or change (no file/step dump)",`,
    `  "objective": "concise 1-sentence goal",`,
    `  "affectedFiles": [\n    { "path": "relative/path/from/root.ts", "action": "create|modify|delete", "summary": "brief 3-10 word summary" }\n  ],`,
    `  "steps": [\n    { "title": "short scannable step title", "detail": "concise 1-2 sentence implementation instruction", "targetFiles": ["relative/path.ts"] }\n  ],`,
    `  "risks": ["only genuine technical/compatibility risks; [] if routine"],`,
    `  "testsAndVerification": ["short 1-line check or exact command"],`,
    isAgentMode
      ? `  "estimatedComplexity": "low|medium|high",\n  "requiresApproval": true`
      : `  "estimatedComplexity": "low|medium|high"`
  ].join('\n')

  return [
    params.multiAgentRoleHint ?? 'You are the Code Nexus Lead Planner.',
    'Mode: PLAN ONLY (no files may be modified and no commands may be run).',
    isAgentMode
      ? 'If the user is ONLY asking a question, seeking clarification, or chatting without requesting file changes, output ONLY:\n```json\n{\n  "responseType": "answer",\n  "message": "Clear, concise, direct markdown answer in the user language"\n}\n```\nOtherwise, inspect the workspace and output ONLY a valid JSON object matching this exact schema inside ```json ... ```:'
      : 'Inspect the workspace carefully and output ONLY a valid JSON object matching this exact schema inside ```json ... ```:',
    `{\n${schemaFields}\n}`,
    'Rules:',
    '- Include ONLY relative workspace file paths (never absolute paths or ..).',
    '- Keep `intro`, step titles, summaries, and verification checks crisp and easy for a developer to scan.',
    '- Leave `risks` as `[]` unless there is a real caveat (never add boilerplate warnings about OS or missing tools unless essential).',
    '- Do NOT invent non-existent scripts in `testsAndVerification`; if static HTML/CSS, keep checks to 1-2 short, clear 1-line checks.',
    ...(isAgentMode
      ? [
          '- Set `"requiresApproval": false` ONLY for small, unambiguous, low-risk edits (1-2 files, `low` complexity, no deletions or sensitive/config files). Set `"requiresApproval": true` for multi-file features, new projects/scaffolds, `medium`/`high` complexity, deletions, or ambiguous requests.'
        ]
      : []),
    '- Do NOT output file contents yet.',
    `- ${responseLanguageInstruction(params.request)}`,
    formatRecentConversation(params.history),
    formatWorkspaceContext(params.snapshot, params.attachments, params.activeFileContent),
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
    'Revise the existing Code Nexus implementation plan based on the user feedback.',
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

export function buildExecutionStepPrompt(params: {
  plan: IdeTaskPlan
  step: IdePlanStep
  currentFiles: { relativePath: string; content: string | null }[]
  completedSummaries: readonly string[]
  roleLabel: string
}): string {
  const fileDump = params.currentFiles
    .map((f) =>
      f.content === null
        ? `Target file ${f.relativePath}: [does not exist yet]`
        : `Current file ${f.relativePath}:\n\`\`\`\n${f.content}\n\`\`\``
    )
    .join('\n\n')

  return [
    `You are the ${params.roleLabel} executing ONE approved step in Code Nexus Agent Mode.`,
    `Approved objective: ${params.plan.objective}`,
    `Approved file scope (DO NOT touch other files): ${params.plan.affectedFiles.map((f) => `${f.action}:${f.path}`).join(', ')}`,
    `Current step (${params.step.index + 1}/${params.plan.steps.length}): ${params.step.title}`,
    `Detail: ${params.step.detail}`,
    responseLanguageInstruction(params.plan.requestSummary || params.plan.objective),
    params.completedSummaries.length > 0
      ? `Completed prior steps:\n- ${params.completedSummaries.join('\n- ')}`
      : '',
    fileDump,
    'Output ONLY a valid JSON object inside ```json ... ``` with complete final file contents for modified/created files:',
    `{
  "summary": "short human progress message for activity log",
  "operations": [
    {
      "path": "relative/path/in/approved/scope.ts",
      "action": "create|modify|delete",
      "content": "COMPLETE updated UTF-8 file text (omit only if action is delete)",
      "rationale": "why this file was updated"
    }
  ],
  "verificationCommands": [],
  "notes": "optional note"
}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildRepairFailurePrompt(params: {
  plan: IdeTaskPlan
  failedCommand: string
  stdoutTail: string
  stderrTail: string
  currentFiles: { relativePath: string; content: string | null }[]
}): string {
  const fileDump = params.currentFiles
    .filter((f) => f.content !== null)
    .map((f) => `Current file ${f.relativePath}:\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n')

  return [
    'You are the Code Nexus Test Fixer agent.',
    `Approved objective: ${params.plan.objective}`,
    `Approved file scope (stay strictly within scope): ${params.plan.affectedFiles.map((f) => f.path).join(', ')}`,
    `Verification command failed: ${params.failedCommand}`,
    params.stdoutTail ? `STDOUT:\n${params.stdoutTail.slice(-6000)}` : '',
    params.stderrTail ? `STDERR:\n${params.stderrTail.slice(-6000)}` : '',
    fileDump,
    'Return ONLY a valid JSON object inside ```json ... ``` with fixed file contents and summary (`summary`, `operations`, `verificationCommands`, `notes`).'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildReviewPrompt(params: {
  request: string
  diffSummary: string
  commandHistorySummary: string
  snapshot: WorkspaceInspectionSnapshot
  multiAgentReviewer?: boolean
}): string {
  return [
    params.multiAgentReviewer
      ? 'You are the Code Nexus Reviewer Agent performing a pre-completion quality, bug, and security check.'
      : 'You are Code Nexus Code Review Mode (READ-ONLY).',
    'Inspect the diffs and context carefully. Identify bugs, regressions, security issues, missing edge cases, and test coverage gaps.',
    'Do NOT claim to edit files. Organize your markdown review with sections: Summary, Findings (Bugs/Risks/Security), Quality & Improvements, Test Coverage.',
    responseLanguageInstruction(params.request),
    params.diffSummary || 'No tracked diffs found.',
    params.commandHistorySummary ? `Recent command runs:\n${params.commandHistorySummary}` : '',
    formatWorkspaceContext(params.snapshot, [], null),
    `Review request:\n${params.request}`
  ]
    .filter(Boolean)
    .join('\n\n')
}
