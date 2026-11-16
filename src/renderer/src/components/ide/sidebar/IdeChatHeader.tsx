import { useState } from 'react'
import { AppIcon } from '@/components/icons/app-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeExecutionMode
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeRunStatusControls } from './IdeRunStatusControls'
import { IdeChatHistoryMenu } from './IdeChatHistoryMenu'

export function IdeChatHeader({
  conversation,
  conversations,
  providersLoading,
  workspaceKey,
  workspacePath,
  worktreeSelector,
  onSyncTodoFromPlan
}: {
  conversation: IdeConversation | null
  conversations: IdeConversationSummary[]
  providersLoading: boolean
  workspaceKey: string | null
  workspacePath: string | null
  worktreeSelector: string | null
  onSyncTodoFromPlan?: () => void
}) {
  const ideFollowAgent = useAppStore((s) => s.ideFollowAgent)
  const setIdeFollowAgent = useAppStore((s) => s.setIdeFollowAgent)
  const createNewConversation = useIdeAgentStore((s) => s.createNewConversation)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const refreshProviders = useIdeAgentStore((s) => s.refreshProviders)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const activeMode: IdeExecutionMode = conversation?.mode ?? 'agent'

  const handleNewChat = async () => {
    if (!workspaceKey || !workspacePath) {
      return
    }
    await createNewConversation({
      workspaceKey,
      workspacePath,
      mode: activeMode
    })
  }

  const handleCommitTitle = async () => {
    setEditingTitle(false)
    if (!conversation) {
      return
    }
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== conversation.title) {
      await updateSettings({ conversationId: conversation.id, title: trimmed })
    }
  }

  const startRename = () => {
    if (!conversation) {
      return
    }
    setTitleDraft(conversation.title)
    setEditingTitle(true)
  }

  return (
    <TooltipProvider>
      <div className="space-y-1.5 border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {editingTitle && conversation ? (
              <div className="flex flex-1 items-center gap-1">
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleCommitTitle()
                    } else if (e.key === 'Escape') {
                      setEditingTitle(false)
                    }
                  }}
                  onBlur={() => void handleCommitTitle()}
                  className="h-6 text-xs px-1.5"
                  autoFocus
                />
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void handleCommitTitle()}
                  aria-label="Save title"
                >
                  <AppIcon name="confirm" className="size-3" />
                </Button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={startRename}
                  disabled={!conversation}
                  data-testid="ide-conversation-title"
                  title={conversation ? 'Rename conversation' : 'New AI Chat'}
                  className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs font-semibold text-foreground transition-colors hover:bg-accent/60 disabled:hover:bg-transparent"
                >
                  <span className="truncate">{conversation?.title ?? 'New AI Chat'}</span>
                  {conversation ? (
                    <AppIcon name="edit" className="size-3 text-muted-foreground/60" />
                  ) : null}
                </button>
                {conversation?.multiAgentEnabled ? (
                  <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[9.5px]">
                    <AppIcon name="team" className="size-2.5" />
                    Team
                  </Badge>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <IdeChatHistoryMenu conversation={conversation} conversations={conversations} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  disabled={!workspaceKey || !workspacePath}
                  onClick={() => void handleNewChat()}
                  data-testid="ide-new-chat-btn"
                  aria-label="New Chat"
                >
                  <AppIcon name="newChat" size="xs" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Chat</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Chat options"
                  data-testid="ide-chat-options-btn"
                >
                  <AppIcon name="moreOptions" size="xs" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[11px]">Workspace Controls</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={ideFollowAgent}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked)
                    setIdeFollowAgent(next)
                    if (conversation) {
                      void updateSettings({ conversationId: conversation.id, followAgent: next })
                    }
                  }}
                >
                  <AppIcon name="followAgent" className="mr-2 size-3.5" />
                  Follow Agent in Editor
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={conversation?.multiAgentEnabled ?? false}
                  disabled={!conversation}
                  onCheckedChange={(checked) => {
                    if (conversation) {
                      void updateSettings({
                        conversationId: conversation.id,
                        multiAgentEnabled: Boolean(checked)
                      })
                    }
                  }}
                >
                  <AppIcon name="team" className="mr-2 size-3.5" />
                  Team Mode (Multi-Agent)
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px]">Live Edit Speed</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={conversation?.liveEditSpeed ?? 'natural'}
                  onValueChange={(value) => {
                    if (conversation) {
                      void updateSettings({
                        conversationId: conversation.id,
                        liveEditSpeed: value as 'natural' | 'fast' | 'instant'
                      })
                    }
                  }}
                >
                  <DropdownMenuRadioItem value="natural">Natural</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="fast">Fast</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="instant">Instant</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {conversation ? (
                  <DropdownMenuItem onSelect={startRename}>
                    <AppIcon name="edit" className="mr-2 size-3.5" />
                    Rename Conversation
                  </DropdownMenuItem>
                ) : null}
                {onSyncTodoFromPlan && conversation?.activePlanId ? (
                  <DropdownMenuItem onSelect={onSyncTodoFromPlan}>
                    <AppIcon name="sparkles" className="mr-2 size-3.5" />
                    Send Plan Steps to Simple Todo
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={providersLoading}
                  onSelect={() => void refreshProviders(worktreeSelector ?? undefined)}
                >
                  <AppIcon name="retry" className="mr-2 size-3.5" />
                  Refresh AI Models
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <IdeRunStatusControls conversation={conversation} />
      </div>
    </TooltipProvider>
  )
}
