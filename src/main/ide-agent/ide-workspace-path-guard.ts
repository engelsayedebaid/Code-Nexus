import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import { realpath } from 'node:fs/promises'

export async function resolveSafeWorkspacePath(
  workspacePath: string,
  rawRelativePath: string
): Promise<string> {
  if (isUnsafeRelativePath(rawRelativePath)) {
    throw new Error(`Unsafe workspace path: ${rawRelativePath}`)
  }
  const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
  const rootReal = await realpath(workspacePath)
  const candidate = resolve(rootReal, normalized)
  const normalizedRoot = process.platform === 'win32' ? rootReal.toLowerCase() : rootReal
  const normalizedCandidate = process.platform === 'win32' ? candidate.toLowerCase() : candidate
  const prefix =
    normalizedRoot.endsWith('\\') || normalizedRoot.endsWith('/')
      ? normalizedRoot
      : `${normalizedRoot}${process.platform === 'win32' ? '\\' : '/'}`
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(prefix)) {
    throw new Error(`Path escapes workspace root: ${rawRelativePath}`)
  }
  let probe = candidate
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) {
      break
    }
    probe = parent
  }
  if (existsSync(probe)) {
    const probeReal = await realpath(probe)
    const cmpProbe = process.platform === 'win32' ? probeReal.toLowerCase() : probeReal
    if (cmpProbe !== normalizedRoot && !cmpProbe.startsWith(prefix)) {
      throw new Error(`Symlink target escapes workspace root: ${rawRelativePath}`)
    }
  }
  return candidate
}
