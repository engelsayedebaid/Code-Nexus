import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdePlanFileAction } from '../../shared/ide-agent/ide-agent-types'
import type { SearchReplacePatch } from '../../shared/ide-agent/ide-patch-chunker'
import {
  extractJsonObjectFromAiOutput,
  unwrapDirectAnswerJsonIfPresent
} from './ide-agent-json-extract'

export { extractJsonObjectFromAiOutput, unwrapDirectAnswerJsonIfPresent }

export type RawPlannedTask = {
  intro?: string
  objective: string
  affectedFiles: IdePlanFileAction[]
  steps: {
    title: string
    detail: string
    targetFiles: string[]
  }[]
  risks: string[]
  testsAndVerification: string[]
  estimatedComplexity: 'low' | 'medium' | 'high'
  requiresApproval?: boolean
}

export type RawPlannerTurnResult =
  | { kind: 'answer'; message: string }
  | { kind: 'plan'; plan: RawPlannedTask }

export type RawStepExecutionOperation = {
  path: string
  fromPath?: string
  action: 'create' | 'modify' | 'delete' | 'patch' | 'mkdir' | 'rename' | 'delete_folder'
  content?: string
  patches?: SearchReplacePatch[]
  unifiedDiff?: string
  rationale?: string
}

export type RawStepExecutionResult = {
  summary: string
  operations: RawStepExecutionOperation[]
  verificationCommands: string[]
  notes?: string
}

export type RawAgentToolCall = {
  tool: string
  args: Record<string, unknown>
}

export function parseToolCallsFromAiOutput(raw: string): RawAgentToolCall[] | null {
  const parsed = extractJsonObjectFromAiOutput(raw)
  if (!parsed || !Array.isArray(parsed.toolCalls) || parsed.toolCalls.length === 0) {
    return null
  }
  const calls: RawAgentToolCall[] = []
  for (const item of parsed.toolCalls) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rec = item as Record<string, unknown>
    if (typeof rec.tool !== 'string' || !rec.tool.trim()) {
      continue
    }
    const args =
      rec.args && typeof rec.args === 'object' && !Array.isArray(rec.args)
        ? (rec.args as Record<string, unknown>)
        : {}
    calls.push({ tool: rec.tool.trim(), args })
  }
  return calls.length > 0 ? calls : null
}

function parsePlanAction(raw: unknown): IdePlanFileAction['action'] {
  switch (raw) {
    case 'create':
    case 'modify':
    case 'delete':
    case 'mkdir':
    case 'rename':
    case 'delete_folder':
      return raw
    default:
      return 'modify'
  }
}

export function parsePlanJsonFromAiOutput(
  raw: string,
  fallbackRequest: string
): RawPlannedTask | null {
  const parsed = extractJsonObjectFromAiOutput(raw)
  if (!parsed) {
    return null
  }
  const intro =
    typeof parsed.intro === 'string' && parsed.intro.trim() ? parsed.intro.trim() : undefined
  const objective =
    typeof parsed.objective === 'string' && parsed.objective.trim()
      ? parsed.objective.trim()
      : fallbackRequest.slice(0, 200)

  const affectedFilesRaw = Array.isArray(parsed.affectedFiles) ? parsed.affectedFiles : []
  const affectedFiles: IdePlanFileAction[] = []
  for (const item of affectedFilesRaw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path.trim()) {
      continue
    }
    affectedFiles.push({
      path: normalizeWorkspaceRelativePath(record.path),
      ...(typeof record.fromPath === 'string' && record.fromPath.trim()
        ? { fromPath: normalizeWorkspaceRelativePath(record.fromPath) }
        : {}),
      action: parsePlanAction(record.action),
      summary: typeof record.summary === 'string' ? record.summary.trim() : ''
    })
  }

  const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : []
  const steps = stepsRaw
    .map((item, idx) => {
      if (typeof item === 'string') {
        return { title: item.trim(), detail: item.trim(), targetFiles: [] }
      }
      if (!item || typeof item !== 'object') {
        return null
      }
      const record = item as Record<string, unknown>
      const title =
        typeof record.title === 'string' && record.title.trim()
          ? record.title.trim()
          : `Step ${idx + 1}`
      const detail =
        typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : title
      const targetFiles = Array.isArray(record.targetFiles)
        ? record.targetFiles
            .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
            .map(normalizeWorkspaceRelativePath)
        : []
      return { title, detail, targetFiles }
    })
    .filter(
      (step): step is { title: string; detail: string; targetFiles: string[] } => step !== null
    )

  if (steps.length === 0) {
    return null
  }

  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : []
  const testsAndVerification = Array.isArray(parsed.testsAndVerification)
    ? parsed.testsAndVerification.filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0
      )
    : []
  const estimatedComplexity =
    parsed.estimatedComplexity === 'low' ||
    parsed.estimatedComplexity === 'medium' ||
    parsed.estimatedComplexity === 'high'
      ? parsed.estimatedComplexity
      : affectedFiles.length > 5
        ? 'high'
        : affectedFiles.length > 2
          ? 'medium'
          : 'low'

  const requiresApproval =
    typeof parsed.requiresApproval === 'boolean' ? parsed.requiresApproval : undefined

  return {
    ...(intro ? { intro } : {}),
    objective,
    affectedFiles,
    steps,
    risks,
    testsAndVerification,
    estimatedComplexity,
    ...(requiresApproval !== undefined ? { requiresApproval } : {})
  }
}

export function parsePlanOrAnswerFromAiOutput(
  raw: string,
  fallbackRequest: string
): RawPlannerTurnResult | null {
  const parsed = extractJsonObjectFromAiOutput(raw)
  if (
    parsed &&
    parsed.responseType === 'answer' &&
    typeof parsed.message === 'string' &&
    parsed.message.trim()
  ) {
    return { kind: 'answer', message: parsed.message.trim() }
  }
  const plan = parsePlanJsonFromAiOutput(raw, fallbackRequest)
  if (plan) {
    return { kind: 'plan', plan }
  }
  return null
}

function parseStepAction(raw: unknown): RawStepExecutionOperation['action'] {
  switch (raw) {
    case 'create':
    case 'modify':
    case 'delete':
    case 'patch':
    case 'mkdir':
    case 'rename':
    case 'delete_folder':
      return raw
    default:
      return 'modify'
  }
}

export function parseStepOperationsFromAiOutput(raw: string): RawStepExecutionResult | null {
  const parsed = extractJsonObjectFromAiOutput(raw)
  if (!parsed || Array.isArray(parsed.toolCalls) || !Array.isArray(parsed.operations)) {
    return null
  }
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Applied planned step changes'
  const opsRaw = parsed.operations
  const operations: RawStepExecutionOperation[] = []
  for (const item of opsRaw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path.trim()) {
      continue
    }
    const action = parseStepAction(record.action)
    const patches = Array.isArray(record.patches)
      ? record.patches
          .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
          .filter((p) => typeof p.search === 'string' && typeof p.replace === 'string')
          .map((p) => ({
            search: p.search as string,
            replace: p.replace as string,
            ...(typeof p.replaceAll === 'boolean' ? { replaceAll: p.replaceAll } : {})
          }))
      : undefined
    const unifiedDiff =
      typeof record.unifiedDiff === 'string' && record.unifiedDiff.trim()
        ? record.unifiedDiff
        : typeof record.diff === 'string' && record.diff.trim()
          ? record.diff
          : undefined
    if (action === 'patch' && (!patches || patches.length === 0) && !unifiedDiff) {
      continue
    }
    if ((action === 'create' || action === 'modify') && typeof record.content !== 'string') {
      continue
    }
    if (action === 'rename' && (typeof record.fromPath !== 'string' || !record.fromPath.trim())) {
      continue
    }
    operations.push({
      path: normalizeWorkspaceRelativePath(record.path),
      ...(typeof record.fromPath === 'string' && record.fromPath.trim()
        ? { fromPath: normalizeWorkspaceRelativePath(record.fromPath) }
        : {}),
      action,
      ...(typeof record.content === 'string' ? { content: record.content } : {}),
      ...(patches && patches.length > 0 ? { patches } : {}),
      ...(unifiedDiff ? { unifiedDiff } : {}),
      ...(typeof record.rationale === 'string' ? { rationale: record.rationale.trim() } : {})
    })
  }
  if (opsRaw.length > 0 && operations.length === 0) {
    return null
  }
  const verificationCommands = Array.isArray(parsed.verificationCommands)
    ? parsed.verificationCommands.filter(
        (cmd): cmd is string => typeof cmd === 'string' && cmd.trim().length > 0
      )
    : []
  return {
    summary,
    operations,
    verificationCommands,
    ...(typeof parsed.notes === 'string' && parsed.notes.trim()
      ? { notes: parsed.notes.trim() }
      : {})
  }
}
