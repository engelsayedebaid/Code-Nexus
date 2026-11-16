import type { AgentJournalRenderItem } from '../journal/agent-session-journal-types'
import { isRootAgentJournalItem } from '../journal/agent-session-journal-producer'
import { isStructuredAgentSessionCommandEntry } from '../structured-agent-session-command-entry'
import { sliceAtCodeUnitLimit } from '../../surrogate-safe-text-slice'
import { stripSentImagePromptMarkers } from '../../native-chat/transcript/native-chat-image-transcript-markers'

export const STRUCTURED_CHAT_NAME_PROMPT_LIMIT = 4000

const ATTACHMENT_PATH_PATTERNS: readonly RegExp[] = [
  /@?"[^"\r\n]*[\\/]agent-session-attachments[\\/][^\\/"\r\n]+[\\/][^"\r\n]*"/gi,
  /file:\/\/\/[^\s"'`<>[\])]*[\\/]agent-session-attachments[\\/][0-9a-f-]{36}[\\/][^\s"'`<>[\])]+/gi,
  /@?(?:[A-Za-z]:\\|\/)[^\r\n"'`<>[\])]*[\\/]agent-session-attachments[\\/][0-9a-f-]{36}[\\/][^\s"'`<>[\])]+/gi,
  /"[^"\r\n]*AppData[\\/](?:Local|Roaming|LocalLow)[\\/]Temp[\\/][^"\r\n]*"/gi,
  /[A-Za-z]:\\[^\r\n"'`<>[\])]*AppData[\\/](?:Local|Roaming|LocalLow)[\\/]Temp[\\/][^\s"'`<>[\])]+/gi
]

export function stripTemporaryAttachmentPaths(prompt: string): string {
  let cleaned = prompt
  for (const pattern of ATTACHMENT_PATH_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned
    .replace(/\[\s*\]/g, ' ')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim()
}

export function hasStructuredChatPromptText(prompt: string): boolean {
  return /[\p{L}\p{N}]/u.test(stripTemporaryAttachmentPaths(prompt))
}

export function firstStructuredAgentSessionPrompt(
  items: readonly AgentJournalRenderItem[]
): string {
  for (const item of items) {
    const body = item.body
    if (
      body.kind !== 'message' ||
      body.role !== 'user' ||
      !isRootAgentJournalItem(item) ||
      isStructuredAgentSessionCommandEntry(body)
    ) {
      continue
    }
    let prompt = ''
    const imageCount = body.blocks.filter((block) => block.type === 'image-ref').length
    for (const block of body.blocks) {
      if (block.type === 'text') {
        const sanitized = stripTemporaryAttachmentPaths(
          stripSentImagePromptMarkers(block.text, imageCount)
        )
        if (!sanitized) {
          continue
        }
        if (prompt) {
          prompt += '\n'
        }
        // A title names what was asked; `[Image #N]` and temp attachment paths do not.
        prompt += sliceAtCodeUnitLimit(sanitized, STRUCTURED_CHAT_NAME_PROMPT_LIMIT - prompt.length)
        if (prompt.length >= STRUCTURED_CHAT_NAME_PROMPT_LIMIT) {
          break
        }
      }
    }
    if (hasStructuredChatPromptText(prompt)) {
      return prompt.trim()
    }
  }
  return ''
}
