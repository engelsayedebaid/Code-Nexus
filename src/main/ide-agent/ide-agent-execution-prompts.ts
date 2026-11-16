import { hasArabicText } from '../../shared/ide-agent/ide-language'
import type {
  IdeChatAttachment,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { describeReadOnlyToolPalette } from './ide-agent-tools'
import { formatIdeAttachmentPromptBlock } from './ide-attachment-prompt-context'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'

export function responseLanguageInstruction(userText: string): string {
  const language = hasArabicText(userText) ? 'Arabic' : 'the same language as the user'
  return `Write every human-readable response field in ${language}. Keep it clear, natural, and concise—avoid robotic filler or overly long essays. Keep file paths, identifiers, code, and shell commands unchanged.`
}

export function formatWorkspaceContext(
  snapshot: WorkspaceInspectionSnapshot,
  attachments: readonly IdeChatAttachment[],
  activeFileContent?: { relativePath: string; content: string } | null
): string {
  const arch = snapshot.architecture
  const archLines = arch
    ? [
        arch.stackLabels.length > 0 ? `Detected stack: ${arch.stackLabels.join(', ')}` : '',
        arch.packageManager ? `Package manager: ${arch.packageManager}` : '',
        Object.keys(arch.scripts).length > 0
          ? `Package scripts: ${Object.entries(arch.scripts)
              .slice(0, 12)
              .map(([k, v]) => `${k}="${v}"`)
              .join(', ')}`
          : '',
        arch.entryPoints.length > 0 ? `Entry points: ${arch.entryPoints.join(', ')}` : '',
        arch.conventions.length > 0 ? `Conventions: ${arch.conventions.join('; ')}` : ''
      ].filter(Boolean)
    : []

  const parts: string[] = [
    `Workspace root: ${snapshot.workspacePath}`,
    `Git repository: ${snapshot.isGitRepo ? 'yes' : 'no (folder workspace)'}`,
    ...archLines,
    `Files (${snapshot.fileList.length}):\n${snapshot.fileList.slice(0, 120).join('\n')}`
  ]

  if (snapshot.blockedSecretFiles.length > 0) {
    parts.push(
      `Secret files excluded from context (require explicit permission): ${snapshot.blockedSecretFiles.join(', ')}`
    )
  }

  for (const att of attachments) {
    parts.push(formatIdeAttachmentPromptBlock(att))
  }

  if (activeFileContent) {
    parts.push(
      `Active editor file (${activeFileContent.relativePath}):\n\`\`\`\n${activeFileContent.content.slice(0, 12_000)}\n\`\`\``
    )
  }

  for (const file of snapshot.keyFiles) {
    parts.push(`File ${file.relativePath}:\n\`\`\`\n${file.content}\n\`\`\``)
  }

  return parts.join('\n\n')
}

export function buildExecutionStepPrompt(params: {
  plan: IdeTaskPlan
  step: IdePlanStep
  currentFiles: { relativePath: string; content: string | null }[]
  completedSummaries: readonly string[]
  roleLabel: string
  toolObservations?: readonly string[]
}): string {
  const fileDump = params.currentFiles
    .map((f) =>
      f.content === null
        ? `Target file ${f.relativePath}: [does not exist yet]`
        : `Current file ${f.relativePath}:\n\`\`\`\n${f.content}\n\`\`\``
    )
    .join('\n\n')

  return [
    `You are the ${params.roleLabel} executing ONE approved step in Carver Agent Mode.`,
    `Approved objective: ${params.plan.objective}`,
    `Approved scope: ${params.plan.affectedFiles.map((f) => `${f.action}:${f.path}`).join(', ')}`,
    `Current step (${params.step.index + 1}/${params.plan.steps.length}): ${params.step.title}`,
    `Detail: ${params.step.detail}`,
    describeReadOnlyToolPalette(),
    responseLanguageInstruction(params.plan.requestSummary || params.plan.objective),
    params.completedSummaries.length > 0
      ? `Completed prior steps:\n- ${params.completedSummaries.join('\n- ')}`
      : '',
    fileDump,
    params.toolObservations?.length
      ? `Tool observations gathered:\n${params.toolObservations.join('\n\n')}`
      : '',
    'To apply changes, output ONLY a valid JSON object inside ```json ... ```. Prefer `patch` (search/replace) when editing large existing files so unrelated code stays untouched; use `create`/`modify` with complete `content` for new or small files, and `mkdir`/`rename`/`delete`/`delete_folder` when managing structure:',
    `{
  "summary": "short human progress message for activity log",
  "operations": [
    {
      "path": "relative/path/in/approved/scope.ts",
      "action": "create|modify|patch|delete|mkdir|rename|delete_folder",
      "fromPath": "only for rename",
      "content": "for create/modify",
      "patches": [{ "search": "exact existing lines", "replace": "replacement lines" }],
      "rationale": "why this operation is needed"
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
    'You are the Carver Test Fixer agent.',
    `Approved objective: ${params.plan.objective}`,
    `Approved file scope (stay strictly within scope): ${params.plan.affectedFiles.map((f) => f.path).join(', ')}`,
    `Verification command failed: ${params.failedCommand}`,
    params.stdoutTail ? `STDOUT:\n${params.stdoutTail.slice(-6000)}` : '',
    params.stderrTail ? `STDERR:\n${params.stderrTail.slice(-6000)}` : '',
    fileDump,
    'Return ONLY a valid JSON object inside ```json ... ``` with fixed file operations (`summary`, `operations`, `verificationCommands`, `notes`).'
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
      ? 'You are the Carver Reviewer Agent performing a pre-completion quality, bug, and security check.'
      : 'You are in Carver Code Review Mode (READ-ONLY).',
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
