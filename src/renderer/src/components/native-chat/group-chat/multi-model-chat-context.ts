import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { nativeChatMessageCopyText } from '../../../../../shared/native-chat/transcript/native-chat-message-copy-text'
import { sanitizeCouncilExportText } from '../../council/council-session-storage'

const MAX_SHARED_MESSAGES = 24
const MAX_SHARED_CHARS = 16_000
const MAX_MESSAGE_CHARS = 4_000

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[truncated]`
}

export type MultiModelSharedContextSummary = {
  messageCount: number
  preview: string
}

/**
 * Text-only summary from the existing single-model chat. Tool output, system
 * instructions, attachments, hidden reasoning, and detected tokens never leave the chat.
 */
export function describeMultiModelSharedContext(
  messages: readonly NativeChatMessage[]
): MultiModelSharedContextSummary | null {
  const visible = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_SHARED_MESSAGES)
    .flatMap((message) => {
      const text = nativeChatMessageCopyText(message).trim()
      return text
        ? [{ role: message.role, text: clip(sanitizeCouncilExportText(text), MAX_MESSAGE_CHARS) }]
        : []
    })
  if (visible.length === 0) {
    return null
  }
  return {
    messageCount: visible.length,
    preview: clip(
      visible
        .map((entry) => `### ${entry.role === 'user' ? 'User' : 'Assistant'}\n${entry.text}`)
        .join('\n\n'),
      MAX_SHARED_CHARS
    )
  }
}

export function buildMultiModelSharedContext(
  messages: readonly NativeChatMessage[]
): string | null {
  return describeMultiModelSharedContext(messages)?.preview ?? null
}
