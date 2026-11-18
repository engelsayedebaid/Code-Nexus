import { preserveTextLineEndingsAndBom } from './ide-unified-diff'

export { preserveTextLineEndingsAndBom }

export type CharacterStreamFrame = {
  text: string
  revealedChars: number
  totalInsertedChars: number
  startLine: number
  endLine: number
  cursorLine: number
  cursorColumn: number
  progressPercent: number
}

export type SearchReplacePatch = {
  search: string
  replace: string
  replaceAll?: boolean
}

function measureLeadingSpaces(line: string): number {
  let count = 0
  while (count < line.length && (line[count] === ' ' || line[count] === '\t')) {
    count += 1
  }
  return count
}

function applyTrimmedUniqueBlockPatch(
  source: string,
  search: string,
  replace: string,
  lineEnding: '\r\n' | '\n'
): { ok: true; content: string } | { ok: false; ambiguous: boolean } {
  const sourceLines = source.split(/\r?\n/)
  const searchLines = search.split(/\r?\n/)
  if (searchLines.length === 0) {
    return { ok: false, ambiguous: false }
  }
  const matches: number[] = []
  for (let i = 0; i <= sourceLines.length - searchLines.length; i += 1) {
    let allEqual = true
    for (let j = 0; j < searchLines.length; j += 1) {
      if (sourceLines[i + j].trim() !== searchLines[j].trim()) {
        allEqual = false
        break
      }
    }
    if (allEqual) {
      matches.push(i)
    }
  }
  if (matches.length !== 1) {
    return { ok: false, ambiguous: matches.length > 1 }
  }
  const matchIdx = matches[0]
  const fileFirstNonEmpty = sourceLines
    .slice(matchIdx, matchIdx + searchLines.length)
    .find((l) => l.trim().length > 0)
  const searchFirstNonEmpty = searchLines.find((l) => l.trim().length > 0)
  const indentShift =
    fileFirstNonEmpty && searchFirstNonEmpty && !fileFirstNonEmpty.startsWith('\t')
      ? measureLeadingSpaces(fileFirstNonEmpty) - measureLeadingSpaces(searchFirstNonEmpty)
      : 0

  const replaceLines = replace.split(/\r?\n/).map((line) => {
    if (!line.trim() || indentShift === 0 || line.startsWith('\t')) {
      return line
    }
    if (indentShift > 0) {
      return `${' '.repeat(indentShift)}${line}`
    }
    const removable = Math.min(-indentShift, measureLeadingSpaces(line))
    return line.slice(removable)
  })

  const nextLines = [
    ...sourceLines.slice(0, matchIdx),
    ...replaceLines,
    ...sourceLines.slice(matchIdx + searchLines.length)
  ]
  return { ok: true, content: nextLines.join(lineEnding) }
}

export function applySearchReplacePatches(
  beforeContent: string,
  patches: readonly SearchReplacePatch[]
): { ok: true; content: string } | { ok: false; reason: string } {
  let current = beforeContent
  const lineEnding: '\r\n' | '\n' = current.includes('\r\n') ? '\r\n' : '\n'
  for (const patch of patches) {
    if (!patch.search) {
      return { ok: false, reason: 'Patch search block cannot be empty.' }
    }
    const normalizedSearch =
      lineEnding === '\r\n'
        ? patch.search.replace(/\r?\n/g, '\r\n')
        : patch.search.replaceAll('\r\n', '\n')
    const normalizedReplace =
      lineEnding === '\r\n'
        ? patch.replace.replace(/\r?\n/g, '\r\n')
        : patch.replace.replaceAll('\r\n', '\n')

    const firstIdx = current.indexOf(normalizedSearch)
    if (firstIdx !== -1) {
      if (patch.replaceAll) {
        current = current.replaceAll(normalizedSearch, normalizedReplace)
        continue
      }
      const secondIdx = current.indexOf(normalizedSearch, firstIdx + normalizedSearch.length)
      if (secondIdx !== -1) {
        return {
          ok: false,
          reason: `Ambiguous patch search block matched multiple locations starting with "${patch.search.slice(0, 48).trim()}". Include surrounding context lines to make it unique.`
        }
      }
      current =
        current.slice(0, firstIdx) +
        normalizedReplace +
        current.slice(firstIdx + normalizedSearch.length)
      continue
    }

    const trimmedAttempt = applyTrimmedUniqueBlockPatch(
      current,
      normalizedSearch,
      normalizedReplace,
      lineEnding
    )
    if (trimmedAttempt.ok) {
      current = trimmedAttempt.content
      continue
    }
    if (trimmedAttempt.ambiguous) {
      return {
        ok: false,
        reason: `Ambiguous patch search block matched multiple locations starting with "${patch.search.slice(0, 48).trim()}". Include surrounding context lines.`
      }
    }
    return {
      ok: false,
      reason: `Could not locate target search block starting with "${patch.search.slice(0, 48).trim()}". Read the latest file lines before retrying.`
    }
  }
  return { ok: true, content: preserveTextLineEndingsAndBom(beforeContent, current) }
}

/**
 * Computes character-level progressive frames between `beforeContent` and `afterContent`.
 * Every frame is derived strictly from the real target text (never fabricated tokens).
 */
export function computeCharacterStreamSteps(params: {
  beforeContent: string | null
  afterContent: string
  charsPerFrame?: number
  maxFrames?: number
}): CharacterStreamFrame[] {
  const before = params.beforeContent ?? ''
  const after = params.afterContent
  if (before === after) {
    return []
  }

  let prefixLen = 0
  const minLen = Math.min(before.length, after.length)
  while (prefixLen < minLen && before.charCodeAt(prefixLen) === after.charCodeAt(prefixLen)) {
    prefixLen++
  }

  let suffixLen = 0
  while (
    suffixLen < before.length - prefixLen &&
    suffixLen < after.length - prefixLen &&
    before.charCodeAt(before.length - 1 - suffixLen) ===
      after.charCodeAt(after.length - 1 - suffixLen)
  ) {
    suffixLen++
  }

  const insertedLen = after.length - prefixLen - suffixLen
  const suffixText = suffixLen > 0 ? after.slice(after.length - suffixLen) : ''
  const startLine = countLinesUpTo(after, prefixLen)

  if (insertedLen <= 0) {
    const cursor = computeLineAndColumn(after, prefixLen)
    return [
      {
        text: after,
        revealedChars: 0,
        totalInsertedChars: 0,
        startLine,
        endLine: startLine,
        cursorLine: cursor.line,
        cursorColumn: cursor.column,
        progressPercent: 100
      }
    ]
  }

  const maxFrames = Math.max(4, params.maxFrames ?? 90)
  const baseStep = Math.max(1, params.charsPerFrame ?? 4)
  const stepSize = Math.max(baseStep, Math.ceil(insertedLen / maxFrames))
  const frames: CharacterStreamFrame[] = []

  let revealed = 0
  while (revealed < insertedLen) {
    revealed = Math.min(insertedLen, revealed + stepSize)
    if (revealed < insertedLen && after.charCodeAt(prefixLen + revealed - 1) === 13) {
      revealed = Math.min(insertedLen, revealed + 1)
    }
    const headEnd = prefixLen + revealed
    const text = suffixText ? after.slice(0, headEnd) + suffixText : after.slice(0, headEnd)
    const cursor = computeLineAndColumn(after, headEnd)
    frames.push({
      text,
      revealedChars: revealed,
      totalInsertedChars: insertedLen,
      startLine,
      endLine: Math.max(startLine, cursor.line),
      cursorLine: cursor.line,
      cursorColumn: cursor.column,
      progressPercent: Math.round((revealed / insertedLen) * 100)
    })
  }

  return frames
}

function countLinesUpTo(text: string, index: number): number {
  let line = 1
  const limit = Math.min(text.length, Math.max(0, index))
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
    }
  }
  return line
}

function computeLineAndColumn(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lastNewline = -1
  const limit = Math.min(text.length, Math.max(0, index))
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastNewline = i
    }
  }
  return { line, column: limit - lastNewline }
}
