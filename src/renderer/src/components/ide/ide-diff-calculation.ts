export type IdeStructuredDiffRow =
  | {
      kind: 'context' | 'add' | 'del'
      oldLine: number | null
      newLine: number | null
      text: string
    }
  | {
      kind: 'gap'
      hiddenCount: number
    }

export type IdeDiffStats = {
  added: number
  removed: number
}

const MAX_LCS_MATRIX_CELLS = 160_000
const MAX_RENDERED_DIFF_ROWS = 280

function splitLines(content: string | null): string[] {
  if (content === null || content.length === 0) {
    return []
  }
  return content.replace(/\r\n/g, '\n').split('\n')
}

type RawEditOp = {
  kind: 'context' | 'add' | 'del'
  oldLine: number | null
  newLine: number | null
  text: string
}

function computeEditOperations(beforeText: string | null, afterText: string | null): RawEditOp[] {
  if (beforeText === afterText) {
    return []
  }
  const beforeLines = splitLines(beforeText)
  const afterLines = splitLines(afterText)

  if (beforeText === null) {
    return afterLines.map((text, idx) => ({
      kind: 'add',
      oldLine: null,
      newLine: idx + 1,
      text
    }))
  }
  if (afterText === null) {
    return beforeLines.map((text, idx) => ({
      kind: 'del',
      oldLine: idx + 1,
      newLine: null,
      text
    }))
  }

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const ops: RawEditOp[] = []
  for (let i = 0; i < prefix; i += 1) {
    ops.push({ kind: 'context', oldLine: i + 1, newLine: i + 1, text: beforeLines[i] })
  }

  const midBefore = beforeLines.slice(prefix, beforeLines.length - suffix)
  const midAfter = afterLines.slice(prefix, afterLines.length - suffix)
  const n = midBefore.length
  const m = midAfter.length

  if (n === 0 || m === 0 || n * m > MAX_LCS_MATRIX_CELLS) {
    for (let i = 0; i < n; i += 1) {
      ops.push({ kind: 'del', oldLine: prefix + i + 1, newLine: null, text: midBefore[i] })
    }
    for (let j = 0; j < m; j += 1) {
      ops.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, text: midAfter[j] })
    }
  } else {
    const width = m + 1
    const dp = new Int32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i -= 1) {
      const rowOffset = i * width
      const nextRowOffset = (i + 1) * width
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[rowOffset + j] =
          midBefore[i] === midAfter[j]
            ? dp[nextRowOffset + j + 1] + 1
            : Math.max(dp[nextRowOffset + j], dp[rowOffset + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midBefore[i] === midAfter[j]) {
        ops.push({
          kind: 'context',
          oldLine: prefix + i + 1,
          newLine: prefix + j + 1,
          text: midBefore[i]
        })
        i += 1
        j += 1
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        ops.push({ kind: 'del', oldLine: prefix + i + 1, newLine: null, text: midBefore[i] })
        i += 1
      } else {
        ops.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, text: midAfter[j] })
        j += 1
      }
    }
    while (i < n) {
      ops.push({ kind: 'del', oldLine: prefix + i + 1, newLine: null, text: midBefore[i] })
      i += 1
    }
    while (j < m) {
      ops.push({ kind: 'add', oldLine: null, newLine: prefix + j + 1, text: midAfter[j] })
      j += 1
    }
  }

  const beforeTailStart = beforeLines.length - suffix
  const afterTailStart = afterLines.length - suffix
  for (let k = 0; k < suffix; k += 1) {
    ops.push({
      kind: 'context',
      oldLine: beforeTailStart + k + 1,
      newLine: afterTailStart + k + 1,
      text: afterLines[afterTailStart + k]
    })
  }

  return ops
}

export function computeIdeDiffStats(
  beforeContent: string | null,
  afterContent: string | null
): IdeDiffStats {
  const ops = computeEditOperations(beforeContent, afterContent)
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === 'add') {
      added += 1
    } else if (op.kind === 'del') {
      removed += 1
    }
  }
  return { added, removed }
}

export function computeIdeStructuredDiffLines(
  beforeContent: string | null,
  afterContent: string | null,
  contextRadius = 3
): IdeStructuredDiffRow[] {
  const ops = computeEditOperations(beforeContent, afterContent)
  if (ops.length === 0) {
    return []
  }

  const keep = new Uint8Array(ops.length)
  let hasChanged = false
  for (let idx = 0; idx < ops.length; idx += 1) {
    if (ops[idx].kind !== 'context') {
      hasChanged = true
      const start = Math.max(0, idx - contextRadius)
      const end = Math.min(ops.length - 1, idx + contextRadius)
      for (let k = start; k <= end; k += 1) {
        keep[k] = 1
      }
    }
  }
  if (!hasChanged) {
    return []
  }

  const rows: IdeStructuredDiffRow[] = []
  let idx = 0
  while (idx < ops.length && rows.length < MAX_RENDERED_DIFF_ROWS) {
    if (keep[idx] === 1) {
      rows.push(ops[idx])
      idx += 1
      continue
    }
    let endSkip = idx
    while (endSkip < ops.length && keep[endSkip] === 0) {
      endSkip += 1
    }
    rows.push({ kind: 'gap', hiddenCount: endSkip - idx })
    idx = endSkip
  }

  return rows
}
