import { describe, expect, it } from 'vitest'
import { applySearchReplacePatches, computeCharacterStreamSteps } from './ide-character-stream'
import { buildProgressiveEditChunks } from './ide-patch-chunker'
import { applyUnifiedDiffPatch, preserveTextLineEndingsAndBom } from './ide-unified-diff'

describe('ide-character-stream and patch primitives', () => {
  it('emits progressive character-level frames from empty file', () => {
    const frames = computeCharacterStreamSteps({
      beforeContent: '',
      afterContent: 'const LoginPage = () => {}',
      charsPerFrame: 3,
      maxFrames: 20
    })

    expect(frames.map((f) => f.text)).toEqual([
      'con',
      'const ',
      'const Log',
      'const LoginP',
      'const LoginPage',
      'const LoginPage = ',
      'const LoginPage = () ',
      'const LoginPage = () => ',
      'const LoginPage = () => {}'
    ])
    expect(frames.at(-1)).toMatchObject({
      cursorLine: 1,
      cursorColumn: 27,
      progressPercent: 100
    })
  })

  it('preserves suffix and avoids splitting CRLF sequences', () => {
    const before = 'line1()\r\nline3()'
    const after = 'line1()\r\nconst a = 1\r\nline3()'
    const frames = computeCharacterStreamSteps({
      beforeContent: before,
      afterContent: after,
      charsPerFrame: 4,
      maxFrames: 20
    })

    expect(frames.length).toBeGreaterThan(2)
    for (const frame of frames) {
      expect(frame.text.startsWith('line1()\r\n')).toBe(true)
      expect(frame.text.endsWith('line3()')).toBe(true)
      const head = frame.text.slice(0, frame.text.length - 'line3()'.length)
      expect(head.endsWith('\r')).toBe(false)
    }
    expect(frames.at(-1)?.text).toBe(after)
  })

  it('applies search/replace patches, handles unique indentation drift, and rejects ambiguous duplicates', () => {
    const applied = applySearchReplacePatches('const a = 1\r\nconst b = 2\r\n', [
      { search: 'const a = 1', replace: 'const a = 10' },
      { search: 'const b = 2', replace: 'const b = 20' }
    ])
    expect(applied).toEqual({
      ok: true,
      content: 'const a = 10\r\nconst b = 20\r\n'
    })

    const drifted = applySearchReplacePatches(
      'export function calc(x: number) {\n    const rate = x + 1\n    return rate * 2\n}\n',
      [
        {
          search: '  const rate = x + 1\n  return rate * 2',
          replace: '  const rate = x - 1\n  return rate * 2'
        }
      ]
    )
    expect(drifted).toEqual({
      ok: true,
      content: 'export function calc(x: number) {\n    const rate = x - 1\n    return rate * 2\n}\n'
    })

    const duplicate = applySearchReplacePatches('const v = 1\nconst v = 1\n', [
      { search: 'const v = 1', replace: 'const v = 2' }
    ])
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) {
      expect(duplicate.reason).toContain('matched multiple locations')
    }

    const missing = applySearchReplacePatches('const a = 1\n', [
      { search: 'const z = 99', replace: 'const z = 0' }
    ])
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.reason).toContain('Could not locate target search block')
    }
  })

  it('applies unified diff hunks with offset relocation and preserves UTF-8 BOM + CRLF', () => {
    const beforeWithBomCrlf =
      '\ufeffimport { Header } from "./Header"\r\n\r\nexport function Card() {\r\n  return <span>Old</span>\r\n}\r\n'
    const diff = [
      '--- a/src/Card.tsx',
      '+++ b/src/Card.tsx',
      '@@ -10,3 +10,3 @@',
      ' export function Card() {',
      '-  return <span>Old</span>',
      '+  return <span>Updated</span>',
      ' }'
    ].join('\n')

    const res = applyUnifiedDiffPatch(beforeWithBomCrlf, diff)
    expect(res).toEqual({
      ok: true,
      hunksApplied: 1,
      content:
        '\ufeffimport { Header } from "./Header"\r\n\r\nexport function Card() {\r\n  return <span>Updated</span>\r\n}\r\n'
    })

    expect(preserveTextLineEndingsAndBom('\ufeffa\r\nb\r\n', 'x\ny\n')).toBe('\ufeffx\r\ny\r\n')
  })

  it('splits non-adjacent modifications into progressive hunks', () => {
    const before = ['a1', 'u1', 'u2', 'u3', 'u4', 'b1'].join('\n')
    const after = ['a2', 'u1', 'u2', 'u3', 'u4', 'b2'].join('\n')
    const chunks = buildProgressiveEditChunks({
      beforeContent: before,
      afterContent: after,
      maxLinesPerChunk: 8
    })
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.content).toBe(['a2', 'u1', 'u2', 'u3', 'u4', 'b1'].join('\n'))
    expect(chunks[1]?.content).toBe(after)
  })
})
