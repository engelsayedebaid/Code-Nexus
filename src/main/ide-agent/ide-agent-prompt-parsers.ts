import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdePlanFileAction } from '../../shared/ide-agent/ide-agent-types'

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
  action: 'create' | 'modify' | 'delete'
  content?: string
  rationale?: string
}

export type RawStepExecutionResult = {
  summary: string
  operations: RawStepExecutionOperation[]
  verificationCommands: string[]
  notes?: string
}

export function extractJsonObjectFromAiOutput(raw: string): Record<string, unknown> | null {
  const fencedMatches = Array.from(raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
  const candidates = [...fencedMatches.map((m) => m[1]?.trim() ?? ''), raw.trim()]

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    const firstBrace = candidate.indexOf('{')
    const lastBrace = candidate.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      continue
    }
    const slice = candidate.slice(firstBrace, lastBrace + 1)
    try {
      const parsed = JSON.parse(slice)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Try next candidate.
    }
  }
  return null
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
    const action =
      record.action === 'create' || record.action === 'modify' || record.action === 'delete'
        ? record.action
        : 'modify'
    affectedFiles.push({
      path: normalizeWorkspaceRelativePath(record.path),
      action,
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

/** Parses either a direct conversational answer or a structured implementation plan from planner output. */
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

export function parseStepOperationsFromAiOutput(raw: string): RawStepExecutionResult | null {
  const parsed = extractJsonObjectFromAiOutput(raw)
  if (!parsed) {
    return null
  }
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Applied planned step changes'
  const opsRaw = Array.isArray(parsed.operations) ? parsed.operations : []
  const operations: RawStepExecutionOperation[] = []
  for (const item of opsRaw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path.trim()) {
      continue
    }
    const action =
      record.action === 'create' || record.action === 'modify' || record.action === 'delete'
        ? record.action
        : 'modify'
    if (action !== 'delete' && typeof record.content !== 'string') {
      continue
    }
    operations.push({
      path: normalizeWorkspaceRelativePath(record.path),
      action,
      ...(typeof record.content === 'string' ? { content: record.content } : {}),
      ...(typeof record.rationale === 'string' ? { rationale: record.rationale.trim() } : {})
    })
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
