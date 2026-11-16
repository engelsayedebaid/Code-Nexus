// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeChatSentPrompts } from '../../drafts/native-chat-sent-prompt-history'
import type { NativeChatMessage } from '../../../../../../shared/native-chat/native-chat-types'
import { clearNativeChatTextAttachmentStatCacheForTests } from './native-chat-text-attachment-stat'
import { NativeChatTextAttachments } from './NativeChatTextAttachments'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (...args: unknown[]) => mocks.callRuntimeRpc(...args)
}))

vi.mock('@/i18n/use-translate', () => ({
  useTranslate: () => (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')) : fallback
}))

vi.mock('@/i18n/use-ui-language-revision', () => ({
  useUiLanguageRevision: () => 0
}))

const WIN_STORE_PATH =
  'C:\\Users\\engelsayedebaid\\AppData\\Roaming\\Orca Nexus\\agent-session-attachments\\12345678-1234-1234-1234-1234567890ab\\orca-paste-abcd1234.txt'

beforeEach(() => {
  mocks.callRuntimeRpc.mockReset()
  clearNativeChatTextAttachmentStatCacheForTests()
})

afterEach(() => {
  cleanup()
  clearNativeChatTextAttachmentStatCacheForTests()
})

describe('NativeChatTextAttachments', () => {
  it('strips internal AppData path from message text and renders Pasted text with byte size', async () => {
    mocks.callRuntimeRpc.mockResolvedValue({ exists: true, sizeBytes: 18_842 })

    const { container } = render(
      <NativeChatTextAttachments
        content={`Explain this traceback:\n@"${WIN_STORE_PATH}"`}
        structured={true}
        runtimeContext={{
          target: { kind: 'local' },
          worktreeId: 'wt-1',
          worktreePath: '/ws'
        }}
        renderText={(text) => <p data-testid="rendered-prose">{text}</p>}
      />
    )

    expect(screen.getByTestId('rendered-prose').textContent).toBe('Explain this traceback:')
    expect(container.textContent).not.toContain('AppData')
    expect(container.textContent).not.toContain('agent-session-attachments')
    expect(container.textContent).not.toContain('orca-paste-')

    await waitFor(() => {
      expect(container.textContent).toContain('Pasted text')
      expect(container.textContent).toContain('Text attachment · 18.4 KB')
    })
  })

  it('numbers multiple pasted attachments and displays Unavailable attachment when missing on disk', async () => {
    const secondPath =
      '/Users/dev/Library/Application Support/Orca Nexus/agent-session-attachments/abcdefab-1234-1234-1234-1234567890ab/orca-paste-second.txt'

    mocks.callRuntimeRpc
      .mockResolvedValueOnce({ exists: true, sizeBytes: 2048 })
      .mockResolvedValueOnce({ exists: false, sizeBytes: null })

    const { container } = render(
      <NativeChatTextAttachments
        content={`@"${WIN_STORE_PATH}" @"${secondPath}"`}
        structured={true}
        runtimeContext={{
          target: { kind: 'local' },
          worktreeId: 'wt-1',
          worktreePath: '/ws'
        }}
        renderText={(text) => <p data-testid="rendered-prose">{text}</p>}
      />
    )

    expect(screen.queryByTestId('rendered-prose')).toBeNull()
    await waitFor(() => {
      expect(container.textContent).toContain('Pasted text 1')
      expect(container.textContent).toContain('Text attachment · 2.0 KB')
      expect(container.textContent).toContain('Pasted text 2')
      expect(container.textContent).toContain('Unavailable attachment')
    })
  })

  it('sanitizes internal pasted attachment paths out of structured prompt recall history', () => {
    const messages: NativeChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        source: 'transcript',
        blocks: [{ type: 'text', text: `Review this file @"${WIN_STORE_PATH}"` }],
        timestamp: 1000
      }
    ]
    expect(nativeChatSentPrompts({ messages, withoutImageMarkers: true })).toEqual([
      { id: 'u1', prompt: 'Review this file' }
    ])
  })
})
