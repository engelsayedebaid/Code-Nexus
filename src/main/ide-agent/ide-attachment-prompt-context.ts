import type { IdeChatAttachment, IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import {
  countTextLines,
  formatSmartAttachmentSize
} from '../../shared/smart-paste/smart-paste-config'
import type { ActiveRunControl, EngineHostOps } from './ide-agent-runtime-types'
import type { IdeAttachmentStore } from './ide-attachment-store'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

const IDE_INLINE_ATTACHMENT_CHAR_BUDGET = 48 * 1024
const MIN_IDE_ATTACHMENT_EXCERPT_CHARS = 4096

function fenceForContent(text: string): string {
  let maxRun = 0
  let current = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 96) {
      current += 1
      if (current > maxRun) {
        maxRun = current
      }
    } else {
      current = 0
    }
  }
  return '`'.repeat(Math.max(3, maxRun + 1))
}

function sliceCharsByLines(
  text: string,
  maxChars: number
): { excerpt: string; includedLines: number; totalLines: number; truncated: boolean } {
  const totalLines = countTextLines(text)
  if (text.length <= maxChars) {
    return { excerpt: text, includedLines: totalLines, totalLines, truncated: false }
  }
  const lines = text.split(/\r\n|\n|\r/)
  const kept: string[] = []
  let chars = 0
  for (const line of lines) {
    const sepLen = kept.length > 0 ? 1 : 0
    if (chars + sepLen + line.length > maxChars) {
      break
    }
    kept.push(line)
    chars += sepLen + line.length
  }
  if (kept.length > 0) {
    return { excerpt: kept.join('\n'), includedLines: kept.length, totalLines, truncated: true }
  }
  return {
    excerpt: text.slice(0, maxChars),
    includedLines: 1,
    totalLines,
    truncated: true
  }
}

function markConversationAttachmentMeta(
  conv: IdeConversation,
  attachmentId: string,
  patch: Partial<IdeChatAttachment>
): void {
  for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
    const msg = conv.messages[i]
    if (!msg.attachments) {
      continue
    }
    const target = msg.attachments.find((item) => item.id === attachmentId)
    if (target) {
      Object.assign(target, patch)
      return
    }
  }
}

export async function hydratePastedTextAttachments(params: {
  conv: IdeConversation
  attachments: readonly IdeChatAttachment[]
  attachmentStore?: IdeAttachmentStore | null
  maxTotalChars?: number
  onUpdated?: () => void
}): Promise<IdeChatAttachment[]> {
  const maxTotal = params.maxTotalChars ?? IDE_INLINE_ATTACHMENT_CHAR_BUDGET
  let remainingChars = maxTotal
  const result: IdeChatAttachment[] = []

  for (const att of params.attachments) {
    if (att.kind !== 'pasted_text') {
      result.push(att)
      continue
    }
    if (!params.attachmentStore) {
      markConversationAttachmentMeta(params.conv, att.id, { status: 'missing' })
      params.onUpdated?.()
      throw new Error(
        `Attached pasted content "${att.name}" is unavailable (storage uninitialized).`
      )
    }
    const loaded = await params.attachmentStore.readFullText(params.conv.id, att.id)
    if (!loaded.exists) {
      markConversationAttachmentMeta(params.conv, att.id, { status: 'missing' })
      params.onUpdated?.()
      throw new Error(
        `Attached pasted content "${att.name}" (${att.id}) is missing or no longer available on disk.`
      )
    }

    const allowance = Math.max(MIN_IDE_ATTACHMENT_EXCERPT_CHARS, remainingChars)
    const slice = sliceCharsByLines(loaded.content, allowance)
    remainingChars = Math.max(0, remainingChars - slice.excerpt.length)

    markConversationAttachmentMeta(params.conv, att.id, {
      status: 'ready',
      sizeBytes: loaded.sizeBytes,
      lineCount: loaded.lineCount,
      charCount: loaded.charCount,
      truncatedInPrompt: slice.truncated
    })

    result.push({
      ...att,
      status: 'ready',
      sizeBytes: loaded.sizeBytes,
      lineCount: loaded.lineCount,
      charCount: loaded.charCount,
      truncatedInPrompt: slice.truncated,
      previewText: slice.excerpt,
      lineRange: slice.truncated
        ? { start: 1, end: Math.max(1, slice.includedLines) }
        : { start: 1, end: Math.max(1, loaded.lineCount) }
    })
  }

  if (result.some((att) => att.kind === 'pasted_text')) {
    params.onUpdated?.()
  }
  return result
}

export function formatIdeAttachmentPromptBlock(att: IdeChatAttachment): string {
  if (att.kind === 'image') {
    return `Attached image: ${att.name} (${att.mimeType ?? 'image'})`
  }
  if (att.kind === 'pasted_text') {
    const sizeText =
      att.sizeBytes !== undefined ? formatSmartAttachmentSize(att.sizeBytes) : 'unknown size'
    const lineCount = att.lineCount ?? 0
    const meta = `id=${att.id}, ${sizeText}, ${lineCount} lines${att.format ? `, format=${att.format}` : ''}`
    if (att.status === 'missing') {
      return `Attached pasted text [${att.name}] (${meta}) — [UNAVAILABLE ON DISK: file missing]`
    }
    const body = att.previewText ?? ''
    const fence = fenceForContent(body)
    const langTag = att.format && att.format !== 'code' ? att.format : ''
    if (att.truncatedInPrompt && att.lineRange) {
      return (
        `Attached pasted text [${att.name}] (${meta}) — [PARTIAL EXCERPT: lines ${att.lineRange.start}–${att.lineRange.end} of ${lineCount} shown due to prompt context budget; use read_attachment_range or search_attachment_content with attachmentId="${att.id}" to inspect remaining lines without guessing]:\n` +
        `${fence}${langTag}\n${body}\n${fence}`
      )
    }
    return `Attached pasted text [${att.name}] (${meta}):\n${fence}${langTag}\n${body}\n${fence}`
  }
  const rangeTag = att.lineRange ? `:${att.lineRange.start}-${att.lineRange.end}` : ''
  const header =
    att.kind === 'selection'
      ? `Selected code (${att.relativePath ?? att.name}${rangeTag})`
      : att.kind === 'folder'
        ? `Mentioned folder (${att.relativePath ?? att.name})`
        : att.kind === 'symbol'
          ? `Mentioned symbol (${att.symbolName ?? att.name} in ${att.relativePath ?? ''}${rangeTag})`
          : `Attached context (${att.relativePath ?? att.name}${rangeTag})`
  return att.previewText !== undefined
    ? `${header}:\n\`\`\`\n${att.previewText.slice(0, 14_000)}\n\`\`\``
    : header
}

export async function filterAndHydrateAttachments(
  host: EngineHostOps,
  conv: IdeConversation,
  run: ActiveRunControl,
  gateway: IdeWorkspaceGateway,
  attachments: readonly IdeChatAttachment[]
): Promise<IdeChatAttachment[]> {
  const out: IdeChatAttachment[] = []
  for (const att of attachments) {
    if (att.kind === 'pasted_text') {
      out.push(att)
      continue
    }
    const targetPath = att.relativePath ?? att.name
    const isSecret =
      att.sensitiveWarning ||
      classifySensitiveFilePath(targetPath, 'read-context') === 'send_secret_context'
    if (isSecret) {
      const allowed = await host.requestExplicitPermission(conv, run, {
        kind: 'send_secret_context',
        title: `Allow sending secret/credential context (${targetPath})?`,
        detail: `"${targetPath}" looks like a secrets/credentials file. Only include its contents if you trust the provider and approve.`,
        targetPath
      })
      out.push(
        allowed
          ? att
          : { ...att, previewText: '[REDACTED: user denied sending secret file contents]' }
      )
      continue
    }
    if (att.kind === 'folder' && att.relativePath && !att.previewText && gateway.searchFiles) {
      const prefix = normalizeWorkspaceRelativePath(att.relativePath).replace(/\/+$/, '')
      const hits = (await gateway.searchFiles(prefix, 60)).filter(
        (p) => p === prefix || p.startsWith(`${prefix}/`)
      )
      out.push({
        ...att,
        previewText: hits.length > 0 ? `Folder files:\n${hits.join('\n')}` : '(empty folder)'
      })
      continue
    }
    out.push(att)
  }
  return hydratePastedTextAttachments({
    conv,
    attachments: out,
    attachmentStore: host.attachmentStore,
    onUpdated: () => host.saveAndPublish(conv)
  })
}
