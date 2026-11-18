import { useEffect, useMemo, useRef } from 'react'
import { GitPullRequest, ListTodo, MessageSquare, Plus, Sparkles, X } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useIdeChatTabsStore } from '@/store/ide-agent/ide-chat-tabs-store'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode,
  IdeRunStatus
} from '../../../../../shared/ide-agent/ide-agent-types'

const EMPTY_TAB_IDS: readonly string[] = []

function isRunningStatus(status: IdeRunStatus): boolean {
  return (
    status === 'analyzing' ||
    status === 'planning' ||
    status === 'executing' ||
    status === 'verifying'
  )
}

function ModeTabIcon({ mode, running }: { mode: IdeExecutionMode; running: boolean }) {
  if (running) {
    return <LoadingSpinner className="size-3 shrink-0 text-foreground" />
  }
  if (mode === 'plan') {
    return <ListTodo className="size-3 shrink-0 opacity-75" />
  }
  if (mode === 'ask') {
    return <MessageSquare className="size-3 shrink-0 opacity-75" />
  }
  if (mode === 'review') {
    return <GitPullRequest className="size-3 shrink-0 opacity-75" />
  }
  return <Sparkles className="size-3 shrink-0 opacity-75" />
}

export function IdeChatTabsBar({
  conversation,
  conversations,
  workspaceKey,
  workspacePath,
  editingTabId,
  titleDraft,
  onTitleDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onSwitchToChatView
}: {
  conversation: IdeConversation | null
  conversations: IdeConversationSummary[]
  workspaceKey: string | null
  workspacePath: string | null
  editingTabId: string | null
  titleDraft: string
  onTitleDraftChange: (value: string) => void
  onStartRename: (convId: string, currentTitle: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onSwitchToChatView?: () => void
}): React.JSX.Element {
  const selectConversation = useIdeAgentStore((s) => s.selectConversation)
  const createNewConversation = useIdeAgentStore((s) => s.createNewConversation)

  const openTabIds = useIdeChatTabsStore((s) =>
    workspaceKey ? (s.openTabIdsByWorkspace[workspaceKey] ?? EMPTY_TAB_IDS) : EMPTY_TAB_IDS
  )
  const syncWorkspaceTabs = useIdeChatTabsStore((s) => s.syncWorkspaceTabs)
  const closeTab = useIdeChatTabsStore((s) => s.closeTab)

  const stripRef = useRef<HTMLDivElement | null>(null)
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  const skipBlurCommitRef = useRef(false)

  useEffect(() => {
    if (!workspaceKey) {
      return
    }
    const availableIds = conversations.map((c) => c.id)
    if (conversation && !availableIds.includes(conversation.id)) {
      availableIds.push(conversation.id)
    }
    syncWorkspaceTabs(workspaceKey, availableIds, conversation?.id ?? null)
  }, [workspaceKey, conversations, conversation, syncWorkspaceTabs])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [conversation?.id, openTabIds.length])

  const openTabs = useMemo(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]))
    const resolved: IdeConversationSummary[] = []
    for (const id of openTabIds) {
      const found = byId.get(id)
      if (found) {
        resolved.push(
          conversation && conversation.id === id
            ? {
                ...found,
                title: conversation.title,
                mode: conversation.mode,
                status: conversation.status
              }
            : found
        )
      } else if (conversation && conversation.id === id) {
        resolved.push({
          id: conversation.id,
          workspaceKey: conversation.workspaceKey,
          title: conversation.title,
          mode: conversation.mode,
          agentId: conversation.agentId,
          modelId: conversation.modelId,
          status: conversation.status,
          messageCount: conversation.messages.length,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        })
      }
    }
    if (resolved.length === 0 && conversation) {
      resolved.push({
        id: conversation.id,
        workspaceKey: conversation.workspaceKey,
        title: conversation.title,
        mode: conversation.mode,
        agentId: conversation.agentId,
        modelId: conversation.modelId,
        status: conversation.status,
        messageCount: conversation.messages.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      })
    }
    return resolved
  }, [openTabIds, conversations, conversation])

  const handleNewChatTab = async (): Promise<void> => {
    if (!workspaceKey || !workspacePath) {
      return
    }
    onSwitchToChatView?.()
    await createNewConversation({
      workspaceKey,
      workspacePath,
      mode: conversation?.mode ?? 'agent'
    })
  }

  const handleCloseTab = async (tabId: string): Promise<void> => {
    if (!workspaceKey) {
      return
    }
    const nextActiveId = closeTab(workspaceKey, tabId)
    if (conversation?.id !== tabId) {
      return
    }
    if (nextActiveId) {
      await selectConversation(nextActiveId)
      return
    }
    if (workspacePath) {
      await createNewConversation({
        workspaceKey,
        workspacePath,
        mode: conversation.mode
      })
    }
  }

  return (
    <div
      dir="ltr"
      data-testid="ide-chat-tabs-bar"
      className="flex h-8 min-h-8 shrink-0 items-end justify-between gap-1 border-b border-border/70 bg-muted/25 px-1.5 pt-1 text-left"
    >
      <div
        ref={stripRef}
        role="tablist"
        aria-label="AI Chat Tabs"
        onWheel={(e) => {
          if (stripRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            stripRef.current.scrollLeft += e.deltaY
          }
        }}
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto scrollbar-none"
      >
        {openTabs.map((tab) => {
          const isActive = tab.id === conversation?.id
          const isEditing = editingTabId === tab.id
          const running = isRunningStatus(tab.status)

          return (
            <div
              key={tab.id}
              ref={isActive ? activeTabRef : undefined}
              role="tab"
              aria-selected={isActive}
              data-testid="ide-chat-tab-item"
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void handleCloseTab(tab.id)
                }
              }}
              className={cn(
                'group/ctab relative flex h-7 max-w-[188px] min-w-[96px] shrink-0 select-none items-center gap-1.5 rounded-t-md border-x border-t px-2 text-xs transition-colors',
                isActive
                  ? '-mb-px border-border/80 bg-background pb-[1px] font-medium text-foreground shadow-2xs'
                  : 'border-transparent bg-transparent text-muted-foreground hover:bg-background/55 hover:text-foreground'
              )}
            >
              {isEditing ? (
                <Input
                  value={titleDraft}
                  onChange={(e) => onTitleDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      skipBlurCommitRef.current = true
                      onCommitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      skipBlurCommitRef.current = true
                      onCancelRename()
                    }
                  }}
                  onBlur={() => {
                    if (skipBlurCommitRef.current) {
                      skipBlurCommitRef.current = false
                      return
                    }
                    onCommitRename()
                  }}
                  density="compact"
                  className="h-5 min-w-[84px] px-1 text-xs"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  data-testid={isActive ? 'ide-conversation-title' : undefined}
                  onClick={() => {
                    onSwitchToChatView?.()
                    if (!isActive) {
                      void selectConversation(tab.id)
                    }
                  }}
                  onDoubleClick={() => onStartRename(tab.id, tab.title)}
                  title={`${tab.title} — Double-click to rename`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
                >
                  <ModeTabIcon mode={tab.mode} running={running} />
                  <span dir="auto" className="min-w-0 flex-1 truncate">
                    {tab.title || 'New Chat'}
                  </span>
                </button>
              )}

              {!isEditing ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  data-testid="ide-close-chat-tab-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleCloseTab(tab.id)
                  }}
                  className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none',
                    isActive
                      ? 'opacity-70 hover:opacity-100'
                      : 'opacity-0 group-hover/ctab:opacity-80'
                  )}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          )
        })}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!workspaceKey || !workspacePath}
              onClick={() => void handleNewChatTab()}
              data-testid="ide-new-chat-btn"
              aria-label="New AI Chat Tab"
              className="mb-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            New AI Chat Tab
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
