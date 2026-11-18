import type { IdeChatMessage, IdeConversation } from '../../../shared/ide-agent/ide-agent-types'
import { redactSensitiveSecrets } from './prompt-security-guard'

export type CompactedConversationContext = {
  formattedHistory: string
  compactedCount: number
  preservedConstraints: string[]
}

const CONSTRAINT_SIGNAL_PATTERN =
  /\b(?:must|never|always|do\s+not|don't|required|constraint|architecture|keep|preserve|only|strictly|avoid|timeout|convention)\b|(?:يجب|ممنوع|لا\s+تقم|دائما|دائماً|حافظ|التزم)/i

function extractDurableRequirementLine(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (!clean) {
    return null
  }
  if (CONSTRAINT_SIGNAL_PATTERN.test(clean)) {
    return clean.slice(0, 320)
  }
  return null
}

export function buildCompactedConversationHistory(params: {
  messages: readonly IdeChatMessage[]
  conversation?: Pick<IdeConversation, 'fileChanges' | 'commandExecutions' | 'plans'> | null
  maxHistoryChars: number
}): CompactedConversationContext {
  const { messages, conversation, maxHistoryChars } = params
  if (messages.length === 0 || maxHistoryChars <= 200) {
    return { formattedHistory: '', compactedCount: 0, preservedConstraints: [] }
  }

  const recentWindowCount = messages.length > 6 ? 4 : messages.length
  const olderMessages = messages.slice(0, messages.length - recentWindowCount)
  const recentMessages = messages.slice(-recentWindowCount)

  const preservedConstraints: string[] = []
  const olderUserTopics: string[] = []

  if (olderMessages.length > 0) {
    const firstUser = olderMessages.find((m) => m.role === 'user')
    if (firstUser) {
      const initialGoal = redactSensitiveSecrets(
        firstUser.text.trim().replace(/\s+/g, ' ').slice(0, 360)
      ).text
      if (initialGoal) {
        preservedConstraints.push(`Initial request: ${initialGoal}`)
      }
    }

    for (const msg of olderMessages) {
      if (msg.role !== 'user') {
        continue
      }
      const constraint = extractDurableRequirementLine(msg.text)
      if (constraint) {
        const sanitized = redactSensitiveSecrets(constraint).text
        if (!preservedConstraints.some((existing) => existing.includes(sanitized))) {
          preservedConstraints.push(sanitized)
        }
      } else {
        const topic = redactSensitiveSecrets(
          msg.text.trim().replace(/\s+/g, ' ').slice(0, 140)
        ).text
        if (topic) {
          olderUserTopics.push(topic)
        }
      }
    }
  }

  const summarySections: string[] = []
  if (olderMessages.length > 0) {
    const constraintBlock =
      preservedConstraints.length > 0
        ? `Active user requirements & constraints:\n${preservedConstraints
            .slice(0, 8)
            .map((c) => `- ${c}`)
            .join('\n')}`
        : ''
    const priorTopicsBlock =
      olderUserTopics.length > 0
        ? `Earlier compacted turns (${olderMessages.length} messages): ${olderUserTopics
            .slice(-5)
            .join(' | ')}`
        : `Earlier compacted turns: ${olderMessages.length} messages`

    const modifiedSummary =
      conversation && conversation.fileChanges.length > 0
        ? `Previously modified files in session: ${Array.from(
            new Set(conversation.fileChanges.map((f) => `${f.relativePath} (${f.acceptedState})`))
          )
            .slice(-10)
            .join(', ')}`
        : ''

    const failedCommands =
      conversation?.commandExecutions
        .filter((c) => c.status === 'failed')
        .slice(-3)
        .map((c) => `${c.command} (exit ${c.exitCode ?? 1})`) ?? []
    const outstandingErrors =
      failedCommands.length > 0 ? `Recent failed checks: ${failedCommands.join('; ')}` : ''

    summarySections.push(
      [
        '### Compacted Session Memory',
        constraintBlock,
        priorTopicsBlock,
        modifiedSummary,
        outstandingErrors
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  const summaryHeader = summarySections.join('\n\n')
  const remainingForRecent = Math.max(400, maxHistoryChars - summaryHeader.length - 80)
  const perMessageCap = Math.max(
    240,
    Math.min(2_000, Math.floor(remainingForRecent / Math.max(1, recentMessages.length)))
  )

  const recentFormatted = recentMessages
    .map((m) => {
      const clean = redactSensitiveSecrets(m.text.slice(0, perMessageCap)).text
      return `[${m.role.toUpperCase()} - ${m.mode}]: ${clean}`
    })
    .join('\n\n')

  const combined = [
    summaryHeader,
    recentFormatted ? `### Recent Conversation\n${recentFormatted}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    formattedHistory:
      combined.length > maxHistoryChars
        ? `${combined.slice(0, maxHistoryChars)}\n... [history trimmed to budget]`
        : combined,
    compactedCount: olderMessages.length,
    preservedConstraints
  }
}
