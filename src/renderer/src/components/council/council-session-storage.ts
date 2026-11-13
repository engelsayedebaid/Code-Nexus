import type { CouncilSession } from '../../../../shared/council/council-contract'

const STORAGE_KEY = 'code-nexus.council.sessions.v1'
const MAX_SESSIONS = 30

const FULL_REDACT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:AIza[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{20,}|gho_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/g
]

export function sanitizeCouncilExportText(value: string): string {
  let sanitized = value
  for (const pattern of FULL_REDACT_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }
  sanitized = sanitized.replace(/(Bearer\s+)[^\s"'`]{8,}/gi, '$1[REDACTED]')
  sanitized = sanitized.replace(
    /\b([A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|PRIVATE_KEY|PASSWORD)\s*[:=]\s*["']?)([^\s"'`]{8,})(["']?)/gi,
    '$1[REDACTED]$3'
  )
  return sanitized
}

function normalizeLoadedCouncilSession(session: CouncilSession): CouncilSession {
  const hasActiveRuntimeState =
    session.status === 'running' ||
    session.messages.some((message) => message.status === 'processing')
  if (!hasActiveRuntimeState) {
    return session
  }
  return {
    ...session,
    status: session.status === 'running' ? 'stopped' : session.status,
    messages: session.messages.map((message) =>
      message.status === 'processing'
        ? {
            ...message,
            status: 'cancelled',
            error: message.error || 'Interrupted before completion'
          }
        : message
    )
  }
}

export type CouncilSessionStorage = {
  load: () => CouncilSession[]
  save: (session: CouncilSession) => CouncilSession[]
}

/** A localStorage-backed transcript list; inline chat runs use their own key with the same format. */
export function createCouncilSessionStorage(
  storageKey: string,
  maxSessions = MAX_SESSIONS
): CouncilSessionStorage {
  const load = (): CouncilSession[] => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed
        .filter((item): item is CouncilSession => Boolean(item && typeof item === 'object'))
        .map(normalizeLoadedCouncilSession)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, maxSessions)
    } catch {
      return []
    }
  }
  const save = (session: CouncilSession): CouncilSession[] => {
    const sessions = load()
    const next = [session, ...sessions.filter((candidate) => candidate.id !== session.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxSessions)
    localStorage.setItem(storageKey, JSON.stringify(next))
    return next
  }
  return { load, save }
}

const councilSessionStorage = createCouncilSessionStorage(STORAGE_KEY)

export function loadCouncilSessions(): CouncilSession[] {
  return councilSessionStorage.load()
}

export function saveCouncilSession(session: CouncilSession): CouncilSession[] {
  return councilSessionStorage.save(session)
}

export function deleteCouncilSession(sessionId: string): CouncilSession[] {
  const next = loadCouncilSessions().filter((candidate) => candidate.id !== sessionId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function sanitizeCouncilSessionForExport(session: CouncilSession): CouncilSession {
  return {
    ...session,
    title: sanitizeCouncilExportText(session.title),
    prompt: sanitizeCouncilExportText(session.prompt),
    ...(session.finalDecision
      ? { finalDecision: sanitizeCouncilExportText(session.finalDecision) }
      : {}),
    queuedUserMessages: session.queuedUserMessages.map(sanitizeCouncilExportText),
    messages: session.messages.map((message) => ({
      ...message,
      content: sanitizeCouncilExportText(message.content),
      ...(message.error ? { error: sanitizeCouncilExportText(message.error) } : {})
    }))
  }
}

export function formatCouncilSessionExport(
  session: CouncilSession,
  format: 'json' | 'markdown'
): string {
  const safe = sanitizeCouncilSessionForExport(session)
  if (format === 'json') {
    return JSON.stringify(safe, null, 2)
  }
  return [
    `# ${safe.title}`,
    '',
    `Mode: ${safe.mode} · Status: ${safe.status} · Rounds: ${safe.currentRound}/${safe.maxRounds}`,
    '',
    '## Request',
    '',
    safe.prompt,
    '',
    ...safe.messages.flatMap((message) => [
      `## ${message.participantLabel} — ${message.role} — Round ${message.round}`,
      '',
      message.content || message.error || `[${message.status}]`,
      ''
    ])
  ].join('\n')
}

export function exportCouncilSession(session: CouncilSession, format: 'json' | 'markdown'): void {
  const body = formatCouncilSessionExport(session, format)
  const url = URL.createObjectURL(
    new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${session.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'council'}.${format === 'json' ? 'json' : 'md'}`
  anchor.click()
  URL.revokeObjectURL(url)
}
