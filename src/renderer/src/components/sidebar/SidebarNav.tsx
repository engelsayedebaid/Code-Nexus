import React from 'react'
import { BrainCircuit, CalendarClock, MessageSquarePlus, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { openCouncilWorkspace } from '@/components/council/council-workspace-event'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import { HideSidebarMenu } from './sidebar-nav-controls'

const SidebarNav = React.memo(function SidebarNav() {
  const t = useTranslate()
  useTranslation()
  const openAutomationsPage = useAppStore((state) => state.openAutomationsPage)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const setActivePendingWorktreeCreation = useAppStore(
    (state) => state.setActivePendingWorktreeCreation
  )
  const setActiveView = useAppStore((state) => state.setActiveView)
  const setActiveWorktree = useAppStore((state) => state.setActiveWorktree)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const activeView = useAppStore((state) => state.activeView)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const activeGroupId = useAppStore((state) =>
    state.activeWorktreeId
      ? (state.activeGroupIdByWorktree[state.activeWorktreeId] ??
        state.groupsByWorktree[state.activeWorktreeId]?.[0]?.id)
      : undefined
  )
  const showAutomations = useAppStore((state) => state.settings?.showAutomationsButton !== false)
  const navRow =
    'flex w-full h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-normal tracking-tight transition-colors'
  const idleRow =
    'text-worktree-sidebar-foreground/85 hover:bg-worktree-sidebar-accent/70 hover:text-worktree-sidebar-foreground'

  return (
    <nav
      className="flex flex-col gap-0.5 px-2 pb-1.5 pt-1"
      data-contextual-tour-target="sidebar-navigation"
      aria-label={t('sidebar.navigation', 'Navigation')}
    >
      <button
        type="button"
        onClick={() => {
          setActivePendingWorktreeCreation(null)
          setActiveWorktree(null)
          setActiveView('terminal')
        }}
        className={cn(
          navRow,
          activeView === 'terminal' && !activeWorktreeId
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : idleRow
        )}
      >
        <MessageSquarePlus className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">{t('sidebar.newChat', 'New Chat')}</span>
      </button>
      <button
        type="button"
        disabled={!activeWorktreeId || !activeGroupId}
        onClick={() => {
          if (activeWorktreeId && activeGroupId) {
            openCouncilWorkspace({ workspaceId: activeWorktreeId, groupId: activeGroupId })
          }
        }}
        className={cn(navRow, idleRow, 'disabled:cursor-not-allowed disabled:opacity-35')}
        title={
          activeWorktreeId && activeGroupId
            ? undefined
            : t('sidebar.councilRequiresWorkspace', 'Open a workspace to start AI Council')
        }
      >
        <BrainCircuit className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">{t('sidebar.aiCouncil', 'AI Council')}</span>
      </button>
      {showAutomations ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              onClick={openAutomationsPage}
              aria-current={activeView === 'automations' ? 'page' : undefined}
              className={cn(
                navRow,
                activeView === 'automations'
                  ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                  : idleRow
              )}
            >
              <CalendarClock className="size-4 shrink-0" strokeWidth={1.75} />
              <span className="flex-1">
                {t('auto.components.sidebar.SidebarNav.f323383e9a', 'Automations')}
              </span>
            </button>
          </ContextMenuTrigger>
          <HideSidebarMenu onHide={() => void updateSettings({ showAutomationsButton: false })} />
        </ContextMenu>
      ) : null}
      <button
        type="button"
        onClick={openSettingsPage}
        aria-current={activeView === 'settings' ? 'page' : undefined}
        className={cn(
          navRow,
          activeView === 'settings'
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : idleRow
        )}
      >
        <SlidersHorizontal className="size-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">{t('sidebar.customize', 'Customize')}</span>
      </button>
    </nav>
  )
})

export default SidebarNav
