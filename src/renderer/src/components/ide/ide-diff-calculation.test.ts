import { describe, expect, it } from 'vitest'
import { computeIdeDiffStats, computeIdeStructuredDiffLines } from './ide-diff-calculation'

describe('ide-diff-calculation', () => {
  it('computes accurate multi-hunk LCS diffs and collapses unchanged middle lines', () => {
    const before = [
      'const a = 1',
      'const b = 2',
      'const keep1 = true',
      'const keep2 = true',
      'const keep3 = true',
      'const keep4 = true',
      'const keep5 = true',
      'const keep6 = true',
      'const keep7 = true',
      'const keep8 = true',
      'const z = 9'
    ].join('\n')

    const after = [
      'const a = 1',
      'const b = 20',
      'const keep1 = true',
      'const keep2 = true',
      'const keep3 = true',
      'const keep4 = true',
      'const keep5 = true',
      'const keep6 = true',
      'const keep7 = true',
      'const keep8 = true',
      'const z = 90',
      'export { a, b, z }'
    ].join('\n')

    expect(computeIdeDiffStats(before, after)).toEqual({ added: 3, removed: 2 })

    const rows = computeIdeStructuredDiffLines(before, after, 1)
    expect(rows).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'const a = 1' },
      { kind: 'del', oldLine: 2, newLine: null, text: 'const b = 2' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'const b = 20' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'const keep1 = true' },
      { kind: 'gap', hiddenCount: 6 },
      { kind: 'context', oldLine: 10, newLine: 10, text: 'const keep8 = true' },
      { kind: 'del', oldLine: 11, newLine: null, text: 'const z = 9' },
      { kind: 'add', oldLine: null, newLine: 11, text: 'const z = 90' },
      { kind: 'add', oldLine: null, newLine: 12, text: 'export { a, b, z }' }
    ])
  })
})
