export {
  applySearchReplacePatches,
  computeCharacterStreamSteps,
  preserveTextLineEndingsAndBom,
  type CharacterStreamFrame,
  type SearchReplacePatch
} from './ide-character-stream'
export { applyUnifiedDiffPatch, type UnifiedDiffApplyResult } from './ide-unified-diff'

export type ProgressiveEditChunk = {
  chunkIndex: number
  totalChunks: number
  beforeContent: string | null
  content: string
  startLine: number
  endLine: number
  label: string
}

const DEFAULT_MAX_LINES_PER_CHUNK = 28

function inferSectionLabel(
  lines: readonly string[],
  chunkIndex: number,
  isCreate: boolean
): string {
  const firstMeaningful = lines.find((line) => line.trim().length > 0)?.trim() ?? ''
  if (chunkIndex === 0 && /^(import\b|from\b|#include\b|using\b|package\b)/.test(firstMeaningful)) {
    return isCreate ? 'Writing imports & module header' : 'Updating imports & module header'
  }
  if (/^(export\s+)?(interface|type|enum|class)\b/.test(firstMeaningful)) {
    return isCreate ? 'Defining types & structure' : 'Updating types & structure'
  }
  if (
    /^(export\s+)?(async\s+)?function\b|^(const|let)\s+\w+\s*=\s*(async\s*)?\(/.test(
      firstMeaningful
    )
  ) {
    return isCreate ? 'Implementing logic & handlers' : 'Updating logic & handlers'
  }
  if (/^return\s*\(|^</.test(firstMeaningful)) {
    return 'Updating UI markup & layout'
  }
  return isCreate ? 'Writing implementation section' : 'Applying code modification'
}

export function buildProgressiveEditChunks(params: {
  beforeContent: string | null
  afterContent: string
  maxLinesPerChunk?: number
}): ProgressiveEditChunk[] {
  const { beforeContent, afterContent } = params
  const maxLines = Math.max(8, params.maxLinesPerChunk ?? DEFAULT_MAX_LINES_PER_CHUNK)
  const targetLines = afterContent.split(/\r?\n/)
  const lineEnding = afterContent.includes('\r\n') ? '\r\n' : '\n'
  const isCreate = beforeContent === null

  if (isCreate) {
    if (targetLines.length <= maxLines) {
      return [
        {
          chunkIndex: 0,
          totalChunks: 1,
          beforeContent: null,
          content: afterContent,
          startLine: 1,
          endLine: Math.max(1, targetLines.length),
          label: inferSectionLabel(targetLines, 0, true)
        }
      ]
    }
    const boundaries = splitLineRanges(targetLines, maxLines)
    let prevSnapshot: string | null = null
    return boundaries.map(([startIdx, endIdx], idx) => {
      const slice = targetLines.slice(0, endIdx + 1)
      const nextContent = idx === boundaries.length - 1 ? afterContent : slice.join(lineEnding)
      const chunk: ProgressiveEditChunk = {
        chunkIndex: idx,
        totalChunks: boundaries.length,
        beforeContent: prevSnapshot,
        content: nextContent,
        startLine: startIdx + 1,
        endLine: endIdx + 1,
        label: inferSectionLabel(targetLines.slice(startIdx, endIdx + 1), idx, true)
      }
      prevSnapshot = nextContent
      return chunk
    })
  }

  if (beforeContent === afterContent) {
    return []
  }

  const prevLines = beforeContent.split(/\r?\n/)
  const hunks = computeChangedLineHunks(prevLines, targetLines)
  if (hunks.length <= 1) {
    const hunk = hunks[0] ?? {
      origStart: 0,
      origEnd: prevLines.length,
      nextStart: 0,
      nextEnd: targetLines.length
    }
    return [
      {
        chunkIndex: 0,
        totalChunks: 1,
        beforeContent,
        content: afterContent,
        startLine: hunk.nextStart + 1,
        endLine: Math.max(hunk.nextStart + 1, hunk.nextEnd),
        label: inferSectionLabel(targetLines.slice(hunk.nextStart, hunk.nextEnd), 0, false)
      }
    ]
  }

  const chunks: ProgressiveEditChunk[] = []
  const runningLines = [...prevLines]
  let delta = 0
  let prevSnapshot: string = beforeContent
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]
    const isLast = i === hunks.length - 1
    const applyStart = Math.max(0, hunk.origStart + delta)
    const deleteCount = Math.max(0, hunk.origEnd - hunk.origStart)
    const inserted = targetLines.slice(hunk.nextStart, hunk.nextEnd)
    runningLines.splice(applyStart, deleteCount, ...inserted)
    delta += inserted.length - deleteCount
    const nextContent = isLast ? afterContent : runningLines.join(lineEnding)
    chunks.push({
      chunkIndex: i,
      totalChunks: hunks.length,
      beforeContent: prevSnapshot,
      content: nextContent,
      startLine: applyStart + 1,
      endLine: Math.max(applyStart + 1, applyStart + inserted.length),
      label: inferSectionLabel(inserted, i, false)
    })
    prevSnapshot = nextContent
  }
  return chunks
}

function splitLineRanges(lines: readonly string[], maxLines: number): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  while (start < lines.length) {
    const hardEnd = Math.min(lines.length - 1, start + maxLines - 1)
    let chosenEnd = hardEnd
    if (hardEnd < lines.length - 1) {
      const minPreferred = start + Math.max(6, Math.floor(maxLines * 0.45))
      for (let probe = hardEnd; probe >= minPreferred; probe--) {
        if (lines[probe].trim() === '' || lines[probe].trim() === '}') {
          chosenEnd = probe
          break
        }
      }
    }
    ranges.push([start, chosenEnd])
    start = chosenEnd + 1
  }
  return ranges
}

type LineHunk = { origStart: number; origEnd: number; nextStart: number; nextEnd: number }

function findUnchangedAnchor(
  prevLines: readonly string[],
  origFrom: number,
  origTo: number,
  nextLines: readonly string[],
  nextFrom: number,
  nextTo: number,
  minAnchorLines = 4
): { origIdx: number; nextIdx: number; len: number } | null {
  if (origTo - origFrom < minAnchorLines * 2 || nextTo - nextFrom < minAnchorLines * 2) {
    return null
  }
  for (let o = origFrom + 1; o <= origTo - minAnchorLines - 1; o += 1) {
    const firstLine = prevLines[o]
    for (let n = nextFrom + 1; n <= nextTo - minAnchorLines - 1; n += 1) {
      if (nextLines[n] !== firstLine) {
        continue
      }
      let run = 1
      while (o + run < origTo && n + run < nextTo && prevLines[o + run] === nextLines[n + run]) {
        run += 1
      }
      if (run >= minAnchorLines) {
        return { origIdx: o, nextIdx: n, len: run }
      }
    }
  }
  return null
}

function splitBoundedHunk(
  prevLines: readonly string[],
  origStart: number,
  origEnd: number,
  nextLines: readonly string[],
  nextStart: number,
  nextEnd: number,
  depth = 0
): LineHunk[] {
  let oStart = origStart
  let nStart = nextStart
  while (oStart < origEnd && nStart < nextEnd && prevLines[oStart] === nextLines[nStart]) {
    oStart += 1
    nStart += 1
  }
  let oEnd = origEnd
  let nEnd = nextEnd
  while (oEnd > oStart && nEnd > nStart && prevLines[oEnd - 1] === nextLines[nEnd - 1]) {
    oEnd -= 1
    nEnd -= 1
  }
  if (oStart === oEnd && nStart === nEnd) {
    return []
  }
  if (depth < 3 && Math.max(oEnd - oStart, nEnd - nStart) <= 600) {
    const anchor = findUnchangedAnchor(prevLines, oStart, oEnd, nextLines, nStart, nEnd)
    if (anchor) {
      return [
        ...splitBoundedHunk(
          prevLines,
          oStart,
          anchor.origIdx,
          nextLines,
          nStart,
          anchor.nextIdx,
          depth + 1
        ),
        ...splitBoundedHunk(
          prevLines,
          anchor.origIdx + anchor.len,
          oEnd,
          nextLines,
          anchor.nextIdx + anchor.len,
          nEnd,
          depth + 1
        )
      ]
    }
  }
  return [{ origStart: oStart, origEnd: oEnd, nextStart: nStart, nextEnd: nEnd }]
}

function computeChangedLineHunks(
  prevLines: readonly string[],
  nextLines: readonly string[]
): LineHunk[] {
  return splitBoundedHunk(prevLines, 0, prevLines.length, nextLines, 0, nextLines.length)
}
