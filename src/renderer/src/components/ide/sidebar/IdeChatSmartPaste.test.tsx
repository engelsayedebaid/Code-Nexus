// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeChatComposer } from './IdeChatComposer'
import { IdeChatMessageItem } from './IdeChatMessageItem'

const mocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (...args: unknown[]) => mocks.callRuntimeRpc(...args)
}))

function createConversation(): IdeConversation {
  return {
    id: 'conv-paste-1',
    workspaceKey: 'ws-paste',
    workspacePath: '/ws',
    title: 'Paste Test',
    mode: 'ask',
    agentId: 'claude',
    modelId: 'sonnet',
    multiAgentEnabled: false,
    followAgent: true,
    liveEditSpeed: 'natural',
    status: 'idle',
    activeRunId: null,
    messages: [],
    activity: [],
    plans: [],
    activePlanId: null,
    fileChanges: [],
    checkpoints: [],
    pendingPermissions: [],
    commandExecutions: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  }
}

function dispatchPaste(element: HTMLElement, text: string): boolean {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [],
      getData: (type: string) => (type === 'text/plain' ? text : '')
    }
  })
  return element.dispatchEvent(event)
}

beforeEach(() => {
  mocks.callRuntimeRpc.mockReset()
  const conv = createConversation()
  useIdeAgentStore.setState({
    activeConversation: conv,
    conversations: [],
    draftsByConversation: { [conv.id]: '' },
    attachmentsByConversation: { [conv.id]: [] },
    providers: [],
    providersLoading: false
  })
})

afterEach(() => {
  cleanup()
})

describe('IDE Chat Smart Paste & Attachment UI', () => {
  it('leaves short English/Arabic pastes inline without calling attachment RPC', () => {
    const conv = useIdeAgentStore.getState().activeConversation!
    render(
      <IdeChatComposer
        conversation={conv}
        workspacePath="/ws"
        worktreeSelector="wt-1"
        worktreeId="wt-1"
        isRunning={false}
      />
    )
    const input = screen.getByTestId('ide-chat-composer-input')
    const notCanceled = dispatchPaste(input, 'مرحبا\n  const ok = true')
    expect(notCanceled).toBe(true)
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('turns 2000-line paste into numbered Pasted text cards, supports preview & remove, and hides paths', async () => {
    const conv = useIdeAgentStore.getState().activeConversation!
    const twoThousandLines = Array.from({ length: 2000 }, (_, i) => `row_${i + 1} = 1`).join('\n')
    const savedMap = new Map<string, { content: string; attachment: IdeChatAttachment }>()

    mocks.callRuntimeRpc.mockImplementation(
      async (_target: unknown, method: string, rawParams: unknown) => {
        const params =
          typeof rawParams === 'object' && rawParams !== null
            ? (rawParams as Record<string, unknown>)
            : {}
        if (method === 'ideAgent.savePastedAttachment') {
          const content = typeof params.content === 'string' ? params.content : ''
          const att: IdeChatAttachment = {
            id: typeof params.attachmentId === 'string' ? params.attachmentId : 'paste-1',
            kind: 'pasted_text',
            name: typeof params.displayName === 'string' ? params.displayName : 'Pasted text',
            mimeType: 'text/plain',
            sizeBytes: 18_842,
            lineCount: content.split('\n').length,
            charCount: content.length,
            format: 'code',
            status: 'ready'
          }
          savedMap.set(att.id, { content, attachment: att })
          return { attachment: att }
        }
        if (method === 'ideAgent.readAttachmentContent') {
          const attachmentId = typeof params.attachmentId === 'string' ? params.attachmentId : ''
          const entry = savedMap.get(attachmentId)
          if (!entry) {
            return {
              exists: false,
              attachmentId,
              content: '',
              startLine: 1,
              endLine: 0,
              totalLines: 0,
              sizeBytes: 0,
              charCount: 0,
              hasMore: false
            }
          }
          const lines = entry.content.split('\n')
          const start = typeof params.startLine === 'number' ? params.startLine : 1
          const end = Math.min(
            lines.length,
            typeof params.endLine === 'number' ? params.endLine : lines.length
          )
          return {
            exists: true,
            attachmentId,
            content: lines.slice(start - 1, end).join('\n'),
            startLine: start,
            endLine: end,
            totalLines: lines.length,
            sizeBytes: entry.attachment.sizeBytes ?? 18_842,
            charCount: entry.content.length,
            hasMore: end < lines.length
          }
        }
        if (method === 'ideAgent.sendPrompt') {
          return { conversation: conv }
        }
        return {}
      }
    )

    const { container } = render(
      <IdeChatComposer
        conversation={conv}
        workspacePath="/ws"
        worktreeSelector="wt-1"
        worktreeId="wt-1"
        isRunning={false}
      />
    )
    const input = screen.getByTestId<HTMLTextAreaElement>('ide-chat-composer-input')

    // First long paste -> becomes "Pasted text" card (no raw path in composer or DOM).
    const firstAllowedDefault = dispatchPaste(input, twoThousandLines)
    expect(firstAllowedDefault).toBe(false)

    await waitFor(() => {
      expect(screen.getAllByTestId('ide-composer-pasted-card')).toHaveLength(1)
    })
    expect(container.textContent).toContain('Pasted text')
    expect(container.textContent).toContain('Text attachment · 18.4 KB')
    expect(container.textContent).not.toContain('ide-agent-attachments')
    expect(input.value).toBe('')

    // Second long paste -> renumbers to "Pasted text 1" and "Pasted text 2".
    dispatchPaste(input, 'alpha\n'.repeat(60))
    await waitFor(() => {
      expect(screen.getAllByTestId('ide-composer-pasted-card')).toHaveLength(2)
    })
    expect(container.textContent).toContain('Pasted text 1')
    expect(container.textContent).toContain('Pasted text 2')

    // Click first card to open preview modal and verify content loads via RPC.
    fireEvent.click(screen.getByRole('button', { name: /Preview Pasted text 1/i }))
    await waitFor(() => {
      expect(screen.getByText('row_1 = 1')).toBeTruthy()
    })
    fireEvent.keyDown(document.body, { key: 'Escape' })

    // Remove second attachment cleanly and verify remaining reverts to single "Pasted text".
    fireEvent.click(screen.getByRole('button', { name: /Remove Pasted text 2/i }))
    await waitFor(() => {
      expect(screen.getAllByTestId('ide-composer-pasted-card')).toHaveLength(1)
    })
    expect(container.textContent).not.toContain('Pasted text 1')
  })

  it('renders user chat bubble attachment cards without raw paths and opens missing-file notice honestly', async () => {
    const conv = createConversation()
    const missingAtt: IdeChatAttachment = {
      id: 'paste-missing-1',
      kind: 'pasted_text',
      name: 'Pasted text',
      mimeType: 'text/plain',
      sizeBytes: 18_842,
      lineCount: 2000,
      status: 'missing'
    }
    render(
      <IdeChatMessageItem
        message={{
          id: 'm-user-1',
          conversationId: conv.id,
          role: 'user',
          mode: 'ask',
          text: 'Check this pasted snippet',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          attachments: [missingAtt]
        }}
        conversation={conv}
        providers={[]}
        plansById={new Map()}
        commandsById={new Map()}
      />
    )
    const card = screen.getByTestId('ide-pasted-attachment-card')
    expect(card.textContent).toContain('Pasted text')
    expect(card.textContent).toContain('Unavailable attachment')
    fireEvent.click(card)
    await waitFor(() => {
      expect(screen.getByText(/no longer available on disk/i)).toBeTruthy()
    })
  })
})
