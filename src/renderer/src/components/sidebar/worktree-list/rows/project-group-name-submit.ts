import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { isGitRepoKind } from '../../../../../../shared/repo-kind'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'

export type ProjectGroupNameDialogState =
  | { type: 'create-from-repo'; repo: Repo }
  | { type: 'rename-repo'; repo: Repo }
  // hostId is the group row's owner host, so the mutation is not routed to whichever host has focus.
  | {
      type: 'rename'
      groupId: string
      currentName: string
      hostId?: ExecutionHostId
    }

type ProjectGroupNameMutations = {
  createProjectGroup: (name: string, hostId: ExecutionHostId) => Promise<ProjectGroup | null>
  moveProjectToGroup: (repo: Repo, groupId: string | null) => Promise<boolean>
  updateProjectGroup: (
    groupId: string,
    updates: { name: string },
    options?: { hostId?: ExecutionHostId }
  ) => Promise<boolean>
  updateRepo: (
    projectId: string,
    updates: { displayName: string },
    options?: { hostId?: ExecutionHostId }
  ) => Promise<boolean>
}

export async function submitProjectGroupNameDialog(
  dialog: ProjectGroupNameDialogState,
  name: string,
  mutations: ProjectGroupNameMutations
): Promise<void> {
  if (dialog.type === 'create-from-repo') {
    const group = await mutations.createProjectGroup(name, getRepoExecutionHostId(dialog.repo))
    if (group) {
      await mutations.moveProjectToGroup(dialog.repo, group.id)
    }
    return
  }
  if (dialog.type === 'rename-repo') {
    if (name === dialog.repo.displayName) {
      return
    }
    const renamed = await mutations.updateRepo(
      dialog.repo.id,
      { displayName: name },
      { hostId: getRepoExecutionHostId(dialog.repo) }
    )
    if (!renamed) {
      toast.error(
        isGitRepoKind(dialog.repo)
          ? translate(
              'auto.components.sidebar.WorktreeList.projectRenameFailed',
              'Failed to rename project'
            )
          : translate(
              'auto.components.sidebar.WorktreeList.workspaceRenameFailed',
              'Failed to rename workspace'
            ),
        {
          description: translate(
            'auto.components.sidebar.WorktreeList.projectRenameFailedDesc',
            'Orca could not confirm the new name with the host. Recheck after reconnecting.'
          )
        }
      )
    }
    return
  }
  const renamed = await mutations.updateProjectGroup(
    dialog.groupId,
    { name },
    { hostId: dialog.hostId }
  )
  if (!renamed) {
    toast.error(
      translate('auto.components.sidebar.WorktreeList.groupRenameFailed', 'Failed to rename group'),
      {
        description: translate(
          'auto.components.sidebar.WorktreeList.groupRenameFailedDesc',
          // Why: a falsy result also covers RPC timeout/disconnect, so the copy must not assert the host refused.
          "Orca could not confirm the new name with the group's host. Recheck the group after reconnecting."
        )
      }
    )
  }
}
