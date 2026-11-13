import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { SidebarHeaderActions } from './sidebar-header-actions'

type SidebarHeaderProps = {
  activityBadgeTarget?: React.Ref<HTMLSpanElement>
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  activityOptionsTarget?: React.Ref<HTMLDivElement>
  projectsCollapseTarget?: React.Ref<HTMLDivElement>
}

const SidebarHeader = React.memo(function SidebarHeader({
  activityBadgeTarget,
  onWorkspaceBoardMenuOpenChange,
  activityOptionsTarget,
  projectsCollapseTarget
}: SidebarHeaderProps) {
  const t = useTranslate()
  useTranslation()
  const groupBy = useAppStore((state) => state.groupBy)
  const sidebarTitle =
    groupBy === 'repo'
      ? t('dashboard.sidebar.repositories', 'Repositories')
      : t('dashboard.sidebar.workspaces', 'Workspaces')

  return (
    <div className="group/sidebar-header mt-2 flex h-8 min-w-0 shrink-0 items-center justify-between gap-1.5 px-2">
      <div
        className="flex min-w-0 items-center"
        data-contextual-tour-target={groupBy === 'repo' ? 'projects-collapse-all' : undefined}
      >
        <span
          className="min-w-0 truncate select-none pl-2 pr-0.5 text-xs font-medium text-muted-foreground"
          data-sidebar-section-title={groupBy === 'repo' ? 'projects' : 'workspaces'}
        >
          {sidebarTitle}
        </span>
        <div ref={projectsCollapseTarget} className="flex shrink-0 items-center empty:hidden" />
        <span ref={activityBadgeTarget} className="sr-only" />
      </div>
      <SidebarHeaderActions
        onWorkspaceBoardMenuOpenChange={onWorkspaceBoardMenuOpenChange}
        activityOptionsTarget={activityOptionsTarget}
      />
    </div>
  )
})

export default SidebarHeader
