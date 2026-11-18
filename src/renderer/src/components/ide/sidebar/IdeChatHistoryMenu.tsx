import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useIdeChatTabsStore } from '@/store/ide-agent/ide-chat-tabs-store'
import type {
  IdeConversation,
  IdeConversationSummary
} from '../../../../../shared/ide-agent/ide-agent-types'

const EMPTY_OPEN_IDS: readonly string[] = []

export function IdeChatHistoryMenu({
  conversation,
  conversations,
  workspaceKey,
  onSelectChat
}: {
  conversation: IdeConversation | null
  conversations: IdeConversationSummary[]
  workspaceKey?: string | null
  onSelectChat?: () => void
}) {
  const selectConversation = useIdeAgentStore((s) => s.selectConversation)
  const deleteConversation = useIdeAgentStore((s) => s.deleteConversation)
  const openIds = useIdeChatTabsStore((s) =>
    workspaceKey ? (s.openTabIdsByWorkspace[workspaceKey] ?? EMPTY_OPEN_IDS) : EMPTY_OPEN_IDS
  )

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Conversation history"
              data-testid="ide-conversation-history-trigger"
            >
              <AppIcon name="chatHistory" size="xs" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Chat History ({conversations.length})
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-68">
        <DropdownMenuLabel className="flex items-center justify-between text-xs">
          <span>All Conversations</span>
          <span className="font-mono text-3xs font-normal text-muted-foreground">
            {conversations.length}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="scrollbar-sleek max-h-64 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            conversations.map((summary) => {
              const isOpen = openIds.includes(summary.id)
              const isCurrent = summary.id === conversation?.id
              return (
                <div key={summary.id} className="group/hist flex items-center gap-1 pr-1">
                  <DropdownMenuItem
                    className="min-w-0 flex-1 flex-col items-start gap-0.5"
                    onSelect={() => {
                      onSelectChat?.()
                      void selectConversation(summary.id)
                    }}
                  >
                    <div className="flex w-full min-w-0 items-center gap-1.5">
                      {isCurrent ? (
                        <AppIcon name="confirm" className="size-3 shrink-0 text-foreground" />
                      ) : null}
                      <span dir="auto" className="min-w-0 flex-1 truncate font-medium">
                        {summary.title}
                      </span>
                      {isOpen && !isCurrent ? (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-3xs text-muted-foreground">
                          Open
                        </span>
                      ) : null}
                    </div>
                    <div className="text-3xs text-muted-foreground">
                      {summary.mode.toUpperCase()} · {summary.messageCount} msgs
                    </div>
                  </DropdownMenuItem>
                  <button
                    type="button"
                    aria-label={`Delete ${summary.title}`}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/hist:opacity-100 focus-visible:opacity-100"
                    onClick={() => void deleteConversation(summary.id)}
                  >
                    <AppIcon name="delete" className="size-3" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
