import { hasArabicText } from '../../shared/ide-agent/ide-language'
import type {
  IdeChatAttachment,
  IdePlanStep,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import { describeReadOnlyToolPalette } from './ide-agent-tools'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-gateway'
import {
  formatBudgetedWorkspacePromptContext,
  type RankedContextSnippet
} from './harness/context-engine'
import {
  buildModelEditGuidance,
  type ResolvedModelExecutionProfile
} from './harness/model-capability-registry'
import {
  fenceUntrustedWorkspaceData,
  PROMPT_INJECTION_SYSTEM_GUARD
} from './harness/prompt-security-guard'
import type { WorkspaceInstructionsBundle } from './harness/workspace-instructions-loader'

export function responseLanguageInstruction(userText?: string): string {
  if (hasArabicText(userText)) {
    return 'Write every human-readable response field in clear, natural Arabic — do not mix English prose into Arabic sentences. Keep file paths, identifiers, code, and shell commands unchanged in LTR.'
  }
  return 'Write every human-readable response field in clear, natural English — never mix Arabic and English in the same response. Avoid robotic filler or overly long essays, and keep file paths, identifiers, code, and shell commands unchanged.'
}

export function clampPromptToModelBudget(prompt: string, maxPromptChars?: number): string {
  if (!maxPromptChars || prompt.length <= maxPromptChars) {
    return prompt
  }
  const headBudget = Math.floor(maxPromptChars * 0.55)
  const tailBudget = Math.max(800, maxPromptChars - headBudget - 96)
  return `${prompt.slice(0, headBudget)}\n\n... [middle context trimmed to fit model prompt limit] ...\n\n${prompt.slice(prompt.length - tailBudget)}`
}

export function formatInstructionsBundle(
  instructions?: WorkspaceInstructionsBundle | null
): string {
  if (!instructions) {
    return ''
  }
  return [
    instructions.projectRulesBlock,
    instructions.skillsSummaryBlock,
    instructions.mcpSummaryBlock
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function formatWorkspaceContext(
  snapshot: WorkspaceInspectionSnapshot,
  attachments: readonly IdeChatAttachment[],
  activeFileContent?: { relativePath: string; content: string } | null,
  options?: {
    rankedSnippets?: readonly RankedContextSnippet[]
    maxContextChars?: number
  }
): string {
  return formatBudgetedWorkspacePromptContext({
    snapshot,
    attachments,
    activeFileContent,
    rankedSnippets: options?.rankedSnippets,
    maxContextChars: options?.maxContextChars
  })
}

export function buildExecutionStepPrompt(params: {
  plan: IdeTaskPlan
  step: IdePlanStep
  currentFiles: { relativePath: string; content: string | null }[]
  completedSummaries: readonly string[]
  roleLabel: string
  toolObservations?: readonly string[]
  profile?: ResolvedModelExecutionProfile
  instructions?: WorkspaceInstructionsBundle | null
}): string {
  const maxPerFile = params.profile?.promptDelivery === 'argv' ? 5_000 : 24_000
  const fileDump = params.currentFiles
    .map((f) =>
      f.content === null
        ? `Target file ${f.relativePath}: [does not exist yet]`
        : fenceUntrustedWorkspaceData({
            kind: 'workspace_file',
            source: f.relativePath,
            content:
              f.content.length > maxPerFile
                ? `${f.content.slice(0, maxPerFile)}\n... [use read_file_range for remaining lines]`
                : f.content
          })
    )
    .join('\n\n')

  const rawPrompt = [
    `You are the ${params.roleLabel} executing ONE approved step in Carver Agent Mode.`,
    PROMPT_INJECTION_SYSTEM_GUARD,
    `Approved objective: ${params.plan.objective}`,
    `Approved scope: ${params.plan.affectedFiles.map((f) => `${f.action}:${f.path}`).join(', ')}`,
    `Current step (${params.step.index + 1}/${params.plan.steps.length}): ${params.step.title}`,
    `Detail: ${params.step.detail}`,
    params.profile ? buildModelEditGuidance(params.profile) : '',
    formatInstructionsBundle(params.instructions),
    describeReadOnlyToolPalette(),
    responseLanguageInstruction(params.plan.requestSummary || params.plan.objective),
    params.completedSummaries.length > 0
      ? `Completed prior steps:\n- ${params.completedSummaries.join('\n- ')}`
      : '',
    fileDump,
    params.toolObservations?.length
      ? fenceUntrustedWorkspaceData({
          kind: 'tool_output',
          source: 'step tool & recovery observations',
          content: params.toolObservations.join('\n\n')
        })
      : '',
    'To apply changes, output ONLY a valid JSON object inside ```json ... ```. Prefer `patch` (`patches` search/replace or `unifiedDiff`) when editing existing files so unrelated code stays untouched; use `create`/`modify` with complete `content` for new or small files, and `mkdir`/`rename`/`delete`/`delete_folder` when managing structure:',
    `{
  "summary": "short human progress message for activity log",
  "operations": [
    {
      "path": "relative/path/in/approved/scope.ts",
      "action": "create|modify|patch|delete|mkdir|rename|delete_folder",
      "fromPath": "only for rename",
      "content": "for create/modify",
      "patches": [{ "search": "exact existing lines", "replace": "replacement lines" }],
      "unifiedDiff": "optional standard @@ unified diff when action is patch",
      "rationale": "why this operation is needed"
    }
  ],
  "verificationCommands": [],
  "notes": "optional note"
}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}

export function buildRepairFailurePrompt(params: {
  plan: IdeTaskPlan
  failedCommand: string
  stdoutTail: string
  stderrTail: string
  currentFiles: { relativePath: string; content: string | null }[]
  profile?: ResolvedModelExecutionProfile
  instructions?: WorkspaceInstructionsBundle | null
}): string {
  const fileDump = params.currentFiles
    .filter((f) => f.content !== null)
    .map((f) =>
      fenceUntrustedWorkspaceData({
        kind: 'workspace_file',
        source: f.relativePath,
        content: (f.content ?? '').slice(0, 16_000)
      })
    )
    .join('\n\n')

  const commandLogs = [
    params.stdoutTail ? `STDOUT:\n${params.stdoutTail.slice(-5_000)}` : '',
    params.stderrTail ? `STDERR:\n${params.stderrTail.slice(-5_000)}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  const rawPrompt = [
    'You are the Carver Test Fixer agent. Diagnose the root cause of the verification failure before editing.',
    PROMPT_INJECTION_SYSTEM_GUARD,
    `Approved objective: ${params.plan.objective}`,
    `Approved file scope (stay strictly within scope): ${params.plan.affectedFiles.map((f) => f.path).join(', ')}`,
    params.profile ? buildModelEditGuidance(params.profile) : '',
    formatInstructionsBundle(params.instructions),
    `Verification command failed: ${params.failedCommand}`,
    commandLogs
      ? fenceUntrustedWorkspaceData({
          kind: 'command_output',
          source: params.failedCommand,
          content: commandLogs
        })
      : '',
    fileDump,
    'Return ONLY a valid JSON object inside ```json ... ``` with fixed file operations (`summary`, `operations`, `verificationCommands`, `notes`).'
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}

export function buildReviewPrompt(params: {
  request: string
  diffSummary: string
  commandHistorySummary: string
  snapshot: WorkspaceInspectionSnapshot
  attachments?: readonly IdeChatAttachment[]
  activeFileContent?: { relativePath: string; content: string } | null
  rankedSnippets?: readonly RankedContextSnippet[]
  instructions?: WorkspaceInstructionsBundle | null
  profile?: ResolvedModelExecutionProfile
  toolObservations?: readonly string[]
  allowTools?: boolean
  multiAgentReviewer?: boolean
}): string {
  const maxCtxChars = params.profile
    ? params.profile.allocation.retrievedContextTokens * 4
    : undefined
  const rawPrompt = [
    params.multiAgentReviewer
      ? 'You are the Carver Reviewer Agent performing a pre-completion quality, bug, and security check.'
      : 'You are in Carver Code Review Mode (READ-ONLY).',
    PROMPT_INJECTION_SYSTEM_GUARD,
    'Inspect the diffs, active file, and codebase context carefully. Identify concrete bugs, regressions, security issues, missing edge cases, and test gaps.',
    'Do NOT claim to edit files. Organize your markdown review cleanly with concise sections: Summary, Findings (with exact file:line citations), and Recommended Fixes.',
    params.allowTools !== false ? describeReadOnlyToolPalette() : '',
    responseLanguageInstruction(params.request),
    formatInstructionsBundle(params.instructions),
    params.diffSummary
      ? fenceUntrustedWorkspaceData({
          kind: 'git_diff',
          source: 'workspace git diff',
          content: params.diffSummary
        })
      : 'No uncommitted Git diffs found in the workspace root.',
    params.commandHistorySummary ? `Recent command runs:\n${params.commandHistorySummary}` : '',
    formatWorkspaceContext(params.snapshot, params.attachments ?? [], params.activeFileContent, {
      rankedSnippets: params.rankedSnippets,
      maxContextChars: maxCtxChars
    }),
    params.toolObservations?.length
      ? fenceUntrustedWorkspaceData({
          kind: 'tool_output',
          source: 'review tool observations',
          content: params.toolObservations.join('\n\n')
        })
      : '',
    `Review request:\n${params.request}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return clampPromptToModelBudget(rawPrompt, params.profile?.allocation.maxPromptChars)
}
