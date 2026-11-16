import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import { formatSmartAttachmentSize } from '../../../../../shared/smart-paste/smart-paste-config'

export function resolveIdeAttachmentDisplayName(
  attachment: IdeChatAttachment,
  siblings: readonly IdeChatAttachment[]
): string {
  if (attachment.kind !== 'pasted_text') {
    return attachment.name
  }
  const pasted = siblings.filter((item) => item.kind === 'pasted_text')
  if (pasted.length <= 1) {
    return attachment.name || 'Pasted text'
  }
  const index = pasted.findIndex((item) => item.id === attachment.id)
  if (index === -1) {
    return attachment.name || 'Pasted text'
  }
  const base = attachment.name?.trim() || 'Pasted text'
  return /\s\d+$/.test(base) ? base : `${base} ${index + 1}`
}

export function resolveIdeAttachmentSubtitle(attachment: IdeChatAttachment): string {
  if (attachment.kind !== 'pasted_text') {
    if (attachment.lineRange) {
      const { start, end } = attachment.lineRange
      return end > start ? `L${start}-${end}` : `L${start}`
    }
    return ''
  }
  if (attachment.status === 'missing') {
    return 'Unavailable attachment'
  }
  if (attachment.sizeBytes !== undefined) {
    return `Text attachment · ${formatSmartAttachmentSize(attachment.sizeBytes)}`
  }
  return 'Text attachment'
}
