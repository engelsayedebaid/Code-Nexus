import { describe, expect, it } from 'vitest'
import { isNativeChatLongPaste } from '../native-chat/input/native-chat-long-paste'
import { nativeChatMessageCopyText } from '../native-chat/transcript/native-chat-message-copy-text'
import {
  extractNativeChatVisibleAttachments,
  isInternalAttachmentDisplayCandidate,
  sanitizeUserFacingAttachmentText
} from './native-chat-attachment-metadata'
import {
  SMART_PASTE_CONFIG,
  classifySmartPaste,
  countTextLines,
  detectPastedTextFormat,
  formatSmartAttachmentSize,
  measureTextUtf8Bytes
} from './smart-paste-config'

describe('smart paste config & classification', () => {
  it('keeps short English, Arabic, and indented snippets inline', () => {
    expect(classifySmartPaste('const x = 1\n  return x').kind).toBe('short')
    expect(isNativeChatLongPaste('مرحبا بالعالم\nconst greeting = "أهلاً"')).toBe(false)
    const almost2k = 'a'.repeat(SMART_PASTE_CONFIG.charThreshold - 1)
    expect(classifySmartPaste(almost2k).kind).toBe('short')
    const fortyNineLines = Array.from({ length: 49 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(classifySmartPaste(fortyNineLines).kind).toBe('short')
  })

  it('converts >=2000 chars or >=50 lines (including 2,000 lines / ~18.4 KB) into attachment', () => {
    expect(classifySmartPaste('x'.repeat(SMART_PASTE_CONFIG.charThreshold)).kind).toBe('attachment')
    const fiftyLines = Array.from({ length: 50 }, () => 'row').join('\n')
    expect(classifySmartPaste(fiftyLines).kind).toBe('attachment')
    expect(isNativeChatLongPaste(fiftyLines)).toBe(true)

    const twoThousandLines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}: item`).join(
      '\n'
    )
    const classified = classifySmartPaste(twoThousandLines)
    expect(classified.kind).toBe('attachment')
    expect(classified.lineCount).toBe(2000)
    expect(classified.sizeBytes).toBeGreaterThan(20_000)
  })

  it('rejects payloads above the 16 MiB safety cap and formats sizes accurately', () => {
    const oversized = 'a'.repeat(SMART_PASTE_CONFIG.maxAttachmentBytes + 1)
    expect(classifySmartPaste(oversized).kind).toBe('too_large')
    expect(formatSmartAttachmentSize(18_842)).toBe('18.4 KB')
    expect(measureTextUtf8Bytes('مرحبا')).toBe(10)
    expect(countTextLines('a\r\nb\rc\n')).toBe(4)
    expect(detectPastedTextFormat('{"ok": true}').format).toBe('json')
  })
})

describe('native-chat internal attachment path sanitization', () => {
  const winStorePath =
    'C:\\Users\\engelsayedebaid\\AppData\\Roaming\\Orca Nexus\\agent-session-attachments\\12345678-1234-1234-1234-1234567890ab\\orca-paste-12345678-1234-1234-1234-1234567890ab.txt'

  it('identifies internal store paths while ignoring normal user workspace paths', () => {
    expect(isInternalAttachmentDisplayCandidate(winStorePath)).toBe(true)
    expect(isInternalAttachmentDisplayCandidate('C:\\Users\\dev\\repo\\src\\index.ts')).toBe(false)
    expect(isInternalAttachmentDisplayCandidate('/Users/dev/project/README.md')).toBe(false)
  })

  it('strips internal AppData paste paths from user-facing text and copy output', () => {
    const raw = `Explain this stacktrace:\n@"${winStorePath}"`
    const extracted = extractNativeChatVisibleAttachments(raw, true)
    expect(extracted.visibleText).toBe('Explain this stacktrace:')
    expect(extracted.attachments).toEqual([
      {
        path: winStorePath,
        displayName: 'Pasted text',
        isPastedText: true,
        index: 0,
        totalOfKind: 1
      }
    ])
    expect(sanitizeUserFacingAttachmentText(raw, true)).toBe('Explain this stacktrace:')
    expect(
      nativeChatMessageCopyText({
        role: 'user',
        blocks: [{ type: 'text', text: raw }]
      })
    ).toBe('Explain this stacktrace:')
  })

  it('handles attachment-only messages and numbers multiple pasted blocks cleanly', () => {
    const secondPath =
      '/Users/dev/Library/Application Support/Orca Nexus/agent-session-attachments/abcdefab-1234-1234-1234-1234567890ab/orca-paste-second.txt'
    const onlyOne = extractNativeChatVisibleAttachments(`@"${winStorePath}"`, true)
    expect(onlyOne.visibleText).toBe('')
    expect(onlyOne.attachments).toHaveLength(1)

    const multi = extractNativeChatVisibleAttachments(
      `Compare @"${winStorePath}" and @"${secondPath}" please`,
      true
    )
    expect(multi.visibleText).toBe('Compare and please')
    expect(multi.attachments.map((a) => a.displayName)).toEqual(['Pasted text 1', 'Pasted text 2'])
  })
})
