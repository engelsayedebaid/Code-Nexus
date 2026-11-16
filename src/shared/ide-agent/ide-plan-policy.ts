import type {
  IdeExecutionMode,
  IdePlanFileAction,
  IdePlanStep,
  IdeSensitiveActionKind,
  IdeTaskPlan
} from './ide-agent-types'

export function isModeWriteAllowed(mode: IdeExecutionMode): boolean {
  return mode === 'agent'
}

export function normalizeWorkspaceRelativePath(rawPath: string): string {
  const normalized = rawPath
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}

export function isUnsafeRelativePath(rawPath: string): boolean {
  const cleaned = rawPath.trim().replaceAll('\\', '/')
  if (!cleaned || cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) {
    return true
  }
  const segments = cleaned.split('/')
  return segments.some((segment) => segment === '..' || segment === '')
}

function stablePlanFingerprintInput(plan: {
  objective: string
  affectedFiles: readonly IdePlanFileAction[]
  steps: readonly Pick<IdePlanStep, 'title' | 'detail' | 'targetFiles'>[]
  risks: readonly string[]
  testsAndVerification: readonly string[]
}): string {
  return JSON.stringify({
    objective: plan.objective.trim(),
    affectedFiles: plan.affectedFiles.map((file) => ({
      path: normalizeWorkspaceRelativePath(file.path),
      action: file.action,
      summary: file.summary.trim()
    })),
    steps: plan.steps.map((step) => ({
      title: step.title.trim(),
      detail: step.detail.trim(),
      targetFiles: step.targetFiles.map(normalizeWorkspaceRelativePath)
    })),
    risks: plan.risks.map((item) => item.trim()),
    testsAndVerification: plan.testsAndVerification.map((item) => item.trim())
  })
}

/** Deterministic canonical 128-bit digest safe for both Node and browser environments. */
export function computeIdePlanHash(plan: {
  objective: string
  affectedFiles: readonly IdePlanFileAction[]
  steps: readonly Pick<IdePlanStep, 'title' | 'detail' | 'targetFiles'>[]
  risks: readonly string[]
  testsAndVerification: readonly string[]
}): string {
  const canonical = stablePlanFingerprintInput(plan)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  let h3 = 0x85ebca6b
  let h4 = 0xc2b2ae35
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ((code + i) & 0xff), 0x27d4eb2d) >>> 0
    h3 = Math.imul((h3 + code) ^ (h1 >>> 3), 0x165667b1) >>> 0
    h4 = Math.imul(h4 ^ code ^ (h2 >>> 5), 0x9e3779b1) >>> 0
  }
  return [h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('')
}

export function isPlanApprovedForExecution(
  plan: IdeTaskPlan | null | undefined,
  requestedFiles?: readonly string[]
): { ok: true } | { ok: false; reason: string; outOfScopePath?: string } {
  if (!plan) {
    return { ok: false, reason: 'No approved implementation plan exists for this task.' }
  }
  if (plan.status === 'rejected') {
    return { ok: false, reason: 'The implementation plan was rejected. Revise or create a new plan.' }
  }
  if (plan.status !== 'approved' && plan.status !== 'executing') {
    return {
      ok: false,
      reason: `Plan status is "${plan.status}". Explicit user approval is required before making edits.`
    }
  }
  const approval = plan.approvalRecord
  if (!approval || approval.decision !== 'approved') {
    return { ok: false, reason: 'No approval record found on the active plan.' }
  }
  if (approval.planVersion !== plan.version) {
    return {
      ok: false,
      reason: `Approval matches version ${approval.planVersion}, not current version ${plan.version}.`
    }
  }
  const expectedHash = computeIdePlanHash(plan)
  if (approval.planHash !== expectedHash || plan.planHash !== expectedHash) {
    return {
      ok: false,
      reason: 'The plan content changed after approval. Re-approval is required before execution.'
    }
  }
  if (requestedFiles && requestedFiles.length > 0) {
    const allowed = new Set(plan.affectedFiles.map((file) => normalizeWorkspaceRelativePath(file.path)))
    for (const candidate of requestedFiles) {
      const normalized = normalizeWorkspaceRelativePath(candidate)
      if (!allowed.has(normalized)) {
        return {
          ok: false,
          reason: `File "${normalized}" is outside the approved plan scope.`,
          outOfScopePath: normalized
        }
      }
    }
  }
  return { ok: true }
}

const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.?credentials(\.json)?$/i,
  /(^|\/)secrets?(\.[^/]+)?$/i,
  /(^|\/)tokens?\.json$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i
]

const PRODUCTION_CONFIG_PATTERNS: readonly RegExp[] = [
  /(^|\/)dockerfile(\..+)?$/i,
  /(^|\/)docker-compose(\.[^/]+)?\.ya?ml$/i,
  /(^|\/)\.github\/workflows\/.+$/i,
  /(^|\/)(deploy|k8s|kubernetes|terraform|helm|infra)\//i,
  /(^|\/)[^/]*prod(uction)?[^/]*\.(json|ya?ml|toml|ts|js|env)$/i
]

export function classifySensitiveFilePath(
  relativePath: string,
  operation: 'read-context' | 'write' | 'delete'
): IdeSensitiveActionKind | null {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return operation === 'read-context' ? 'send_secret_context' : 'modify_secrets'
  }
  if (operation === 'delete') {
    return 'delete_important_file'
  }
  if (PRODUCTION_CONFIG_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'production_config'
  }
  return null
}

const SENSITIVE_COMMAND_RULES: readonly {
  kind: IdeSensitiveActionKind
  pattern: RegExp
  reason: string
}[] = [
  {
    kind: 'git_push',
    pattern: /\bgit\s+(?:push|remote\s+add|remote\s+set-url)\b/i,
    reason: 'Pushes changes or alters Git remotes.'
  },
  {
    kind: 'destructive_command',
    pattern:
      /(?:^|[;&|\s])(?:rm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r|rf|fr)\b|del\s+\/[sq]|rmdir\s+\/s|remove-item\b[^\n]*-recurse|format\s+[a-z]:|mkfs\b|dd\s+if=|git\s+reset\s+--hard\b|git\s+clean\s+-[a-z]*f|drop\s+table\b|truncate\s+table\b)/i,
    reason: 'Potentially destructive filesystem, database, or Git reset command.'
  },
  {
    kind: 'deploy_application',
    pattern:
      /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+publish|vercel\b[^\n]*--prod|netlify\s+deploy|fly\s+deploy|railway\s+up|kubectl\s+(?:apply|delete)|terraform\s+apply|helm\s+(?:install|upgrade)|docker\s+push|gh\s+release\s+create)\b/i,
    reason: 'Publishes, releases, or deploys infrastructure/applications.'
  },
  {
    kind: 'install_software',
    pattern:
      /\b(?:npm\s+(?:i|install|add)\b|pnpm\s+(?:add|i|install)\b|yarn\s+add\b|bun\s+add\b|pip3?\s+install\b|cargo\s+install\b|brew\s+install\b|winget\s+install\b|choco\s+install\b|apt(?:-get)?\s+install\b|curl\b[^\n]*\|\s*(?:sh|bash)|iwr\b[^\n]*\|\s*iex)/i,
    reason: 'Installs packages or software into the project or system.'
  }
]

export function classifySensitiveCommand(
  command: string
): { kind: IdeSensitiveActionKind; reason: string } | null {
  const trimmed = command.trim()
  if (!trimmed) {
    return null
  }
  for (const rule of SENSITIVE_COMMAND_RULES) {
    if (rule.pattern.test(trimmed)) {
      return { kind: rule.kind, reason: rule.reason }
    }
  }
  return null
}
