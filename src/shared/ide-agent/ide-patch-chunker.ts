export type ProgressiveEditChunk = {
  chunkIndex: number
  totalChunks: number
  content: string
  startLine: number
  endLine: number
  label: string
}

const DEFAULT_MAX_LINES_PER_CHUNK = 28

function inferSectionLabel(lines: readonly string[], chunkIndex: number, isCreate: boolean): string {
  const firstMeaningful = lines.find((line) => line.trim().length > 0)?.trim() ?? ''
  if (chunkIndex === 0 && /^(import\b|from\b|#include\b|using\b|package\b)/.test(firstMeaningful)) {
    return isCreate ? 'Writing imports & module header' : 'Updating imports & module header'
  }
  if (/^(export\s+)?(interface|type|enum|class)\b/.test(firstMeaningful)) {
    return isCreate ? 'Defining types & structure' : 'Updating types & structure'
  }
  if (/^(export\s+)?(async\s+)?function\b|^(const|let)\s+\w+\s*=\s*(async\s*)?\(/.test(firstMeaningful)) {
    return isCreate ? 'Implementing logic & handlers' : 'Updating logic & handlers'
  }
  if (/^return\s*\(|^</.test(firstMeaningful)) {
    return 'Updating UI markup & layout'
  }
  return isCreate ? 'Writing implementation section' : 'Applying code modification'
}

/**
 * Splits a file transition (`beforeContent` -> `afterContent`) into bounded, line-aligned
 * progressive states so Monaco and disk both hold real intermediate snapshots without
 * per-character animation.
 */
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
          content: afterContent,
          startLine: 1,
          endLine: Math.max(1, targetLines.length),
          label: inferSectionLabel(targetLines, 0, true)
        }
      ]
    }
    const boundaries = splitLineRanges(targetLines, maxLines)
    return boundaries.map(([startIdx, endIdx], idx) => {
      const slice = targetLines.slice(0, endIdx + 1)
      return {
        chunkIndex: idx,
        totalChunks: boundaries.length,
        content: idx === boundaries.length - 1 ? afterContent : slice.join(lineEnding),
        startLine: startIdx + 1,
        endLine: endIdx + 1,
        label: inferSectionLabel(targetLines.slice(startIdx, endIdx + 1), idx, true)
      }
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
    const nextCount = hunk.nextEnd - hunk.nextStart
    if (nextCount > maxLines) {
      const subRanges = splitLineRanges(targetLines.slice(hunk.nextStart, hunk.nextEnd), maxLines)
      return subRanges.map(([subStart, subEnd], idx) => {
        const isLast = idx === subRanges.length - 1
        const mergedLines = isLast
          ? targetLines
          : [
              ...targetLines.slice(0, hunk.nextStart + subEnd + 1),
              ...prevLines.slice(hunk.origEnd)
            ]
        return {
          chunkIndex: idx,
          totalChunks: subRanges.length,
          content: isLast ? afterContent : mergedLines.join(lineEnding),
          startLine: hunk.nextStart + subStart + 1,
          endLine: hunk.nextStart + subEnd + 1,
          label: inferSectionLabel(
            targetLines.slice(hunk.nextStart + subStart, hunk.nextStart + subEnd + 1),
            idx,
            false
          )
        }
      })
    }
    return [
      {
        chunkIndex: 0,
        totalChunks: 1,
        content: afterContent,
        startLine: hunk.nextStart + 1,
        endLine: Math.max(hunk.nextStart + 1, hunk.nextEnd),
        label: inferSectionLabel(targetLines.slice(hunk.nextStart, hunk.nextEnd), 0, false)
      }
    ]
  }

  // Apply hunks cumulatively from bottom-to-top? Top-to-bottom shifts offsets cleanly if we splice against running lines!
  const chunks: ProgressiveEditChunk[] = []
  let runningLines = [...prevLines]
  let delta = 0
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]
    const isLast = i === hunks.length - 1
    const applyStart = Math.max(0, hunk.origStart + delta)
    const deleteCount = Math.max(0, hunk.origEnd - hunk.origStart)
    const inserted = targetLines.slice(hunk.nextStart, hunk.nextEnd)
    runningLines.splice(applyStart, deleteCount, ...inserted)
    delta += inserted.length - deleteCount
    chunks.push({
      chunkIndex: i,
      totalChunks: hunks.length,
      content: isLast ? afterContent : runningLines.join(lineEnding),
      startLine: applyStart + 1,
      endLine: Math.max(applyStart + 1, applyStart + inserted.length),
      label: inferSectionLabel(inserted, i, false)
    })
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

type LineHunk = {
  origStart: number
  origEnd: number
  nextStart: number
  nextEnd: number
}

function computeChangedLineHunks(
  prevLines: readonly string[],
  nextLines: readonly string[]
): LineHunk[] {
  // Trim common prefix & suffix first, then group internal mismatches.
  let prefix = 0
  while (
    prefix < prevLines.length &&
    prefix < nextLines.length &&
    prevLines[prefix] === nextLines[prefix]
  ) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < prevLines.length - prefix &&
    suffix < nextLines.length - prefix &&
    prevLines[prevLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix++
  }
  const prevMid = prevLines.slice(prefix, prevLines.length - suffix)
  const nextMid = nextLines.slice(prefix, nextLines.length - suffix)

  if (prevMid.length === 0 && nextMid.length === 0) {
    return []
  }

  // When diff sizes are moderate, find exact anchor matches using LCS indices; otherwise return 1 hunk.
  if (prevMid.length * nextMid.length > 250_000) {
    return [
      {
        origStart: prefix,
        origEnd: prevLines.length - suffix,
        nextStart: prefix,
        nextEnd: nextLines.length - suffix
      }
    ]
  }

  const m = prevMid.length
  const n = nextMid.length
  const dp = new Int32Array((m + 1) * (n + 1))
  const stride = n + 1
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (prevMid[i] === nextMid[j]) {
        dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)] + 1
      } else {
        const down = dp[(i + 1) * stride + j]
        const right = dp[i * stride + (j + 1)]
        dp[i * stride + j] = down >= right ? down : right
      }
    }
  }

  const hunks: LineHunk[] = []
  let i = 0
  let j = 0
  let cur: LineHunk | null = null
  while (i < m || j < n) {
    if (i < m && j < n && prevMid[i] === nextMid[j]) {
      if (cur) {
        hunks.push(cur)
        cur = null
      }
      i++
      j++
      continue
    }
    cur ??= {
      origStart: prefix + i,
      origEnd: prefix + i,
      nextStart: prefix + j,
      nextEnd: prefix + j
    }
    if (i < m && (j >= n || dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)])) {
      i++
      cur.origEnd = prefix + i
    } else if (j < n) {
      j++
      cur.nextEnd = prefix + j
    }
  }
  if (cur) {
    hunks.push(cur)
  }
  return hunks
}
