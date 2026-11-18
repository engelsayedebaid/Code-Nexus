import { X } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useIdeChatTabsStore } from '@/store/ide-agent/ide-chat-tabs-store'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeLiveEditSpeed,
  IdeRightSidebarView
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeChatTabsBar } from './IdeChatTabsBar'
import { IdeRunStatusControls } from './IdeRunStatusControls'

function isLiveEditSpeed(value: string): value is IdeLiveEditSpeed {
  return value === 'natural' || value === 'fast' || value === 'instant'
}

export function IdeWorkspaceChatOptionsMenu({
  conversation,
  providersLoading,
  workspaceKey,
  worktreeSelector,
  onStartRenameActive,
  onSyncTodoFromPlan
}: {
  conversation: IdeConversation | null
  providersLoading: boolean
  workspaceKey: string | null
  worktreeSelector: string | null
  onStartRenameActive: () => void
  onSyncTodoFromPlan?: () => void
}): React.JSX.Element {
  const ideFollowAgent = useAppStore((s) => s.ideFollowAgent)
  const setIdeFollowAgent = useAppStore((s) => s.setIdeFollowAgent)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const refreshProviders = useIdeAgentStore((s) => s.refreshProviders)
  const openTabCount = useIdeChatTabsStore((s) =>
    workspaceKey ? (s.openTabIdsByWorkspace[workspaceKey]?.length ?? 0) : 0
  )
  const closeOtherTabs = useIdeChatTabsStore((s) => s.closeOtherTabs)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
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
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Workspace & Agent Options
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workspace Controls</DropdownMenuLabel>
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
        <DropdownMenuLabel>Live Edit Speed</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={conversation?.liveEditSpeed ?? 'natural'}
          onValueChange={(value) => {
            if (conversation && isLiveEditSpeed(value)) {
              void updateSettings({
                conversationId: conversation.id,
                liveEditSpeed: value
              })
            }
          }}
        >
          <DropdownMenuRadioItem value="natural" disabled={!conversation}>
            Natural
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="fast" disabled={!conversation}>
            Fast
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="instant" disabled={!conversation}>
            Instant
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {conversation ? (
          <DropdownMenuItem onSelect={onStartRenameActive}>
            <AppIcon name="edit" className="mr-2 size-3.5" />
            Rename Active Tab
          </DropdownMenuItem>
        ) : null}
        {conversation && workspaceKey && openTabCount > 1 ? (
          <DropdownMenuItem onSelect={() => closeOtherTabs(workspaceKey, conversation.id)}>
            <X className="mr-2 size-3.5" />
            Close Other Chat Tabs
          </DropdownMenuItem>
        ) : null}
        {onSyncTodoFromPlan && conversation?.activePlanId ? (
          <DropdownMenuItem onSelect={onSyncTodoFromPlan}>
            <AppIcon name="sparkles" className="mr-2 size-3.5" />
            Send Plan Steps to Todo
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
  )
}

export function IdeChatHeader({
  conversation,
  conversations,
  workspaceKey,
  workspacePath,
  activeView = 'ai-chat',
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
  activeView?: IdeRightSidebarView
  editingTabId: string | null
  titleDraft: string
  onTitleDraftChange: (value: string) => void
  onStartRename: (convId: string, currentTitle: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onSwitchToChatView?: () => void
}): React.JSX.Element {
  const showHeaderRunBanner = activeView !== 'ai-chat'

  return (
    <div className="shrink-0">
      <IdeChatTabsBar
        conversation={conversation}
        conversations={conversations}
        workspaceKey={workspaceKey}
        workspacePath={workspacePath}
        editingTabId={editingTabId}
        titleDraft={titleDraft}
        onTitleDraftChange={onTitleDraftChange}
        onStartRename={onStartRename}
        onCommitRename={onCommitRename}
        onCancelRename={onCancelRename}
        onSwitchToChatView={onSwitchToChatView}
      />

      {showHeaderRunBanner ? (
        <div className="border-b border-border/60 px-2.5 py-1.5">
          <IdeRunStatusControls conversation={conversation} />
        </div>
      ) : null}
    </div>
  )
}
