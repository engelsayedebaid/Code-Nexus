import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { resolveIdeWorkspaceSnapshot } from '@/lib/ide-agent/ide-agent-live-sync'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { cn } from '@/lib/class-names'
import type { IdeTodoItem } from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeAlertCard } from './IdeAlertCard'
import { IdeChatHeader } from './IdeChatHeader'
import { IdeRightSidebarTopBar } from './IdeRightSidebarTopBar'
import { IdeAiChatView } from './IdeAiChatView'
import { IdeAgentActivityView } from './IdeAgentActivityView'
import { IdeTaskPlanView } from './IdeTaskPlanView'
import { IdeSimpleTodoPanel } from './IdeSimpleTodoPanel'
import { IdeCodeChangesView } from './IdeCodeChangesView'
import { IdeExecutionHistoryView } from './IdeExecutionHistoryView'

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
  const lastError = useIdeAgentStore((s) => s.lastError)
  const clearError = useIdeAgentStore((s) => s.clearError)
  const refreshProviders = useIdeAgentStore((s) => s.refreshProviders)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const ensureWorkspaceInitialized = useIdeAgentStore((s) => s.ensureWorkspaceInitialized)
  const saveTodos = useIdeAgentStore((s) => s.saveTodos)

  const [todoSyncRevision, setTodoSyncRevision] = useState(0)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')

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
  const awaitingPlansCount = (activeConversation?.plans ?? []).filter(
    (p) => p.status === 'awaiting_approval'
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
        text: `${step.index + 1}. ${step.title}`,
        done: step.status === 'completed',
        linkedPlanId: plan.id,
        linkedStepId: step.id,
        createdAt: now,
        updatedAt: now
      }))
    if (appended.length > 0) {
      void saveTodos(effectiveWorkspace.workspaceKey, [...existing, ...appended])
    }
    setTodoSyncRevision((rev) => rev + 1)
    setIdeSidebarView('simple-todo')
  }

  const handleCommitRename = (): void => {
    const targetId = editingTabId
    setEditingTabId(null)
    if (!targetId) {
      return
    }
    const trimmed = titleDraft.trim()
    const existingTitle =
      activeConversation?.id === targetId
        ? activeConversation.title
        : conversations.find((c) => c.id === targetId)?.title
    if (trimmed && trimmed !== existingTitle) {
      void updateSettings({ conversationId: targetId, title: trimmed })
    }
  }

  const latestMessageError = activeConversation?.messages.at(-1)?.error
  const showBannerAlert =
    Boolean(lastError) &&
    !(ideSidebarView === 'ai-chat' && latestMessageError && latestMessageError === lastError)

  return (
    <div
      dir="ltr"
      className="@container/ide-right flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background text-left"
    >
      <IdeRightSidebarTopBar
        activeView={ideSidebarView}
        onSelectView={setIdeSidebarView}
        pendingPlansBadgeCount={pendingPermissionsCount + awaitingPlansCount}
        pendingChangesCount={pendingChangesCount}
        activeConversation={activeConversation}
        conversations={conversations}
        providersLoading={providersLoading}
        workspaceKey={effectiveWorkspace?.workspaceKey ?? null}
        worktreeSelector={effectiveWorkspace?.worktreeSelector ?? null}
        onStartRenameActive={() => {
          if (activeConversation) {
            setTitleDraft(activeConversation.title)
            setEditingTabId(activeConversation.id)
          }
        }}
        onSyncTodoFromPlan={handleSyncTodoFromPlan}
        closeButton={closeButton}
      />

      <IdeChatHeader
        conversation={activeConversation}
        conversations={conversations}
        workspaceKey={effectiveWorkspace?.workspaceKey ?? null}
        workspacePath={effectiveWorkspace?.workspacePath ?? null}
        activeView={ideSidebarView}
        editingTabId={editingTabId}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onStartRename={(convId, currentTitle) => {
          setTitleDraft(currentTitle)
          setEditingTabId(convId)
        }}
        onCommitRename={handleCommitRename}
        onCancelRename={() => setEditingTabId(null)}
        onSwitchToChatView={() => {
          if (ideSidebarView !== 'ai-chat') {
            setIdeSidebarView('ai-chat')
          }
        }}
      />

      {showBannerAlert && lastError ? (
        <div className="border-b border-border/60 px-2.5 py-2">
          <IdeAlertCard
            error={lastError}
            conversation={activeConversation}
            providers={providers}
            providersLoading={providersLoading}
            onDismiss={clearError}
            onRefreshModels={() =>
              void refreshProviders(effectiveWorkspace?.worktreeSelector ?? undefined)
            }
            onSelectFallbackModel={({ agentId, modelId }) => {
              clearError()
              if (activeConversation) {
                void updateSettings({
                  conversationId: activeConversation.id,
                  agentId,
                  modelId
                })
              }
            }}
          />
        </div>
      ) : null}

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
            providersLoading={providersLoading}
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
            syncRevision={todoSyncRevision}
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
