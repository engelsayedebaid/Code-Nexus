import { openAuthorizedDocPreviewTarget } from '../../../shared/document-preview/doc-preview-file-access'
import { isNativeChatPastedTextPath } from '../../../shared/native-chat/native-chat-image-label'
import { nativeChatTextAttachmentParts } from '../../../shared/native-chat-text-attachment-references'
import type { AgentJournalMessageItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { isInternalAttachmentDisplayCandidate } from '../../../shared/smart-paste/native-chat-attachment-metadata'
import {
  SMART_PASTE_CONFIG,
  countTextLines,
  detectPastedTextFormat,
  formatSmartAttachmentSize
} from '../../../shared/smart-paste/smart-paste-config'
import { sliceAtCodeUnitLimit } from '../../../shared/surrogate-safe-text-slice'
import { parseAgentSessionAttachmentStorePath } from './agent-session-attachment-references'
import { getAgentSessionAttachmentStore } from './agent-session-attachment-store-registry'

const DEFAULT_INLINE_PROMPT_BUDGET_BYTES = 48 * 1024
const MIN_EXCERPT_BYTES = 1024

export type PastedTextDispatchMode = 'inline' | 'verify-path'

export type ResolvePastedTextDispatchOptions = {
  mode: PastedTextDispatchMode
  storeRoot?: string | null
  inlineBudgetBytes?: number
  signal?: AbortSignal
}

function longestBacktickRun(text: string): number {
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
  return maxRun
}

function sliceUtf8PrefixByLines(
  text: string,
  maxBytes: number
): { excerpt: string; includedLines: number; totalLines: number; truncated: boolean } {
  const totalLines = countTextLines(text)
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { excerpt: text, includedLines: totalLines, totalLines, truncated: false }
  }
  const lines = text.split(/\r\n|\n|\r/)
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    const separatorBytes = kept.length > 0 ? 1 : 0
    const nextBytes = Buffer.byteLength(line, 'utf8') + separatorBytes
    if (bytes + nextBytes > maxBytes) {
      break
    }
    kept.push(line)
    bytes += nextBytes
  }
  if (kept.length > 0) {
    return {
      excerpt: kept.join('\n'),
      includedLines: kept.length,
      totalLines,
      truncated: true
    }
  }
  // Single very long line without newlines: trim safely on UTF-16 code units.
  let limit = Math.min(text.length, maxBytes)
  let sliced = sliceAtCodeUnitLimit(text, limit)
  while (limit > 0 && Buffer.byteLength(sliced, 'utf8') > maxBytes) {
    limit = Math.floor(limit * 0.75)
    sliced = sliceAtCodeUnitLimit(text, limit)
  }
  return {
    excerpt: sliced,
    includedLines: sliced.length > 0 ? 1 : 0,
    totalLines,
    truncated: true
  }
}

async function readStorePastedTextFile(
  storeRoot: string,
  filePath: string,
  signal?: AbortSignal
): Promise<{ content: string; sizeBytes: number }> {
  signal?.throwIfAborted()
  if (
    filePath.split(/[\\/]/).includes('..') ||
    !parseAgentSessionAttachmentStorePath(storeRoot, filePath)
  ) {
    throw new Error('Refused pasted text attachment outside active attachment store.')
  }
  let opened: Awaited<ReturnType<typeof openAuthorizedDocPreviewTarget>>
  try {
    opened = await openAuthorizedDocPreviewTarget({
      boundaryPath: storeRoot,
      entryPath: filePath,
      targetPath: filePath,
      implicitRootPath: null,
      authorizedRootPaths: []
    })
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error('Pasted text attachment is missing or no longer available on disk.')
    }
    throw error
  }
  const { handle, stats } = opened
  try {
    signal?.throwIfAborted()
    if (stats.size > SMART_PASTE_CONFIG.maxAttachmentBytes) {
      throw new Error('Pasted text attachment exceeds maximum supported size.')
    }
    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < stats.size) {
      signal?.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, offset, stats.size - offset, offset)
      if (bytesRead <= 0) {
        break
      }
      offset += bytesRead
    }
    return { content: buffer.subarray(0, offset).toString('utf8'), sizeBytes: stats.size }
  } finally {
    await handle.close()
  }
}

async function verifyStorePastedTextFile(
  storeRoot: string,
  filePath: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  if (
    filePath.split(/[\\/]/).includes('..') ||
    !parseAgentSessionAttachmentStorePath(storeRoot, filePath)
  ) {
    throw new Error('Refused pasted text attachment outside active attachment store.')
  }
  try {
    const { handle } = await openAuthorizedDocPreviewTarget({
      boundaryPath: storeRoot,
      entryPath: filePath,
      targetPath: filePath,
      implicitRootPath: null,
      authorizedRootPaths: []
    })
    await handle.close()
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error('Pasted text attachment is missing or no longer available on disk.')
    }
    throw error
  }
}

function isDispatchablePastedStorePath(storeRoot: string, candidate: string): boolean {
  if (!isNativeChatPastedTextPath(candidate) || !isInternalAttachmentDisplayCandidate(candidate)) {
    return false
  }
  if (parseAgentSessionAttachmentStorePath(storeRoot, candidate)) {
    return true
  }
  // Reject traversal attempts specifically targeting the active store directory.
  const normRoot = storeRoot.replace(/\\/g, '/').toLowerCase()
  const normCandidate = candidate.replace(/\\/g, '/').toLowerCase()
  return normCandidate.startsWith(`${normRoot}/`) && candidate.split(/[\\/]/).includes('..')
}

export function hasStorePastedTextReference(
  body: Pick<AgentJournalMessageItem, 'blocks'>,
  storeRoot: string | null = getAgentSessionAttachmentStore()?.rootDir ?? null
): boolean {
  if (!storeRoot) {
    return false
  }
  for (const block of body.blocks) {
    if (block.type !== 'text') {
      continue
    }
    const parts = nativeChatTextAttachmentParts(block.text, true, (candidate) =>
      isDispatchablePastedStorePath(storeRoot, candidate)
    )
    if (parts.some((part) => part.path)) {
      return true
    }
  }
  return false
}

export async function resolvePastedTextReferencesInString(
  text: string,
  options: ResolvePastedTextDispatchOptions
): Promise<{ text: string; remainingBudgetBytes: number }> {
  const storeRoot = options.storeRoot ?? getAgentSessionAttachmentStore()?.rootDir ?? null
  const totalBudget = options.inlineBudgetBytes ?? DEFAULT_INLINE_PROMPT_BUDGET_BYTES
  let remainingBudget = totalBudget
  if (!storeRoot) {
    return { text, remainingBudgetBytes: remainingBudget }
  }
  const parts = nativeChatTextAttachmentParts(text, true, (candidate) =>
    isDispatchablePastedStorePath(storeRoot, candidate)
  )
  if (!parts.some((part) => part.path)) {
    return { text, remainingBudgetBytes: remainingBudget }
  }
  const chunks: string[] = []
  for (const part of parts) {
    if (!part.path) {
      chunks.push(part.text)
      continue
    }
    if (options.mode === 'verify-path') {
      await verifyStorePastedTextFile(storeRoot, part.path, options.signal)
      chunks.push(part.text)
      continue
    }
    const { content, sizeBytes } = await readStorePastedTextFile(
      storeRoot,
      part.path,
      options.signal
    )
    const sizeLabel = formatSmartAttachmentSize(sizeBytes)
    const { format } = detectPastedTextFormat(content)
    const langTag = format === 'code' ? '' : format
    const slice = sliceUtf8PrefixByLines(content, Math.max(MIN_EXCERPT_BYTES, remainingBudget))
    remainingBudget = Math.max(0, remainingBudget - Buffer.byteLength(slice.excerpt, 'utf8'))
    const fence = '`'.repeat(Math.max(3, longestBacktickRun(slice.excerpt) + 1))
    const header = slice.truncated
      ? `[Pasted text (${sizeLabel}, ${slice.totalLines} lines) — Showing lines 1–${slice.includedLines} of ${slice.totalLines}; remaining ${slice.totalLines - slice.includedLines} lines omitted by ${formatSmartAttachmentSize(totalBudget)} prompt budget]`
      : `[Pasted text (${sizeLabel}, ${slice.totalLines} lines)]`
    chunks.push(`\n${header}\n${fence}${langTag}\n${slice.excerpt}\n${fence}\n`)
  }
  return {
    text: chunks.join('').replace(/^\n/, '').trimEnd(),
    remainingBudgetBytes: remainingBudget
  }
}

export async function resolveAgentSessionBodyPastedText(
  body: AgentJournalMessageItem,
  options: ResolvePastedTextDispatchOptions
): Promise<AgentJournalMessageItem> {
  const storeRoot = options.storeRoot ?? getAgentSessionAttachmentStore()?.rootDir ?? null
  if (!storeRoot || !hasStorePastedTextReference(body, storeRoot)) {
    return body
  }
  let remainingBudget = options.inlineBudgetBytes ?? DEFAULT_INLINE_PROMPT_BUDGET_BYTES
  const nextBlocks: AgentJournalMessageItem['blocks'] = []
  for (const block of body.blocks) {
    if (block.type !== 'text') {
      nextBlocks.push(block)
      continue
    }
    const resolved = await resolvePastedTextReferencesInString(block.text, {
      ...options,
      storeRoot,
      inlineBudgetBytes: remainingBudget
    })
    remainingBudget = resolved.remainingBudgetBytes
    nextBlocks.push({ ...block, text: resolved.text })
  }
  return { ...body, blocks: nextBlocks }
}
