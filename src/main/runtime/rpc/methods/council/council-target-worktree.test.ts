import { describe, expect, it, vi } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { resolveCouncilTargetWorktree } from './council-target-worktree'

describe('resolveCouncilTargetWorktree', () => {
  it('resolves raw local folder workspace paths via folder:<id> when worktree lookup returns selector_not_found', async () => {
    const resolveRuntimeFileTarget = vi.fn(async (selector: string) => {
      if (selector === '/folders/test') {
        throw new Error('selector_not_found')
      }
      if (selector === 'folder:folder-1') {
        return {
          worktree: { path: '/folders/test' },
          executionHostId: LOCAL_EXECUTION_HOST_ID
        }
      }
      throw new Error(`unexpected selector: ${selector}`)
    })
    const runtime = {
      resolveRuntimeFileTarget,
      requireStore: () => ({
        getFolderWorkspaces: () => [
          {
            id: 'folder-1',
            name: 'test',
            folderPath: '/folders/test',
            connectionId: null,
            executionHostId: null
          }
        ],
        getProjectGroups: () => [],
        getRepos: () => []
      })
    } as unknown as OrcaRuntimeService

    const resolved = await resolveCouncilTargetWorktree(runtime, '/folders/test')
    expect(resolved).toEqual({
      worktree: { path: '/folders/test' },
      executionHostId: LOCAL_EXECUTION_HOST_ID
    })
    expect(resolveRuntimeFileTarget).toHaveBeenCalledWith('folder:folder-1')
  })

  it('rejects remote folder workspace paths instead of falling back locally', async () => {
    const runtime = {
      resolveRuntimeFileTarget: vi.fn(async () => {
        throw new Error('selector_not_found')
      }),
      requireStore: () => ({
        getFolderWorkspaces: () => [
          {
            id: 'folder-ssh',
            name: 'remote',
            folderPath: '/srv/remote',
            connectionId: 'ssh-conn-1',
            executionHostId: 'ssh:ssh-conn-1'
          }
        ],
        getProjectGroups: () => [],
        getRepos: () => []
      })
    } as unknown as OrcaRuntimeService

    await expect(resolveCouncilTargetWorktree(runtime, '/srv/remote')).rejects.toThrow(
      /remote hosts require a newer Code Nexus runtime/
    )
  })
})
