import React from 'react'
import { AppIcon, type AppIconName } from '@/components/icons/app-icon'
import { RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME } from '@/components/right-sidebar/right-sidebar-titlebar-drag-regions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import type {
  IdeConversation,
  IdeConversationSummary,
  IdeRightSidebarView
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeWorkspaceChatOptionsMenu } from './IdeChatHeader'
import { IdeChatHistoryMenu } from './IdeChatHistoryMenu'

const IDE_PRIMARY_VIEWS: {
  id: IdeRightSidebarView
  label: string
  shortLabel: string
  icon: AppIconName
}[] = [
  { id: 'ai-chat', label: 'AI Chat', shortLabel: 'Chat', icon: 'messages' },
  { id: 'task-plan', label: 'Task Plans', shortLabel: 'Plans', icon: 'taskPlan' },
  { id: 'code-changes', label: 'Code Changes', shortLabel: 'Changes', icon: 'changes' }
]

const IDE_UTILITY_VIEWS: {
  id: IdeRightSidebarView
  label: string
  shortLabel: string
  icon: AppIconName
}[] = [
  { id: 'ai-activity', label: 'Agent Activity', shortLabel: 'Activity', icon: 'activity' },
  {
    id: 'execution-history',
    label: 'Checks & Runs',
    shortLabel: 'Checks',
    icon: 'executionHistory'
  },
  { id: 'simple-todo', label: 'Workspace Todo', shortLabel: 'Todo', icon: 'todo' }
]

export function IdeRightSidebarTopBar({
  activeView,
  onSelectView,
  pendingPlansBadgeCount,
  pendingChangesCount,
  activeConversation,
  conversations,
  providersLoading,
  workspaceKey,
  worktreeSelector,
  onStartRenameActive,
  onSyncTodoFromPlan,
  closeButton
}: {
  activeView: IdeRightSidebarView
  onSelectView: (view: IdeRightSidebarView) => void
  pendingPlansBadgeCount: number
  pendingChangesCount: number
  activeConversation: IdeConversation | null
  conversations: IdeConversationSummary[]
  providersLoading: boolean
  workspaceKey: string | null
  worktreeSelector: string | null
  onStartRenameActive: () => void
  onSyncTodoFromPlan: () => void
  closeButton: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-[38px] min-h-[38px] items-center justify-between gap-1.5 border-b border-border/70 bg-muted/20 px-2 right-sidebar-header-inset right-sidebar-header-drag">
      <div
        className={cn(
          'inline-flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-border/60 bg-background/70 p-0.5 shadow-2xs scrollbar-none',
          RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME
        )}
        role="tablist"
        aria-label="IDE Right Sidebar Views"
      >
        {IDE_PRIMARY_VIEWS.map((view) => {
          const active = activeView === view.id
          const badgeCount =
            view.id === 'task-plan'
              ? pendingPlansBadgeCount
              : view.id === 'code-changes'
                ? pendingChangesCount
                : 0
          return (
            <Tooltip key={view.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={view.label}
                  data-testid={`ide-sidebar-tab-${view.id}`}
                  onClick={() => onSelectView(view.id)}
                  className={cn(
                    'relative inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-2xs font-medium transition-colors',
                    active
                      ? 'bg-accent text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:bg-accent/45 hover:text-foreground'
                  )}
                >
                  <AppIcon name={view.icon} className="size-3.5 shrink-0" />
                  <span
                    className={cn(
                      'truncate',
                      active ? 'inline' : 'hidden @[380px]/ide-right:inline'
                    )}
                  >
                    {view.shortLabel}
                  </span>
                  {badgeCount > 0 ? (
                    <span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground px-1 text-3xs font-semibold leading-none text-background tabular-nums">
                      {badgeCount}
                    </span>
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{view.label}</TooltipContent>
            </Tooltip>
          )
        })}

        <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/60" />

        {IDE_UTILITY_VIEWS.map((view) => {
          const active = activeView === view.id
          return (
            <Tooltip key={view.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={view.label}
                  data-testid={`ide-sidebar-tab-${view.id}`}
                  onClick={() => onSelectView(view.id)}
                  className={cn(
                    'relative inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-2xs font-medium transition-colors',
                    active
                      ? 'bg-accent text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:bg-accent/45 hover:text-foreground'
                  )}
                >
                  <AppIcon name={view.icon} className="size-3.5 shrink-0" />
                  {active ? <span className="truncate">{view.shortLabel}</span> : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{view.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME
        )}
      >
        <IdeChatHistoryMenu
          conversation={activeConversation}
          conversations={conversations}
          workspaceKey={workspaceKey}
          onSelectChat={() => onSelectView('ai-chat')}
        />
        <IdeWorkspaceChatOptionsMenu
          conversation={activeConversation}
          providersLoading={providersLoading}
          workspaceKey={workspaceKey}
          worktreeSelector={worktreeSelector}
          onStartRenameActive={onStartRenameActive}
          onSyncTodoFromPlan={onSyncTodoFromPlan}
        />
        {closeButton}
      </div>
    </div>
  )
}
