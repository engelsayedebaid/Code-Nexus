import { sliceAtCodeUnitLimit } from '../../shared/surrogate-safe-text-slice'

export type IdeAttachmentContentPage = {
  exists: boolean
  attachmentId: string
  content: string
  startLine: number
  endLine: number
  totalLines: number
  sizeBytes: number
  charCount: number
  hasMore: boolean
}

export type IdeAttachmentSearchHit = {
  line: number
  preview: string
}

const DEFAULT_READ_MAX_CHARS = 256 * 1024

export function sliceAttachmentContentPage(params: {
  attachmentId: string
  fullContent: string
  sizeBytes: number
  charCount: number
  startLine?: number
  endLine?: number
  maxChars?: number
}): IdeAttachmentContentPage {
  const lines = params.fullContent.split(/\r\n|\n|\r/)
  const totalLines = lines.length
  const startLine = Math.max(1, Math.min(params.startLine ?? 1, Math.max(1, totalLines)))
  const requestedEnd =
    params.endLine !== undefined
      ? Math.min(totalLines, Math.max(startLine, params.endLine))
      : totalLines
  const maxChars = Math.max(256, Math.min(params.maxChars ?? DEFAULT_READ_MAX_CHARS, 512 * 1024))
  const selected: string[] = []
  let chars = 0
  let actualEnd = startLine - 1
  let clippedMidStream = false

  for (let idx = startLine - 1; idx < requestedEnd; idx += 1) {
    const line = lines[idx] ?? ''
    const sepLen = selected.length > 0 ? 1 : 0
    if (selected.length > 0 && chars + sepLen + line.length > maxChars) {
      clippedMidStream = true
      break
    }
    if (selected.length === 0 && line.length > maxChars) {
      selected.push(sliceAtCodeUnitLimit(line, maxChars))
      actualEnd = idx + 1
      clippedMidStream = line.length > maxChars || idx + 1 < totalLines
      break
    }
    selected.push(line)
    chars += sepLen + line.length
    actualEnd = idx + 1
  }

  return {
    exists: true,
    attachmentId: params.attachmentId,
    content: selected.join('\n'),
    startLine,
    endLine: actualEnd,
    totalLines,
    sizeBytes: params.sizeBytes,
    charCount: params.charCount,
    hasMore: clippedMidStream || actualEnd < totalLines
  }
}

export function searchAttachmentLines(params: {
  fullContent: string
  lineCount: number
  query: string
  maxMatches?: number
}): { exists: true; hits: IdeAttachmentSearchHit[]; totalLines: number } {
  const needle = params.query.trim().toLowerCase()
  if (!needle) {
    return { exists: true, hits: [], totalLines: params.lineCount }
  }
  const lines = params.fullContent.split(/\r\n|\n|\r/)
  const limit = Math.max(1, Math.min(params.maxMatches ?? 30, 100))
  const hits: IdeAttachmentSearchHit[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.toLowerCase().includes(needle)) {
      hits.push({ line: i + 1, preview: sliceAtCodeUnitLimit(line.trimEnd(), 240) })
      if (hits.length >= limit) {
        break
      }
    }
  }
  return { exists: true, hits, totalLines: lines.length }
}
