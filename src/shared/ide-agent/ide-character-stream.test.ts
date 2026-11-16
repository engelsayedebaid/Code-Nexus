import { describe, expect, it } from 'vitest'
import { applySearchReplacePatches, computeCharacterStreamSteps } from './ide-character-stream'

describe('ide-character-stream', () => {
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

  it('applies search/replace patches and preserves CRLF line endings', () => {
    const applied = applySearchReplacePatches('const a = 1\r\nconst b = 2\r\n', [
      { search: 'const a = 1', replace: 'const a = 10' },
      { search: 'const b = 2', replace: 'const b = 20' }
    ])
    expect(applied).toEqual({
      ok: true,
      content: 'const a = 10\r\nconst b = 20\r\n'
    })

    const missing = applySearchReplacePatches('const a = 1\n', [
      { search: 'const z = 99', replace: 'const z = 0' }
    ])
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.reason).toContain('Could not locate target search block')
    }
  })
})
