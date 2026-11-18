// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  IdeConversation,
  IdeConversationSummary
} from '../../../../../shared/ide-agent/ide-agent-types'

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (s: { ideFollowAgent: boolean; setIdeFollowAgent: () => void }) => unknown) =>
      selector({ ideFollowAgent: true, setIdeFollowAgent: () => undefined }),
    {
      getState: () => ({ ideFollowAgent: true, setIdeFollowAgent: () => undefined })
    }
  )
}))

import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useIdeChatTabsStore } from '@/store/ide-agent/ide-chat-tabs-store'
import { IdeChatTabsBar } from './IdeChatTabsBar'

function makeConv(id: string, title: string): IdeConversation {
  return {
    id,
    workspaceKey: 'ws-tabs',
    workspacePath: '/workspace',
    title,
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

function toSummary(conv: IdeConversation): IdeConversationSummary {
  return {
    id: conv.id,
    workspaceKey: conv.workspaceKey,
    title: conv.title,
    mode: conv.mode,
    agentId: conv.agentId,
    modelId: conv.modelId,
    status: conv.status,
    messageCount: 0,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt
  }
}

describe('IdeChatTabsBar multi-tab AI chat', () => {
  const originalCreate = useIdeAgentStore.getState().createNewConversation
  const originalSelect = useIdeAgentStore.getState().selectConversation

  beforeEach(() => {
    window.localStorage.clear()
    useIdeChatTabsStore.setState({ openTabIdsByWorkspace: {} })
  })

  afterEach(() => {
    cleanup()
    useIdeAgentStore.setState({
      createNewConversation: originalCreate,
      selectConversation: originalSelect
    })
  })

  it('opens new AI chat tabs side-by-side on + click, switches between tabs, and closes cleanly', async () => {
    const conv1 = makeConv('c-1', 'شايف المشروع')
    const conv2 = makeConv('c-2', 'New Chat 2')
    const allConvs = new Map<string, IdeConversation>([
      [conv1.id, conv1],
      [conv2.id, conv2]
    ])

    useIdeAgentStore.setState({
      activeConversation: conv1,
      conversations: [toSummary(conv1)],
      createNewConversation: async () => {
        useIdeChatTabsStore.getState().ensureTabOpen('ws-tabs', conv2.id)
        useIdeAgentStore.setState({
          activeConversation: conv2,
          conversations: [toSummary(conv2), toSummary(conv1)]
        })
        return conv2
      },
      selectConversation: async (id: string) => {
        const next = allConvs.get(id) ?? null
        if (next) {
          useIdeAgentStore.setState({ activeConversation: next })
        }
      }
    })

    const renderStrip = () => {
      const state = useIdeAgentStore.getState()
      return (
        <TooltipProvider>
          <IdeChatTabsBar
            conversation={state.activeConversation}
            conversations={state.conversations}
            workspaceKey="ws-tabs"
            workspacePath="/workspace"
            editingTabId={null}
            titleDraft=""
            onTitleDraftChange={() => undefined}
            onStartRename={() => undefined}
            onCommitRename={() => undefined}
            onCancelRename={() => undefined}
          />
        </TooltipProvider>
      )
    }

    const { rerender } = render(renderStrip())
    expect(screen.getAllByTestId('ide-chat-tab-item')).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByTestId('ide-new-chat-btn'))
    })
    rerender(renderStrip())

    const tabs = screen.getAllByTestId('ide-chat-tab-item')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('شايف المشروع')
    expect(tabs[1]).toHaveTextContent('New Chat 2')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')

    await act(async () => {
      fireEvent.click(screen.getByText('شايف المشروع'))
    })
    rerender(renderStrip())
    expect(screen.getAllByTestId('ide-chat-tab-item')[0]).toHaveAttribute('aria-selected', 'true')

    const closeButtons = screen.getAllByTestId('ide-close-chat-tab-btn')
    await act(async () => {
      fireEvent.click(closeButtons[0]!)
    })
    rerender(renderStrip())
    const remaining = screen.getAllByTestId('ide-chat-tab-item')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toHaveTextContent('New Chat 2')
    expect(remaining[0]).toHaveAttribute('aria-selected', 'true')
  })
})
