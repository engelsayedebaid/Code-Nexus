export type UnifiedDiffApplyResult =
  | { ok: true; content: string; hunksApplied: number }
  | { ok: false; reason: string }

type ParsedHunk = {
  oldStart: number
  lines: { prefix: ' ' | '-' | '+'; text: string }[]
}

export function preserveTextLineEndingsAndBom(
  beforeContent: string | null | undefined,
  nextContent: string
): string {
  if (!beforeContent) {
    return nextContent
  }
  const hasBom = beforeContent.charCodeAt(0) === 0xfeff
  const strippedBefore = hasBom ? beforeContent.slice(1) : beforeContent
  const strippedNext = nextContent.charCodeAt(0) === 0xfeff ? nextContent.slice(1) : nextContent
  const crlfCount = (strippedBefore.match(/\r\n/g) ?? []).length
  const lfOnlyCount = (strippedBefore.replaceAll('\r\n', '').match(/\n/g) ?? []).length
  const preferCrlf = crlfCount > 0 && crlfCount >= lfOnlyCount
  const normalizedLines = preferCrlf
    ? strippedNext.replace(/\r?\n/g, '\r\n')
    : strippedNext.replaceAll('\r\n', '\n')
  return hasBom ? `\ufeff${normalizedLines}` : normalizedLines
}

function parseUnifiedDiffHunks(diffText: string): ParsedHunk[] {
  const rawLines = diffText.replaceAll('\r\n', '\n').split('\n')
  const hunks: ParsedHunk[] = []
  let current: ParsedHunk | null = null

  for (const line of rawLines) {
    const header = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
    if (header) {
      current = { oldStart: Math.max(1, Number.parseInt(header[1], 10)), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) {
      continue
    }
    if (line.startsWith('\\ No newline at end of file')) {
      continue
    }
    const prefix = line[0]
    if (prefix === ' ' || prefix === '-' || prefix === '+') {
      current.lines.push({ prefix, text: line.slice(1) })
    } else if (line === '') {
      current.lines.push({ prefix: ' ', text: '' })
    }
  }
  return hunks
}

function matchBlockAt(
  sourceLines: readonly string[],
  startIdx: number,
  expected: readonly string[],
  trimWhitespace: boolean
): boolean {
  if (startIdx < 0 || startIdx + expected.length > sourceLines.length) {
    return false
  }
  for (let i = 0; i < expected.length; i += 1) {
    const left = trimWhitespace ? sourceLines[startIdx + i].trim() : sourceLines[startIdx + i]
    const right = trimWhitespace ? expected[i].trim() : expected[i]
    if (left !== right) {
      return false
    }
  }
  return true
}

function locateHunkIndex(
  sourceLines: readonly string[],
  expected: readonly string[],
  preferredIdx: number
): number {
  if (expected.length === 0) {
    return Math.min(Math.max(0, preferredIdx), sourceLines.length)
  }
  for (const trimWhitespace of [false, true]) {
    if (matchBlockAt(sourceLines, preferredIdx, expected, trimWhitespace)) {
      return preferredIdx
    }
    for (let offset = 1; offset <= 30; offset += 1) {
      if (matchBlockAt(sourceLines, preferredIdx - offset, expected, trimWhitespace)) {
        return preferredIdx - offset
      }
      if (matchBlockAt(sourceLines, preferredIdx + offset, expected, trimWhitespace)) {
        return preferredIdx + offset
      }
    }
    const matches: number[] = []
    for (let idx = 0; idx <= sourceLines.length - expected.length; idx += 1) {
      if (matchBlockAt(sourceLines, idx, expected, trimWhitespace)) {
        matches.push(idx)
      }
    }
    if (matches.length === 1) {
      return matches[0]
    }
  }
  return -1
}

export function applyUnifiedDiffPatch(
  beforeContent: string,
  unifiedDiff: string
): UnifiedDiffApplyResult {
  const hunks = parseUnifiedDiffHunks(unifiedDiff)
  if (hunks.length === 0) {
    return { ok: false, reason: 'Unified diff contains no valid @@ hunks.' }
  }

  const hasBom = beforeContent.charCodeAt(0) === 0xfeff
  const cleanBefore = hasBom ? beforeContent.slice(1) : beforeContent
  const hadTrailingNewline = cleanBefore.endsWith('\n')
  const workingLines = cleanBefore.replaceAll('\r\n', '\n').split('\n')
  if (hadTrailingNewline && workingLines.at(-1) === '') {
    workingLines.pop()
  }

  let lineDelta = 0
  for (let h = 0; h < hunks.length; h += 1) {
    const hunk = hunks[h]
    let endIdx = hunk.lines.length
    while (
      endIdx > 0 &&
      hunk.lines[endIdx - 1].prefix === ' ' &&
      hunk.lines[endIdx - 1].text === ''
    ) {
      const candidateExpected = hunk.lines
        .slice(0, endIdx)
        .filter((l) => l.prefix !== '+')
        .map((l) => l.text)
      if (locateHunkIndex(workingLines, candidateExpected, hunk.oldStart - 1 + lineDelta) !== -1) {
        break
      }
      endIdx -= 1
    }
    const effectiveLines = hunk.lines.slice(0, endIdx)
    const expectedOld = effectiveLines.filter((l) => l.prefix !== '+').map((l) => l.text)
    const replacementNew = effectiveLines.filter((l) => l.prefix !== '-').map((l) => l.text)
    const targetIdx = locateHunkIndex(workingLines, expectedOld, hunk.oldStart - 1 + lineDelta)
    if (targetIdx === -1) {
      const preview = expectedOld.find((l) => l.trim().length > 0) ?? `hunk #${h + 1}`
      return {
        ok: false,
        reason: `Unified diff hunk #${h + 1} failed to match context near "${preview.slice(0, 60).trim()}".`
      }
    }
    workingLines.splice(targetIdx, expectedOld.length, ...replacementNew)
    lineDelta += replacementNew.length - expectedOld.length
  }

  const joined = `${workingLines.join('\n')}${hadTrailingNewline ? '\n' : ''}`
  return {
    ok: true,
    content: preserveTextLineEndingsAndBom(beforeContent, joined),
    hunksApplied: hunks.length
  }
}
