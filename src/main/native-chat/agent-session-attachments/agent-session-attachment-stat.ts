import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import { openAuthorizedDocPreviewTarget } from '../../../shared/document-preview/doc-preview-file-access'
import { parseAgentSessionAttachmentStorePath } from './agent-session-attachment-references'

export type AgentSessionAttachmentStatResult = {
  exists: boolean
  sizeBytes: number | null
}

function isErrnoWithCode(error: unknown, codes: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  return typeof error.code === 'string' && codes.includes(error.code)
}

function isInsideCanonicalRoot(canonicalRoot: string, canonicalTarget: string): boolean {
  const rel = relative(canonicalRoot, canonicalTarget)
  if (rel === '') {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Reports existence and byte size solely for committed paths inside the store root. */
export async function statAgentSessionAttachment(
  root: string,
  path: string
): Promise<AgentSessionAttachmentStatResult> {
  if (path.split(/[\\/]/).includes('..') || !parseAgentSessionAttachmentStorePath(root, path)) {
    throw new Error('Not a committed chat attachment')
  }
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(root)
  } catch (error) {
    if (isErrnoWithCode(error, ['ENOENT', 'ENOTDIR'])) {
      return { exists: false, sizeBytes: null }
    }
    throw error
  }
  try {
    const linkStats = await lstat(path)
    if (linkStats.isSymbolicLink()) {
      throw new Error('Not a committed chat attachment')
    }
  } catch (error) {
    if (!isErrnoWithCode(error, ['ENOENT', 'ENOTDIR'])) {
      throw error
    }
  }
  try {
    const { handle, stats } = await openAuthorizedDocPreviewTarget({
      boundaryPath: root,
      entryPath: path,
      targetPath: path,
      implicitRootPath: null,
      authorizedRootPaths: []
    })
    try {
      return { exists: true, sizeBytes: stats.size }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (!isErrnoWithCode(error, ['ENOENT', 'ENOTDIR'])) {
      throw error
    }
    try {
      const canonicalParent = await realpath(dirname(path))
      if (!isInsideCanonicalRoot(canonicalRoot, canonicalParent)) {
        throw new Error('Not a committed chat attachment')
      }
    } catch (parentError) {
      if (!isErrnoWithCode(parentError, ['ENOENT', 'ENOTDIR'])) {
        throw parentError
      }
    }
    return { exists: false, sizeBytes: null }
  }
}
