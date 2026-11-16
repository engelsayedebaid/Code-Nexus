import type { IdeChatAttachment, IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import { formatSmartAttachmentSize } from '../../shared/smart-paste/smart-paste-config'
import type { RawAgentToolCall } from './ide-agent-prompt-parsers'
import type { ExecutedToolObservation } from './ide-agent-search-tools'
import type { IdeAttachmentStore } from './ide-attachment-store'
import type { IdeContextBudgetTracker } from './ide-context-budget'

const ATTACHMENT_READ_TOOL_NAMES = new Set([
  'list_message_attachments',
  'read_attachment',
  'read_attachment_range',
  'search_attachment_content'
])

export function isAttachmentReadToolName(tool: string): boolean {
  return ATTACHMENT_READ_TOOL_NAMES.has(tool)
}

export function describeAttachmentToolPalette(): string[] {
  return [
    '- list_message_attachments: {}',
    '- read_attachment: { "attachmentId": "paste-...", "startLine"?: 1, "endLine"?: 200 }',
    '- read_attachment_range: { "attachmentId": "paste-...", "startLine": 1, "endLine": 200 }',
    '- search_attachment_content: { "attachmentId": "paste-...", "query": "text" }'
  ]
}

function collectConversationAttachments(conv: IdeConversation): IdeChatAttachment[] {
  const byId = new Map<string, IdeChatAttachment>()
  for (const message of conv.messages) {
    for (const att of message.attachments ?? []) {
      byId.set(att.id, att)
    }
  }
  return Array.from(byId.values())
}

export async function executeAttachmentReadTool(params: {
  call: RawAgentToolCall
  conv?: IdeConversation
  attachmentStore?: IdeAttachmentStore | null
  budget: IdeContextBudgetTracker
}): Promise<ExecutedToolObservation | null> {
  const { call, conv, attachmentStore, budget } = params
  if (!ATTACHMENT_READ_TOOL_NAMES.has(call.tool)) {
    return null
  }
  if (!conv) {
    return {
      tool: call.tool,
      ok: false,
      summary: 'No conversation context for attachment tool',
      output: 'Conversation context is unavailable.',
      activityType: 'tool.search'
    }
  }

  const allAttachments = collectConversationAttachments(conv)

  if (call.tool === 'list_message_attachments') {
    if (allAttachments.length === 0) {
      return {
        tool: call.tool,
        ok: true,
        summary: 'No attachments in conversation',
        output: 'No attachments exist in this conversation.',
        activityType: 'tool.search'
      }
    }
    const lines = allAttachments.map((att) => {
      const meta = [
        `id=${att.id}`,
        `kind=${att.kind}`,
        `name="${att.name}"`,
        att.sizeBytes !== undefined ? `size=${formatSmartAttachmentSize(att.sizeBytes)}` : '',
        att.lineCount !== undefined ? `lines=${att.lineCount}` : '',
        att.format ? `format=${att.format}` : '',
        att.status ? `status=${att.status}` : ''
      ]
        .filter(Boolean)
        .join(' ')
      return `- ${meta}`
    })
    return {
      tool: call.tool,
      ok: true,
      summary: `Listed ${allAttachments.length} attachment(s)`,
      output: lines.join('\n'),
      activityType: 'tool.search'
    }
  }

  const attachmentId =
    typeof call.args.attachmentId === 'string' ? call.args.attachmentId.trim() : ''
  if (!attachmentId) {
    return {
      tool: call.tool,
      ok: false,
      summary: `${call.tool} missing attachmentId`,
      output: 'Argument "attachmentId" is required.',
      activityType: 'analysis.file_read'
    }
  }

  const attachment = allAttachments.find((item) => item.id === attachmentId)
  if (!attachment) {
    return {
      tool: call.tool,
      ok: false,
      summary: `Attachment not found: ${attachmentId}`,
      output: `No attachment with id "${attachmentId}" belongs to this conversation.`,
      activityType: 'analysis.file_read'
    }
  }

  if (call.tool === 'search_attachment_content') {
    const query = typeof call.args.query === 'string' ? call.args.query : ''
    if (!query.trim()) {
      return {
        tool: call.tool,
        ok: false,
        summary: 'search_attachment_content missing query',
        output: 'Argument "query" is required.',
        activityType: 'tool.search'
      }
    }
    if (attachment.kind !== 'pasted_text' || !attachmentStore) {
      const fallbackText = attachment.previewText ?? ''
      const needle = query.toLowerCase()
      const hits = fallbackText
        .split(/\r\n|\n|\r/)
        .map((line, index) => ({ line: index + 1, preview: line }))
        .filter((entry) => entry.preview.toLowerCase().includes(needle))
        .slice(0, 30)
      return {
        tool: call.tool,
        ok: true,
        summary: `Found ${hits.length} match(es) in ${attachment.name}`,
        output:
          hits.map((h) => `${attachmentId}:${h.line}: ${h.preview}`).join('\n') ||
          `No matches found for "${query}" in ${attachment.name}.`,
        activityType: 'tool.search'
      }
    }
    const result = await attachmentStore.searchContent({
      conversationId: conv.id,
      attachmentId,
      query
    })
    if (!result.exists) {
      return {
        tool: call.tool,
        ok: false,
        summary: `Attachment missing on disk: ${attachment.name}`,
        output: `Attachment "${attachment.name}" (${attachmentId}) is no longer available on disk.`,
        activityType: 'tool.search'
      }
    }
    const text =
      result.hits.map((h) => `${attachmentId}:${h.line}: ${h.preview}`).join('\n') ||
      `No matches found for "${query}" in ${attachment.name}.`
    return {
      tool: call.tool,
      ok: true,
      summary: `Found ${result.hits.length} match(es) in ${attachment.name}`,
      output: budget.recordText(`att-search:${attachmentId}:${query}`, text).text,
      activityType: 'tool.search'
    }
  }

  const startLine =
    typeof call.args.startLine === 'number' && Number.isFinite(call.args.startLine)
      ? Math.max(1, Math.floor(call.args.startLine))
      : 1
  const endLine =
    typeof call.args.endLine === 'number' && Number.isFinite(call.args.endLine)
      ? Math.max(startLine, Math.floor(call.args.endLine))
      : startLine + 199

  if (attachment.kind !== 'pasted_text' || !attachmentStore) {
    const raw = attachment.previewText ?? ''
    if (!raw) {
      return {
        tool: call.tool,
        ok: false,
        summary: `Attachment content unavailable: ${attachment.name}`,
        output: `Attachment "${attachment.name}" (${attachmentId}) has no readable text content.`,
        activityType: 'analysis.file_read'
      }
    }
    const lines = raw.split(/\r\n|\n|\r/)
    const sliced = lines.slice(startLine - 1, endLine).join('\n')
    const recorded = budget.recordText(`att:${attachmentId}:${startLine}-${endLine}`, sliced)
    return {
      tool: call.tool,
      ok: true,
      summary: `Read ${attachment.name}:${startLine}-${Math.min(endLine, lines.length)}`,
      output: `Attachment "${attachment.name}" (${attachmentId}) lines ${startLine}-${Math.min(endLine, lines.length)} of ${lines.length}:\n${recorded.text}`,
      activityType: 'analysis.file_read'
    }
  }

  const page = await attachmentStore.readRange({
    conversationId: conv.id,
    attachmentId,
    startLine,
    endLine
  })
  if (!page.exists) {
    return {
      tool: call.tool,
      ok: false,
      summary: `Attachment missing on disk: ${attachment.name}`,
      output: `Attachment "${attachment.name}" (${attachmentId}) is missing or unreadable on disk.`,
      activityType: 'analysis.file_read'
    }
  }
  const recorded = budget.recordText(
    `att:${attachmentId}:${page.startLine}-${page.endLine}`,
    page.content
  )
  return {
    tool: call.tool,
    ok: true,
    summary: `Read ${attachment.name}:${page.startLine}-${page.endLine} of ${page.totalLines}`,
    output: `Attachment "${attachment.name}" (${attachmentId}) lines ${page.startLine}-${page.endLine} of ${page.totalLines} (${formatSmartAttachmentSize(page.sizeBytes)}${page.hasMore ? ', more lines available' : ''}):\n${recorded.text}`,
    activityType: 'analysis.file_read'
  }
}
