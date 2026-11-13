import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import { submitProjectGroupNameDialog } from './project-group-name-submit'

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: toastError }
}))

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/tmp/workspace',
    displayName: 'Test',
    badgeColor: '#599ce7',
    addedAt: 1,
    kind: 'folder',
    ...overrides
  }
}

describe('submitProjectGroupNameDialog rename-repo', () => {
  beforeEach(() => {
    toastError.mockReset()
  })

  it('calls updateRepo with the new displayName and owner hostId', async () => {
    const mutations = {
      createProjectGroup: vi.fn(),
      moveProjectToGroup: vi.fn(),
      updateProjectGroup: vi.fn(),
      updateRepo: vi.fn(async () => true)
    }
    const repo = makeRepo({ id: 'remote-repo', executionHostId: 'runtime:devbox' })

    await submitProjectGroupNameDialog({ type: 'rename-repo', repo }, 'Renamed Box', mutations)

    expect(mutations.updateRepo).toHaveBeenCalledTimes(1)
    expect(mutations.updateRepo).toHaveBeenCalledWith(
      'remote-repo',
      { displayName: 'Renamed Box' },
      { hostId: 'runtime:devbox' }
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('skips updateRepo when the name is unchanged', async () => {
    const mutations = {
      createProjectGroup: vi.fn(),
      moveProjectToGroup: vi.fn(),
      updateProjectGroup: vi.fn(),
      updateRepo: vi.fn(async () => true)
    }
    const repo = makeRepo({ displayName: 'Test' })

    await submitProjectGroupNameDialog({ type: 'rename-repo', repo }, 'Test', mutations)

    expect(mutations.updateRepo).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('reports an error toast when updateRepo fails', async () => {
    const mutations = {
      createProjectGroup: vi.fn(),
      moveProjectToGroup: vi.fn(),
      updateProjectGroup: vi.fn(),
      updateRepo: vi.fn(async () => false)
    }
    const repo = makeRepo({ kind: 'git' })

    await submitProjectGroupNameDialog({ type: 'rename-repo', repo }, 'Renamed Repo', mutations)

    expect(mutations.updateRepo).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledTimes(1)
  })
})
