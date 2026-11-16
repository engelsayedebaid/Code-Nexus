import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { runtimePathsEqual } from '../../../workspaces/catalog/runtime-worktree-path-identity'
import {
  deriveFolderWorkspaceHost,
  folderCatalogOf,
  matchFolderWorkspaceRows
} from '../../../workspaces/catalog/workspace-selector-candidates'

/** Resolves a Git worktree, local folder workspace path, or floating directory for Council RPCs. */
export async function resolveCouncilTargetWorktree(runtime: OrcaRuntimeService, worktree: string) {
  try {
    return await runtime.resolveRuntimeFileTarget(worktree)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'selector_not_found') {
      throw error
    }
    const catalog = folderCatalogOf(runtime.requireStore())
    const folderMatches = matchFolderWorkspaceRows(`path:${worktree}`, catalog.folderWorkspaces)
    const localFolder = folderMatches.find(
      (folder) => deriveFolderWorkspaceHost(catalog, folder)?.hostId === LOCAL_EXECUTION_HOST_ID
    )
    if (localFolder) {
      return await runtime.resolveRuntimeFileTarget(folderWorkspaceKey(localFolder.id))
    }
    if (folderMatches.length > 0) {
      throw new Error('Council text tasks on remote hosts require a newer Carver runtime.')
    }
    const floating = await runtime.resolveRuntimeFileTarget('floating').catch(() => null)
    if (floating && runtimePathsEqual(floating.worktree.path, worktree)) {
      return floating
    }
    throw error
  }
}
