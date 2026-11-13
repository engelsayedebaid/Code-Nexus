import React, { useCallback, useRef } from 'react'
import { FolderPlus } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { AddRepoDialogEntryRequest } from './project-admission/dialog/add-repo-dialog-types'
import { AddProjectMenu } from './project-admission/menu/AddProjectMenu'
import SidebarWorkspaceOptionsMenu from './worktree-list/controls/SidebarWorkspaceOptionsMenu'

function AddProjectButton({
  preserveWorkspaceBoardOpen,
  onMenuOpenChange
}: {
  preserveWorkspaceBoardOpen: boolean
  onMenuOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const openModal = useAppStore((state) => state.openModal)
  const label = t('auto.components.sidebar.SidebarHeader.addProject', 'Add project')
  const handleOpenEntryRequest = useCallback(
    (entryRequest: AddRepoDialogEntryRequest) => {
      openModal('add-repo', { entryRequest })
    },
    [openModal]
  )

  return (
    <AddProjectMenu
      side="bottom"
      align="start"
      tooltipLabel={label}
      tooltipSide="bottom"
      preserveWorkspaceBoardOpen={preserveWorkspaceBoardOpen}
      onOpenChange={onMenuOpenChange}
      onOpenEntryRequest={handleOpenEntryRequest}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        className="text-muted-foreground"
        aria-label={label}
        data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
      >
        <FolderPlus className="size-3.5" strokeWidth={2} />
      </Button>
    </AddProjectMenu>
  )
}

export function SidebarHeaderActions({
  onWorkspaceBoardMenuOpenChange,
  activityOptionsTarget
}: {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  agentsViewActive?: boolean
  activityOptionsTarget?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const openMenusRef = useRef({ options: false, addProject: false })
  const updateMenuOpen = useCallback(
    (menu: 'options' | 'addProject', open: boolean) => {
      openMenusRef.current[menu] = open
      onWorkspaceBoardMenuOpenChange(
        openMenusRef.current.options || openMenusRef.current.addProject
      )
    },
    [onWorkspaceBoardMenuOpenChange]
  )

  return (
    <div className="flex shrink-0 items-center gap-1" data-sidebar-header-actions="">
      <div ref={activityOptionsTarget} className="flex size-6 shrink-0 items-center">
        <SidebarWorkspaceOptionsMenu
          preserveWorkspaceBoardOpen
          onMenuOpenChange={(open) => updateMenuOpen('options', open)}
        />
      </div>
      <AddProjectButton
        preserveWorkspaceBoardOpen
        onMenuOpenChange={(open) => updateMenuOpen('addProject', open)}
      />
    </div>
  )
}
