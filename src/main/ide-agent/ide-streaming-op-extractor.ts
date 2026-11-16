import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'

export type StreamedOperationSnapshot = {
  path: string
  action: 'create' | 'modify'
  content: string
  startLine: number
  endLine: number
}

function decodeJsonStringPrefix(
  raw: string,
  contentValueStartQuoteIdx: number
): { value: string; complete: boolean } {
  let out = ''
  let i = contentValueStartQuoteIdx + 1
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '"') {
      return { value: out, complete: true }
    }
    if (ch === '\\') {
      if (i + 1 >= raw.length) {
        break
      }
      const esc = raw[i + 1]
      switch (esc) {
        case '"':
          out += '"'
          i += 2
          continue
        case '\\':
          out += '\\'
          i += 2
          continue
        case '/':
          out += '/'
          i += 2
          continue
        case 'b':
          out += '\b'
          i += 2
          continue
        case 'f':
          out += '\f'
          i += 2
          continue
        case 'n':
          out += '\n'
          i += 2
          continue
        case 'r':
          out += '\r'
          i += 2
          continue
        case 't':
          out += '\t'
          i += 2
          continue
        case 'u': {
          if (i + 5 >= raw.length) {
            return { value: out, complete: false }
          }
          const hex = raw.slice(i + 2, i + 6)
          const code = Number.parseInt(hex, 16)
          if (Number.isFinite(code)) {
            out += String.fromCharCode(code)
            i += 6
            continue
          }
          out += esc
          i += 2
          continue
        }
        default:
          out += esc
          i += 2
          continue
      }
    }
    out += ch
    i += 1
  }
  return { value: out, complete: false }
}

/**
 * Extracts real incremental `"content"` characters as a model streams JSON operations,
 * without ever fabricating characters the model has not emitted.
 */
export class StreamingOperationContentExtractor {
  private buffer = ''
  private lastPath = ''
  private lastLength = 0

  appendDelta(delta: string): StreamedOperationSnapshot | null {
    this.buffer += delta
    const opsIdx = this.buffer.lastIndexOf('"operations"')
    const windowText = opsIdx !== -1 ? this.buffer.slice(opsIdx) : this.buffer

    const pathMatches = Array.from(windowText.matchAll(/"path"\s*:\s*"([^"\r\n]+)"/g))
    const latestPathMatch = pathMatches.at(-1)
    if (!latestPathMatch || latestPathMatch.index === undefined) {
      return null
    }
    const rawPath = latestPathMatch[1]
    const cleanPath = normalizeWorkspaceRelativePath(rawPath)
    if (!cleanPath || cleanPath.includes('..')) {
      return null
    }

    const tailAfterPath = windowText.slice(latestPathMatch.index)
    const contentKeyMatch = tailAfterPath.match(/"content"\s*:\s*"/)
    if (!contentKeyMatch || contentKeyMatch.index === undefined) {
      return null
    }
    const actionMatch = tailAfterPath.match(/"action"\s*:\s*"(create|modify)"/)
    const action = actionMatch?.[1] === 'create' ? 'create' : 'modify'
    const quoteIdx = contentKeyMatch.index + contentKeyMatch[0].length - 1
    const decoded = decodeJsonStringPrefix(tailAfterPath, quoteIdx)
    if (!decoded.value) {
      return null
    }

    if (cleanPath === this.lastPath && decoded.value.length <= this.lastLength) {
      return null
    }
    this.lastPath = cleanPath
    this.lastLength = decoded.value.length
    const lines = Math.max(1, decoded.value.split('\n').length)
    return {
      path: cleanPath,
      action,
      content: decoded.value,
      startLine: Math.max(1, lines - 3),
      endLine: lines
    }
  }
}
