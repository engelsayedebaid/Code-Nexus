import React, { memo } from 'react'
import { X } from 'lucide-react'
import { AgentTypeIcon } from '@/components/agent/icons/agent-type-icon'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import { useAppStore } from '@/store'

const MAX_SIDEBAR_CLOSED_CHATS = 5
const stopBubble = (e: React.SyntheticEvent): void => {
  e.stopPropagation()
}

export const WorktreeCardClosedChats = memo(function WorktreeCardClosedChats({
  worktreeId,
  className
}: {
  worktreeId: string
  className?: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const closedChats = useAppStore((s) => s.recentlyClosedChatTabsByWorktree?.[worktreeId])
  const openTabs = useAppStore((s) => s.unifiedTabsByWorktree?.[worktreeId])
  const reopenClosedChatTabById = useAppStore((s) => s.reopenClosedChatTabById)
  const dismissClosedChatTab = useAppStore((s) => s.dismissClosedChatTab)

  if (!closedChats || closedChats.length === 0) {
    return null
  }

  const openSessionIds = new Set(
    (openTabs ?? []).filter((tab) => tab.contentType === 'agent-session').map((tab) => tab.entityId)
  )
  const visible = closedChats
    .filter((entry) => !openSessionIds.has(entry.sessionId))
    .slice(0, MAX_SIDEBAR_CLOSED_CHATS)

  if (visible.length === 0) {
    return null
  }

  return (
    <div
      className={cn('flex flex-col gap-0.5', className)}
      onClick={stopBubble}
      onDoubleClick={stopBubble}
      onMouseDown={stopBubble}
      onPointerDown={stopBubble}
      role="group"
      aria-label={t('sidebar.closedChats', 'Saved Chats')}
      data-worktree-closed-chats="true"
    >
      {visible.map((entry) => (
        <div
          key={entry.id}
          className="group/closed-chat flex min-w-0 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-accent/60"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              reopenClosedChatTabById?.(worktreeId, entry.sessionId)
            }}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 py-0.5 text-left"
            title={entry.label}
          >
            <AgentTypeIcon
              agentType={entry.agent ?? null}
              size={12}
              className="size-3 shrink-0 opacity-75"
            />
            <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-muted-foreground group-hover/closed-chat:text-foreground">
              {entry.label}
            </span>
          </button>
          <span className="shrink-0 pr-0.5 text-[11px] tabular-nums text-muted-foreground/75 group-hover/closed-chat:hidden">
            {formatShortTimeAgo(entry.closedAt)}
          </span>
          <button
            type="button"
            aria-label={t('sidebar.dismissClosedChat', 'Remove saved chat')}
            onClick={(e) => {
              e.stopPropagation()
              dismissClosedChatTab?.(worktreeId, entry.sessionId)
            }}
            className="hidden shrink-0 rounded p-0.5 text-muted-foreground/75 hover:bg-accent hover:text-foreground group-hover/closed-chat:inline-flex"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
})
