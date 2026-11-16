import {
  chatTextAttachmentName,
  isCommittedChatAttachmentCandidate,
  nativeChatTextAttachmentParts
} from '../native-chat-text-attachment-references'
import { AGENT_SESSION_ATTACHMENTS_DIR_NAME } from '../agent-session/agent-session-attachments'

export type NativeChatVisibleAttachmentRef = {
  path: string
  displayName: string
  isPastedText: boolean
  index: number
  totalOfKind: number
}

/**
 * Accepts strictly files located inside an app-owned `agent-session-attachments/<dir>/orca-paste-*.txt`
 * or UUID-based committed attachment directory so arbitrary user text is never mistaken for an upload.
 */
export function isInternalAttachmentDisplayCandidate(path: string): boolean {
  if (isCommittedChatAttachmentCandidate(path)) {
    return true
  }
  const normalized = path.replace(/\\/g, '/')
  const pattern = new RegExp(
    `(?:^|/)${AGENT_SESSION_ATTACHMENTS_DIR_NAME}/[^/]+/orca-paste-[A-Za-z0-9._-]+\\.txt$`,
    'i'
  )
  return /^(?:\/|[a-z]:\/|\/\/)/i.test(normalized) && pattern.test(normalized)
}

function cleanStrippedAttachmentSpaces(parts: readonly string[]): string {
  const raw = parts.join('')
  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function extractNativeChatVisibleAttachments(
  text: string,
  structured: boolean,
  pastedTextLabel = 'Pasted text'
): {
  visibleText: string
  attachments: NativeChatVisibleAttachmentRef[]
} {
  const tokens = nativeChatTextAttachmentParts(text, structured, (candidate) =>
    structured ? isInternalAttachmentDisplayCandidate(candidate) : false
  )
  const uniquePaths: string[] = []
  const textFragments: string[] = []

  for (const part of tokens) {
    if (part.path) {
      if (!uniquePaths.includes(part.path)) {
        uniquePaths.push(part.path)
      }
      // Keep word separation when an inline token sat between two words, trimmed later.
      const prev = textFragments.at(-1)
      if (prev && !/\s$/.test(prev)) {
        textFragments.push(' ')
      }
    } else {
      textFragments.push(part.text)
    }
  }

  const pasteCount = uniquePaths.filter(
    (p) => chatTextAttachmentName(p, pastedTextLabel) === pastedTextLabel
  ).length

  let pasteIdx = 0
  const attachments: NativeChatVisibleAttachmentRef[] = uniquePaths.map((path, index) => {
    const baseLabel = chatTextAttachmentName(path, pastedTextLabel)
    const isPastedText = baseLabel === pastedTextLabel
    if (isPastedText) {
      pasteIdx += 1
    }
    const displayName =
      isPastedText && pasteCount > 1 ? `${pastedTextLabel} ${pasteIdx}` : baseLabel
    return {
      path,
      displayName,
      isPastedText,
      index,
      totalOfKind: isPastedText ? pasteCount : uniquePaths.length
    }
  })

  return {
    visibleText: uniquePaths.length > 0 ? cleanStrippedAttachmentSpaces(textFragments) : text,
    attachments
  }
}

export function sanitizeUserFacingAttachmentText(text: string, structured = true): string {
  return extractNativeChatVisibleAttachments(text, structured).visibleText
}
