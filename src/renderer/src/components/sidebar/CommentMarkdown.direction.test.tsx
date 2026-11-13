// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CommentMarkdown from './CommentMarkdown'

afterEach(cleanup)

const arabicReply = [
  '## نظرة عامة',
  '',
  'شغّل الأمر `pnpm tc` من المسار C:\\Users\\orca\\app قبل الدفع.',
  '',
  'Then run the tests.',
  '',
  '```bash',
  'pnpm tc',
  '```'
].join('\n')

describe('markdown direction', () => {
  it('aligns Arabic blocks right and keeps Latin blocks left', () => {
    const view = render(<CommentMarkdown content={arabicReply} variant="document" />)

    expect(view.container.firstElementChild?.getAttribute('dir')).toBe('rtl')
    expect(view.container.querySelector('h2')?.getAttribute('dir')).toBe('rtl')
    const paragraphs = Array.from(view.container.querySelectorAll('p'))
    expect(paragraphs.map((paragraph) => paragraph.getAttribute('dir'))).toEqual(['rtl', 'ltr'])
  })

  it('isolates inline code and leaves code blocks left-to-right', () => {
    const view = render(<CommentMarkdown content={arabicReply} variant="document" />)

    expect(view.container.querySelector('p code')?.getAttribute('dir')).toBe('auto')
    expect(view.container.querySelector('pre')?.getAttribute('dir')).toBe('ltr')
  })

  it('isolates bare URL and file-path links inside Arabic paragraphs as LTR', () => {
    const mixed = 'راجع الرابط https://example.com/docs والملف C:\\Users\\orca\\app\\index.ts الآن.'
    const view = render(<CommentMarkdown content={mixed} variant="document" />)

    expect(view.container.querySelector('p')?.getAttribute('dir')).toBe('rtl')
    const links = Array.from(view.container.querySelectorAll('a'))
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]?.getAttribute('dir')).toBe('ltr')
  })

  it('keeps Arabic ordered lists and tables RTL while honoring directionOverride', () => {
    const listAndTable = [
      '1. الخطوة الأولى مع `npm test`',
      '2. الخطوة الثانية',
      '',
      '| الميزة | الحالة |',
      '| --- | --- |',
      '| المجلس | جاهز |'
    ].join('\n')

    const autoView = render(
      <CommentMarkdown content={listAndTable} variant="document" directionOverride="auto" />
    )
    expect(autoView.container.querySelector('ol')?.getAttribute('dir')).toBe('rtl')
    expect(autoView.container.querySelector('table')?.getAttribute('dir')).toBe('rtl')

    const forcedLtr = render(
      <CommentMarkdown content={listAndTable} variant="document" directionOverride="ltr" />
    )
    expect(forcedLtr.container.firstElementChild?.getAttribute('dir')).toBe('ltr')
    expect(forcedLtr.container.querySelector('ol')?.getAttribute('dir')).toBe('ltr')

    const forcedRtl = render(
      <CommentMarkdown
        content="Plain English paragraph"
        variant="document"
        directionOverride="rtl"
      />
    )
    expect(forcedRtl.container.firstElementChild?.getAttribute('dir')).toBe('rtl')
    expect(forcedRtl.container.querySelector('p')?.getAttribute('dir')).toBe('rtl')
  })

  it('leaves a Latin message without a forced direction', () => {
    const view = render(<CommentMarkdown content="Run `pnpm tc` first." variant="document" />)

    expect(view.container.firstElementChild?.hasAttribute('dir')).toBe(false)
    expect(view.container.querySelector('p')?.getAttribute('dir')).toBe('ltr')
  })
})
