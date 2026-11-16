import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { resolveIdeWorkspaceSnapshot } from '@/lib/ide-agent/ide-agent-live-sync'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { cn } from '@/lib/class-names'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME } from '@/components/right-sidebar/right-sidebar-titlebar-drag-regions'
import type {
  IdeRightSidebarView,
  IdeTodoItem
} from '../../../../../shared/ide-agent/ide-agent-types'
import { AppIcon, type AppIconName } from '@/components/icons/app-icon'
import { IdeChatHeader } from './IdeChatHeader'
import { IdeAiChatView } from './IdeAiChatView'
import { IdeAgentActivityView } from './IdeAgentActivityView'
import { IdeTaskPlanView } from './IdeTaskPlanView'
import { IdeSimpleTodoPanel } from './IdeSimpleTodoPanel'
import { IdeCodeChangesView } from './IdeCodeChangesView'
import { IdeExecutionHistoryView } from './IdeExecutionHistoryView'

const IDE_SIDEBAR_VIEWS: {
  id: IdeRightSidebarView
  label: string
  icon: AppIconName
}[] = [
  { id: 'ai-chat', label: 'AI Chat', icon: 'messages' },
  { id: 'ai-activity', label: 'Activity', icon: 'activity' },
  { id: 'task-plan', label: 'Task Plan', icon: 'taskPlan' },
  { id: 'simple-todo', label: 'Simple Todo', icon: 'todo' },
  { id: 'code-changes', label: 'Changes', icon: 'changes' },
  { id: 'execution-history', label: 'History', icon: 'executionHistory' }
]

type ScratchWorkspaceTarget = {
  workspaceKey: string
  workspacePath: string
  worktreeSelector: string
}

export function IdeRightSidebarWorkspace({ closeButton }: { closeButton: React.ReactNode }) {
  const ideSidebarView = useAppStore((s) => s.ideSidebarView)
  const setIdeSidebarView = useAppStore((s) => s.setIdeSidebarView)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const activeWorkspaceExecutionHostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)

  const providers = useIdeAgentStore((s) => s.providers)
  const providersLoading = useIdeAgentStore((s) => s.providersLoading)
  const conversations = useIdeAgentStore((s) => s.conversations)
  const activeConversation = useIdeAgentStore((s) => s.activeConversation)
  const todosByWorkspace = useIdeAgentStore((s) => s.todosByWorkspace)
  const ensureWorkspaceInitialized = useIdeAgentStore((s) => s.ensureWorkspaceInitialized)
  const saveTodos = useIdeAgentStore((s) => s.saveTodos)

  const activeWorkspace = useMemo(
    () =>
      resolveIdeWorkspaceSnapshot({
        activeWorktreeId,
        worktreesByRepo,
        folderWorkspaces,
        activeWorkspaceExecutionHostId
      }),
    [activeWorktreeId, worktreesByRepo, folderWorkspaces, activeWorkspaceExecutionHostId]
  )

  // No open folder/worktree still gets a chat: the host's private scratch folder acts as the workspace.
  const [scratchWorkspace, setScratchWorkspace] = useState<ScratchWorkspaceTarget | null>(null)
  useEffect(() => {
    if (activeWorkspace) {
      return
    }
    let cancelled = false
    void callRuntimeRpc<{ workspace: ScratchWorkspaceTarget }>(
      { kind: 'local' },
      'ideAgent.scratchWorkspace',
      {}
    )
      .then((res) => {
        if (!cancelled) {
          setScratchWorkspace(res.workspace)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeWorkspace])

  const effectiveWorkspace = useMemo(
    () =>
      activeWorkspace ??
      (scratchWorkspace
        ? {
            worktreeId: scratchWorkspace.worktreeSelector,
            workspaceKey: scratchWorkspace.workspaceKey,
            workspacePath: scratchWorkspace.workspacePath,
            worktreeSelector: scratchWorkspace.worktreeSelector,
            runtimeEnvironmentId: null
          }
        : null),
    [activeWorkspace, scratchWorkspace]
  )
  const isScratchWorkspace = activeWorkspace === null && scratchWorkspace !== null

  useEffect(() => {
    if (!effectiveWorkspace) {
      return
    }
    void ensureWorkspaceInitialized(
      effectiveWorkspace.workspaceKey,
      effectiveWorkspace.workspacePath,
      effectiveWorkspace.worktreeSelector
    )
  }, [effectiveWorkspace, ensureWorkspaceInitialized])

  const pendingPermissionsCount = (activeConversation?.pendingPermissions ?? []).filter(
    (p) => p.status === 'pending'
  ).length
  const pendingChangesCount = (activeConversation?.fileChanges ?? []).filter(
    (c) => c.acceptedState === 'pending'
  ).length

  const handleSyncTodoFromPlan = () => {
    if (!effectiveWorkspace || !activeConversation?.activePlanId) {
      return
    }
    const plan = activeConversation.plans.find((p) => p.id === activeConversation.activePlanId)
    if (!plan) {
      return
    }
    const existing = todosByWorkspace[effectiveWorkspace.workspaceKey] ?? []
    const existingStepIds = new Set(existing.map((t) => t.linkedStepId).filter(Boolean))
    const now = Date.now()
    const appended: IdeTodoItem[] = plan.steps
      .filter((step) => !existingStepIds.has(step.id))
      .map((step) => ({
        id: `todo-${step.id}-${now}`,
        workspaceKey: effectiveWorkspace.workspaceKey,
        text: `${step.index}. ${step.title}`,
        done: step.status === 'completed',
        linkedPlanId: plan.id,
        linkedStepId: step.id,
        createdAt: now,
        updatedAt: now
      }))
    if (appended.length > 0) {
      void saveTodos(effectiveWorkspace.workspaceKey, [...existing, ...appended])
    }
    setIdeSidebarView('simple-todo')
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-[38px] min-h-[38px] items-center justify-between border-b border-border/70 px-1.5 right-sidebar-header-inset right-sidebar-header-drag">
        <div
          className={cn(
            'scrollbar-sleek flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto',
            RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME
          )}
          role="tablist"
          aria-label="IDE Right Sidebar Views"
        >
          {IDE_SIDEBAR_VIEWS.map((view) => {
            const active = ideSidebarView === view.id
            const badgeCount =
              view.id === 'task-plan'
                ? pendingPermissionsCount
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
                    onClick={() => setIdeSidebarView(view.id)}
                    className={cn(
                      'relative inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      active
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}
                  >
                    <AppIcon name={view.icon} />
                    {badgeCount > 0 ? (
                      <span className="absolute -right-1 -top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 text-[8.5px] font-semibold leading-none text-white">
                        {badgeCount}
                      </span>
                    ) : null}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{view.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        <TooltipProvider>
          <div
            className={cn('flex shrink-0 items-center', RIGHT_SIDEBAR_HEADER_NO_DRAG_CLASS_NAME)}
          >
            {closeButton}
          </div>
        </TooltipProvider>
      </div>

      <IdeChatHeader
        conversation={activeConversation}
        conversations={conversations}
        providersLoading={providersLoading}
        workspaceKey={effectiveWorkspace?.workspaceKey ?? null}
        workspacePath={effectiveWorkspace?.workspacePath ?? null}
        worktreeSelector={effectiveWorkspace?.worktreeSelector ?? null}
        onSyncTodoFromPlan={handleSyncTodoFromPlan}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'ai-chat' && 'hidden'
          )}
        >
          <IdeAiChatView
            conversation={activeConversation}
            providers={providers}
            workspaceKey={effectiveWorkspace?.workspaceKey ?? null}
            workspacePath={effectiveWorkspace?.workspacePath ?? null}
            worktreeSelector={effectiveWorkspace?.worktreeSelector ?? null}
            worktreeId={effectiveWorkspace?.worktreeId ?? null}
            isScratchWorkspace={isScratchWorkspace}
          />
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'ai-activity' && 'hidden'
          )}
        >
          <IdeAgentActivityView conversation={activeConversation} />
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'task-plan' && 'hidden'
          )}
        >
          <IdeTaskPlanView conversation={activeConversation} providers={providers} />
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'simple-todo' && 'hidden'
          )}
        >
          <IdeSimpleTodoPanel
            workspaceKey={effectiveWorkspace?.workspaceKey ?? null}
            conversation={activeConversation}
          />
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'code-changes' && 'hidden'
          )}
        >
          <IdeCodeChangesView conversation={activeConversation} />
        </div>

        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            ideSidebarView !== 'execution-history' && 'hidden'
          )}
        >
          <IdeExecutionHistoryView
            conversation={activeConversation}
            worktreeSelector={effectiveWorkspace?.worktreeSelector ?? null}
          />
        </div>
      </div>
    </div>
  )
}
