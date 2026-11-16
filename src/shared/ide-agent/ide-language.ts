import type { IdeChatMessage } from './ide-agent-types'

const ARABIC_SCRIPT_PATTERN = /[\u0600-\u06ff]/
const STRONG_LETTER_PATTERN = /\p{L}/u

/** Returns true if text contains any Arabic-script characters. */
export function hasArabicText(text: string | null | undefined): boolean {
  return Boolean(text && ARABIC_SCRIPT_PATTERN.test(text))
}

/**
 * Determines whether the conversation should display Arabic response chrome.
 * Inspects the latest user message that contains strong letters so switching
 * from English to Arabic (or vice versa) updates the UI cleanly without flipping
 * back on symbol-only messages.
 */
export function isArabicIdeConversation(
  messages: readonly Pick<IdeChatMessage, 'role' | 'text'>[] | null | undefined
): boolean {
  if (!messages || messages.length === 0) {
    return false
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index]
    if (msg.role !== 'user') {
      continue
    }
    if (hasArabicText(msg.text)) {
      return true
    }
    if (STRONG_LETTER_PATTERN.test(msg.text)) {
      return false
    }
  }
  return messages.some((msg) => hasArabicText(msg.text))
}

/** Formats Arabic nouns cleanly across singular, dual, 3-10 plural, and 11+ forms. */
export function formatArabicCount(
  count: number,
  forms: { singular: string; dual: string; plural: string; accusative: string }
): string {
  if (count === 1) {
    return `${count} ${forms.singular}`
  }
  if (count === 2) {
    return `${count} ${forms.dual}`
  }
  const mod100 = count % 100
  if (mod100 >= 3 && mod100 <= 10) {
    return `${count} ${forms.plural}`
  }
  if (count === 0) {
    return `0 ${forms.plural}`
  }
  return `${count} ${forms.accusative}`
}
