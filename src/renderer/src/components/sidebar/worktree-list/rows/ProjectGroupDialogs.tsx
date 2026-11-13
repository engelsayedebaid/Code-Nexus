import React from 'react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { findRepoForHost } from '@/store/repos/repo-host-identity'
import type { AppState } from '@/store/types'
import { isGitRepoKind } from '../../../../../../shared/repo-kind'
import type { Repo } from '../../../../../../shared/repo-types'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import { ProjectGroupDeleteDialog } from './ProjectGroupDeleteDialog'
import SuppressExternalWorktreeInboxDialog from '../listing/SuppressExternalWorktreeInboxDialog'
import type { NewExternalWorktreesInboxActionState } from '../listing/new-external-worktrees-inbox-actions'
import type { ProjectGroupDialogs, ProjectGroupNameDialogState } from './use-project-group-dialogs'

function resolveNameDialogCopy(nameDialog: ProjectGroupNameDialogState | null, t: Translate) {
  if (nameDialog?.type === 'rename-repo') {
    const isGit = isGitRepoKind(nameDialog.repo)
    return {
      title: isGit
        ? t('auto.components.sidebar.WorktreeList.renameProject', 'Rename Project')
        : t('auto.components.sidebar.WorktreeList.renameWorkspace', 'Rename Workspace'),
      description: isGit
        ? t(
            'auto.components.sidebar.WorktreeList.renameProjectDesc',
            'Update the project name shown in the sidebar. The folder on disk stays the same.'
          )
        : t(
            'auto.components.sidebar.WorktreeList.renameWorkspaceDesc',
            'Update the workspace name shown in the sidebar. The folder on disk stays the same.'
          ),
      inputLabel: isGit
        ? t('auto.components.sidebar.ProjectGroupNameDialog.projectNameLabel', 'Project Name')
        : t('auto.components.sidebar.ProjectGroupNameDialog.workspaceNameLabel', 'Workspace Name'),
      initialName: nameDialog.repo.displayName,
      confirmLabel: t('auto.components.sidebar.ProjectGroupNameDialog.rename', 'Rename')
    }
  }
  if (nameDialog?.type === 'rename') {
    return {
      title: t('auto.components.sidebar.WorktreeList.f9dc6cc5d3', 'Rename Project Group'),
      description: t(
        'auto.components.sidebar.WorktreeList.bc1460beb3',
        'Update the group name shown in the sidebar.'
      ),
      inputLabel: undefined,
      initialName: nameDialog.currentName,
      confirmLabel: t('auto.components.sidebar.ProjectGroupNameDialog.rename', 'Rename')
    }
  }
  return {
    title: t('auto.components.sidebar.WorktreeList.13757c053c', 'New Project Group'),
    description: t(
      'auto.components.sidebar.WorktreeList.d880ea0744',
      'Create a group and move this project into it.'
    ),
    inputLabel: undefined,
    initialName: nameDialog
      ? t('auto.components.sidebar.ProjectGroupNameDialog.defaultGroupName', '{{name}} group', {
          name: nameDialog.repo.displayName
        })
      : '',
    confirmLabel: t('auto.components.sidebar.ProjectGroupNameDialog.create', 'Create')
  }
}

export function SidebarWorktreeListDialogs({
  dialogs,
  repos,
  settings,
  suppressExternalWorktreeInboxRepoId,
  setSuppressExternalWorktreeInboxRepoId,
  newExternalWorktreeInboxActionState,
  onConfirmSuppressExternalWorktreeInbox,
  onOpenWorktreeVisibility
}: {
  dialogs: ProjectGroupDialogs
  repos: readonly Repo[]
  settings: AppState['settings']
  suppressExternalWorktreeInboxRepoId: string | null
  setSuppressExternalWorktreeInboxRepoId: (repoId: string | null) => void
  newExternalWorktreeInboxActionState: ReadonlyMap<string, NewExternalWorktreesInboxActionState>
  onConfirmSuppressExternalWorktreeInbox: () => void
  onOpenWorktreeVisibility: (repo: Repo) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { nameDialog, setNameDialog, deleteDialog, setDeleteDialog } = dialogs
  const nameDialogCopy = resolveNameDialogCopy(nameDialog, t)
  return (
    <>
      <ProjectGroupNameDialog
        open={nameDialog !== null}
        title={nameDialogCopy.title}
        description={nameDialogCopy.description}
        inputLabel={nameDialogCopy.inputLabel}
        initialName={nameDialogCopy.initialName}
        confirmLabel={nameDialogCopy.confirmLabel}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialog(null)
          }
        }}
        onSubmit={dialogs.handleSubmitProjectGroupName}
      />
      <SuppressExternalWorktreeInboxDialog
        open={suppressExternalWorktreeInboxRepoId !== null}
        repoDisplayName={
          suppressExternalWorktreeInboxRepoId
            ? (repos.find((repo) => repo.id === suppressExternalWorktreeInboxRepoId)?.displayName ??
              '')
            : ''
        }
        pending={
          suppressExternalWorktreeInboxRepoId
            ? (newExternalWorktreeInboxActionState.get(suppressExternalWorktreeInboxRepoId)
                ?.pending ?? false)
            : false
        }
        onOpenChange={(open) => {
          if (!open) {
            setSuppressExternalWorktreeInboxRepoId(null)
          }
        }}
        onConfirm={onConfirmSuppressExternalWorktreeInbox}
        onOpenRecovery={() => {
          if (!suppressExternalWorktreeInboxRepoId) {
            return
          }
          const repo = findRepoForHost(repos, suppressExternalWorktreeInboxRepoId, { settings })
          setSuppressExternalWorktreeInboxRepoId(null)
          if (repo) {
            onOpenWorktreeVisibility(repo)
          }
        }}
      />
      <ProjectGroupDeleteDialog
        open={deleteDialog !== null}
        groupName={deleteDialog?.groupName ?? ''}
        projectCount={dialogs.deleteProjectCount}
        projectNames={dialogs.deleteProjectNames}
        removeContainedProjects={dialogs.removeContainedProjects}
        onRemoveContainedProjectsChange={(removeContainedProjects) => {
          setDeleteDialog((current) =>
            current ? { ...current, removeContainedProjects } : current
          )
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialog(null)
          }
        }}
        onConfirm={dialogs.handleConfirmDeleteProjectGroup}
        unsavedTargets={dialogs.deleteUnsavedTargets}
      />
    </>
  )
}
