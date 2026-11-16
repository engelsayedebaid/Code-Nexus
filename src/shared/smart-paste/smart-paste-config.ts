export type PastedContentFormat =
  | 'typescript'
  | 'json'
  | 'sql'
  | 'markdown'
  | 'yaml'
  | 'diff'
  | 'log'
  | 'code'
  | 'text'

export type SmartPasteConfig = {
  /** Paste length in UTF-16 code units at or above which text becomes an attachment. */
  readonly charThreshold: number
  /** Line count at or above which pasted text becomes an attachment. */
  readonly lineThreshold: number
  /** Upper byte cap keeping multi-byte pastes from stalling inline editors. */
  readonly maxInlinePasteBytes: number
  /** Hard safety ceiling per text attachment payload. */
  readonly maxAttachmentBytes: number
  /** Character budget for inline injection at provider/agent execution boundaries. */
  readonly inlineContextBudgetChars: number
}

export const SMART_PASTE_CONFIG: SmartPasteConfig = {
  charThreshold: 2_000,
  lineThreshold: 50,
  maxInlinePasteBytes: 32 * 1024,
  maxAttachmentBytes: 16 * 1024 * 1024,
  inlineContextBudgetChars: 24 * 1024
}

export type SmartPasteClassification = {
  kind: 'short' | 'attachment' | 'too_large'
  charCount: number
  lineCount: number
  sizeBytes: number
  format: PastedContentFormat
  formatLabel: string
}

const textEncoder = new TextEncoder()

export function measureTextUtf8Bytes(text: string): number {
  return textEncoder.encode(text).byteLength
}

export function countTextLines(text: string): number {
  if (text.length === 0) {
    return 0
  }
  let lines = 1
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 10) {
      lines += 1
    } else if (code === 13) {
      lines += 1
      if (text.charCodeAt(i + 1) === 10) {
        i += 1
      }
    }
  }
  return lines
}

export function formatSmartAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : kb.toFixed(1)} KB`
  }
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

export function detectPastedTextFormat(text: string): {
  format: PastedContentFormat
  formatLabel: string
} {
  const sample = text.slice(0, 4096).trim()
  if (!sample) {
    return { format: 'text', formatLabel: 'Text' }
  }
  if (
    (sample.startsWith('{') && sample.includes('":')) ||
    (sample.startsWith('[') && sample.includes('{'))
  ) {
    return { format: 'json', formatLabel: 'JSON' }
  }
  if (/^(?:diff --git|---\s+\S+\s*\n\+\+\+\s+\S+|@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@)/m.test(sample)) {
    return { format: 'diff', formatLabel: 'Diff' }
  }
  if (
    /^\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/im.test(
      sample
    )
  ) {
    return { format: 'sql', formatLabel: 'SQL' }
  }
  if (
    /^(?:import\s+.+from\s+['"]|export\s+(?:default|function|const|class|interface|type)\s|interface\s+\w+\s*\{)/m.test(
      sample
    )
  ) {
    return { format: 'typescript', formatLabel: 'TypeScript' }
  }
  if (/^(?:\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}|Error:\s|\s+at\s+\S+\s*\()/m.test(sample)) {
    return { format: 'log', formatLabel: 'Log' }
  }
  if (/^(?:#{1,6}\s+\S|```)/m.test(sample)) {
    return { format: 'markdown', formatLabel: 'Markdown' }
  }
  if (/^[a-zA-Z0-9_-]+:\s+(?:\S|\n\s+-)/m.test(sample) && !/[;{}]/.test(sample)) {
    return { format: 'yaml', formatLabel: 'YAML' }
  }
  if (
    /[{}();=>]/.test(sample) &&
    /\b(?:function|const|let|var|class|def|fn|return|pub|struct|package)\b/.test(sample)
  ) {
    return { format: 'code', formatLabel: 'Code' }
  }
  return { format: 'text', formatLabel: 'Text' }
}

export function classifySmartPaste(
  text: string,
  overrides?: Partial<SmartPasteConfig>
): SmartPasteClassification {
  const cfg = overrides ? { ...SMART_PASTE_CONFIG, ...overrides } : SMART_PASTE_CONFIG
  const charCount = text.length
  const lineCount = countTextLines(text)
  const sizeBytes = measureTextUtf8Bytes(text)
  const detected = detectPastedTextFormat(text)
  if (sizeBytes > cfg.maxAttachmentBytes) {
    return {
      kind: 'too_large',
      charCount,
      lineCount,
      sizeBytes,
      ...detected
    }
  }
  const shouldAttach =
    charCount >= cfg.charThreshold ||
    lineCount >= cfg.lineThreshold ||
    sizeBytes >= cfg.maxInlinePasteBytes
  return {
    kind: shouldAttach ? 'attachment' : 'short',
    charCount,
    lineCount,
    sizeBytes,
    ...detected
  }
}
