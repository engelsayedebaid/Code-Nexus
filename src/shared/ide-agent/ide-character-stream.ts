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
}

export function applySearchReplacePatches(
  beforeContent: string,
  patches: readonly SearchReplacePatch[]
): { ok: true; content: string } | { ok: false; reason: string } {
  let current = beforeContent
  const useCrLf = current.includes('\r\n')
  for (const patch of patches) {
    if (!patch.search) {
      return { ok: false, reason: 'Patch search block cannot be empty.' }
    }
    const normalizedSearch = useCrLf
      ? patch.search.replace(/\r?\n/g, '\r\n')
      : patch.search.replace(/\r\n/g, '\n')
    const normalizedReplace = useCrLf
      ? patch.replace.replace(/\r?\n/g, '\r\n')
      : patch.replace.replace(/\r\n/g, '\n')
    const idx = current.indexOf(normalizedSearch)
    if (idx === -1) {
      return {
        ok: false,
        reason: `Could not locate target search block starting with "${patch.search.slice(0, 48).trim()}".`
      }
    }
    current =
      current.slice(0, idx) + normalizedReplace + current.slice(idx + normalizedSearch.length)
  }
  return { ok: true, content: current }
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
