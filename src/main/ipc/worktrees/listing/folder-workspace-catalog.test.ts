import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import {
  closeTestStores,
  createStore,
  testState
} from '../../../persistence/persistence-test-harness'
import { hostWorktreeTargetForRepo } from '../../../persistence/host-qualified-worktree-meta'
import { getDefaultNoRepoWorkspacePath } from '../../floating-workspace-directory'
import { getFolderWorkspaceInstanceId, getFolderWorkspaceRootId } from '../folder-workspace-model'
import { listFolderWorkspaces } from './folder-workspace-catalog'

function makeFolderRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'folder-repo',
    path: join(testState.dir, 'docs'),
    displayName: 'Docs',
    badgeColor: '#599ce7',
    addedAt: 1,
    kind: 'folder',
    ...overrides
  }
}

describe('listFolderWorkspaces', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-folder-catalog-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('includes the root workspace for ordinary folder projects', () => {
    const store = createStore()
    const repo = makeFolderRepo()

    const listed = listFolderWorkspaces(store, repo)

    expect(listed.map((worktree) => worktree.id)).toEqual([getFolderWorkspaceRootId(repo)])
  })

  it('skips the implicit root workspace for No Repo and lists only explicit chat workspaces', () => {
    const store = createStore()
    const noRepo = makeFolderRepo({
      id: 'no-repo',
      path: getDefaultNoRepoWorkspacePath(),
      displayName: 'No Repo',
      isNoRepo: true
    })

    expect(listFolderWorkspaces(store, noRepo)).toEqual([])

    const chatId = getFolderWorkspaceInstanceId(noRepo, 'chat-1')
    store.setWorktreeMeta(hostWorktreeTargetForRepo(chatId, noRepo), {
      displayName: 'Testing conversation'
    })

    const listed = listFolderWorkspaces(store, noRepo)
    expect(listed.map((worktree) => worktree.id)).toEqual([chatId])
    expect(listed[0]?.displayName).toBe('Testing conversation')
  })

  it('also recognizes local No Repo by its userData directory path when isNoRepo is absent', () => {
    const store = createStore()
    const noRepoByPath = makeFolderRepo({
      id: 'no-repo-path',
      path: getDefaultNoRepoWorkspacePath(),
      displayName: 'No Repo'
    })

    expect(listFolderWorkspaces(store, noRepoByPath)).toEqual([])
  })
})

