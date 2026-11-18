// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'
import type { IdeEnhancePromptResult } from '../../../../../shared/ide-agent/ide-prompt-enhancer-types'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ activeFileId: null, openFiles: [] })
  }
}))

import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import {
  setPromptEnhancerTransportForTesting,
  useIdePromptEnhancerStore
} from '@/store/ide-agent/ide-prompt-enhancer-store'
import { IdePromptEnhancerButton } from './IdePromptEnhancerButton'
import { IdePromptEnhancerPreview } from './IdePromptEnhancerPreview'

function makeConversation(id = 'conv-ui-1'): IdeConversation {
  return {
    id,
    workspaceKey: 'ws-1',
    workspacePath: '/workspace',
    title: 'UI Test',
    mode: 'agent',
    agentId: 'claude',
    modelId: 'claude-sonnet-4-5',
    multiAgentEnabled: false,
    followAgent: true,
    activePlanId: null,
    activeRunId: null,
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    plans: [],
    activity: [],
    fileChanges: [],
    checkpoints: [],
    commandExecutions: [],
    pendingPermissions: []
  }
}

describe('IdePromptEnhancer UI', () => {
  afterEach(() => {
    cleanup()
    setPromptEnhancerTransportForTesting(null)
  })

  beforeEach(() => {
    useIdePromptEnhancerStore.setState({ byConversation: {} })
    const conv = makeConversation()
    useIdeAgentStore.setState({
      activeConversation: conv,
      draftsByConversation: { [conv.id]: '' },
      attachmentsByConversation: {}
    })
  })

  it('shows live enhancing animation while allowing continued typing, then previews RTL text, applies, and restores', async () => {
    const conv = makeConversation()
    let resolveEnhance: ((res: IdeEnhancePromptResult) => void) | null = null
    let capturedRequestId = ''
    setPromptEnhancerTransportForTesting({
      enhance: (req) => {
        capturedRequestId = req.requestId
        return new Promise((resolve) => {
          resolveEnhance = resolve
        })
      },
      cancel: async () => undefined
    })

    const { rerender } = render(
      <TooltipProvider>
        <IdePromptEnhancerPreview
          conversation={conv}
          worktreeSelector="id:wt-1"
          workspacePath="/workspace"
          worktreeId="wt-1"
        />
        <IdePromptEnhancerButton
          conversation={conv}
          worktreeSelector="id:wt-1"
          workspacePath="/workspace"
          worktreeId="wt-1"
          hasDraftText={false}
        />
      </TooltipProvider>
    )

    const btn = screen.getByTestId('ide-enhance-prompt-btn')
    expect(btn).toBeDisabled()

    act(() => {
      useIdeAgentStore.getState().setDraft(conv.id, 'صلح الاداء')
    })
    rerender(
      <TooltipProvider>
        <IdePromptEnhancerPreview
          conversation={conv}
          worktreeSelector="id:wt-1"
          workspacePath="/workspace"
          worktreeId="wt-1"
        />
        <IdePromptEnhancerButton
          conversation={conv}
          worktreeSelector="id:wt-1"
          workspacePath="/workspace"
          worktreeId="wt-1"
          hasDraftText
        />
      </TooltipProvider>
    )

    expect(btn).not.toBeDisabled()
    const mouseDownEvt = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(mouseDownEvt)
    expect(mouseDownEvt.defaultPrevented).toBe(true)

    act(() => {
      fireEvent.click(btn)
    })

    expect(screen.getByTestId('ide-enhance-enhancing-banner')).toBeInTheDocument()
    expect(btn).toHaveAttribute('aria-busy', 'true')

    act(() => {
      useIdeAgentStore.getState().setDraft(conv.id, 'صلح الاداء واكتب ملاحظة اضافية اثناء التحسين')
      useIdePromptEnhancerStore
        .getState()
        .notifyDraftChanged(conv.id, 'صلح الاداء واكتب ملاحظة اضافية اثناء التحسين')
    })
    expect(btn).not.toBeDisabled()

    await act(async () => {
      resolveEnhance?.({
        ok: true,
        requestId: capturedRequestId,
        enhancedPrompt: 'أصلح مشكلة الأداء في `IdeAiChatView.tsx` وتحقق من الاختبارات.',
        agentId: 'claude',
        modelId: 'claude-sonnet-4-5'
      })
    })

    expect(useIdeAgentStore.getState().draftsByConversation[conv.id]).toBe(
      'صلح الاداء واكتب ملاحظة اضافية اثناء التحسين'
    )
    const previewCard = screen.getByTestId('ide-enhance-preview-card')
    expect(previewCard).toHaveTextContent('AI Enhanced Prompt')
    const previewText = screen.getByTestId('ide-enhance-preview-text')
    expect(previewText).toHaveAttribute('dir', 'rtl')

    fireEvent.click(screen.getByTestId('ide-enhance-apply-btn'))
    expect(useIdeAgentStore.getState().draftsByConversation[conv.id]).toBe(
      'أصلح مشكلة الأداء في `IdeAiChatView.tsx` وتحقق من الاختبارات.'
    )

    fireEvent.click(screen.getByTestId('ide-enhance-restore-btn'))
    expect(useIdeAgentStore.getState().draftsByConversation[conv.id]).toBe(
      'صلح الاداء واكتب ملاحظة اضافية اثناء التحسين'
    )
  })
})
