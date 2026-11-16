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
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeConversationSummary
} from '../../../../../shared/ide-agent/ide-agent-types'

export function IdeChatHistoryMenu({
  conversation,
  conversations
}: {
  conversation: IdeConversation | null
  conversations: IdeConversationSummary[]
}) {
  const selectConversation = useIdeAgentStore((s) => s.selectConversation)
  const deleteConversation = useIdeAgentStore((s) => s.deleteConversation)

  return (
    <DropdownMenu>
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
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          Conversation History ({conversations.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="scrollbar-sleek max-h-60 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            conversations.map((summary) => (
              <DropdownMenuItem
                key={summary.id}
                className="flex items-center justify-between gap-2 text-xs"
                onSelect={() => void selectConversation(summary.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {summary.id === conversation?.id ? (
                      <AppIcon name="confirm" className="size-3 text-foreground" />
                    ) : null}
                    <span className="truncate font-medium">{summary.title}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {summary.mode.toUpperCase()} · {summary.messageCount} msgs
                  </div>
                </div>
                {conversations.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Delete ${summary.title}`}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      void deleteConversation(summary.id)
                    }}
                  >
                    <AppIcon name="delete" className="size-3" />
                  </button>
                ) : null}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
