import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  classifySensitiveFilePath,
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import {
  applySearchReplacePatches,
  applyUnifiedDiffPatch,
  preserveTextLineEndingsAndBom,
  type SearchReplacePatch
} from '../../shared/ide-agent/ide-patch-chunker'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import { resolveSafeWorkspacePath } from './ide-workspace-path-guard'

const MAX_CONTEXT_FILE_BYTES = 192 * 1024

export type WorkspaceWriteResult =
  | {
      ok: true
      relativePath: string
      sha256: string
      created: boolean
      persistedContent: string
    }
  | {
      ok: false
      reason: 'dirty_conflict' | 'disk_conflict' | 'policy_blocked' | 'io_error'
      message: string
    }

export type WorkspaceReadResult =
  | { ok: true; content: string | null; sha256: string | null }
  | {
      ok: false
      reason: 'secret_blocked' | 'unsafe_path' | 'too_large' | 'read_error'
      message: string
    }

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function statIfPresent(fullPath: string) {
  try {
    return await stat(fullPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function readWorkspaceTextFileSafe(
  workspacePath: string,
  rawRelativePath: string,
  options?: { allowSecretRead?: boolean }
): Promise<WorkspaceReadResult> {
  if (isUnsafeRelativePath(rawRelativePath)) {
    return {
      ok: false,
      reason: 'unsafe_path',
      message: `Refusing unsafe path "${rawRelativePath}".`
    }
  }
  const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
  if (
    !options?.allowSecretRead &&
    classifySensitiveFilePath(normalized, 'read-context') === 'send_secret_context'
  ) {
    return {
      ok: false,
      reason: 'secret_blocked',
      message: `Reading secret/credential file "${normalized}" requires explicit user permission.`
    }
  }
  try {
    const fullPath = await resolveSafeWorkspacePath(workspacePath, normalized)
    const info = await statIfPresent(fullPath)
    if (!info) {
      return { ok: true, content: null, sha256: null }
    }
    if (info.isDirectory()) {
      return { ok: false, reason: 'read_error', message: `"${normalized}" is a directory.` }
    }
    if (info.size > MAX_CONTEXT_FILE_BYTES) {
      return {
        ok: false,
        reason: 'too_large',
        message: `"${normalized}" exceeds ${MAX_CONTEXT_FILE_BYTES} bytes.`
      }
    }
    const content = await readFile(fullPath, 'utf8')
    return { ok: true, content, sha256: sha256Text(content) }
  } catch (error) {
    return {
      ok: false,
      reason: 'read_error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function writeWorkspaceTextFileSafe(
  workspacePath: string,
  rawRelativePath: string,
  content: string,
  options: {
    mode: IdeExecutionMode
    expectedBeforeSha: string | null
    dirtyRelativePaths?: ReadonlySet<string>
    allowSecretWrite?: boolean
  }
): Promise<WorkspaceWriteResult> {
  if (options.mode !== 'agent') {
    return {
      ok: false,
      reason: 'policy_blocked',
      message: `File writes are prohibited in ${options.mode} mode.`
    }
  }
  if (isUnsafeRelativePath(rawRelativePath)) {
    return {
      ok: false,
      reason: 'policy_blocked',
      message: `Unsafe relative path "${rawRelativePath}".`
    }
  }
  const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
  if (
    !options.allowSecretWrite &&
    classifySensitiveFilePath(normalized, 'write') === 'modify_secrets'
  ) {
    return {
      ok: false,
      reason: 'policy_blocked',
      message: `Modifying secret file "${normalized}" requires explicit user permission.`
    }
  }
  const dirtyMatch = options.dirtyRelativePaths
    ? Array.from(options.dirtyRelativePaths).some(
        (entry) => normalizeWorkspaceRelativePath(entry).toLowerCase() === normalized.toLowerCase()
      )
    : false
  if (dirtyMatch) {
    return {
      ok: false,
      reason: 'dirty_conflict',
      message: `"${normalized}" has unsaved changes in the editor. Save or discard your edits before applying agent changes.`
    }
  }
  try {
    const fullPath = await resolveSafeWorkspacePath(workspacePath, normalized)
    const info = await statIfPresent(fullPath)
    const existed = info !== null
    const currentContent = existed ? await readFile(fullPath, 'utf8') : null
    const currentSha = currentContent === null ? null : sha256Text(currentContent)
    if (currentSha !== options.expectedBeforeSha) {
      return {
        ok: false,
        reason: 'disk_conflict',
        message: `"${normalized}" changed on disk while agent edits were in progress.`
      }
    }
    const persistedContent = preserveTextLineEndingsAndBom(currentContent, content)
    await mkdir(dirname(fullPath), { recursive: true })
    const tempPath = `${fullPath}.carver-tmp-${process.pid}-${Date.now()}`
    await writeFile(tempPath, persistedContent, 'utf8')
    try {
      await rename(tempPath, fullPath)
    } catch (renameErr) {
      const code =
        renameErr && typeof renameErr === 'object' && 'code' in renameErr
          ? renameErr.code
          : undefined
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        await new Promise((r) => setTimeout(r, 40))
        await writeFile(fullPath, persistedContent, 'utf8')
        await rm(tempPath, { force: true }).catch(() => {})
      } else {
        await rm(tempPath, { force: true }).catch(() => {})
        throw renameErr
      }
    }
    return {
      ok: true,
      relativePath: normalized,
      sha256: sha256Text(persistedContent),
      created: !existed,
      persistedContent
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'io_error',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function applyWorkspaceFilePatchesSafe(
  workspacePath: string,
  rawRelativePath: string,
  patches: readonly SearchReplacePatch[],
  options: {
    mode: IdeExecutionMode
    expectedBeforeSha: string | null
    dirtyRelativePaths?: ReadonlySet<string>
    allowSecretWrite?: boolean
    unifiedDiff?: string
  }
): Promise<
  | { ok: true; relativePath: string; sha256: string; beforeContent: string; afterContent: string }
  | { ok: false; reason: string; message: string }
> {
  const readRes = await readWorkspaceTextFileSafe(workspacePath, rawRelativePath, {
    allowSecretRead: options.allowSecretWrite
  })
  if (!readRes.ok) {
    return { ok: false, reason: readRes.reason, message: readRes.message }
  }
  if (readRes.content === null) {
    return {
      ok: false,
      reason: 'io_error',
      message: `Cannot patch non-existent file "${rawRelativePath}".`
    }
  }
  const patched = options.unifiedDiff
    ? applyUnifiedDiffPatch(readRes.content, options.unifiedDiff)
    : applySearchReplacePatches(readRes.content, patches)
  if (!patched.ok) {
    return { ok: false, reason: 'invalid_patch', message: patched.reason }
  }
  const writeRes = await writeWorkspaceTextFileSafe(
    workspacePath,
    rawRelativePath,
    patched.content,
    {
      ...options,
      expectedBeforeSha: options.expectedBeforeSha ?? readRes.sha256
    }
  )
  if (!writeRes.ok) {
    return { ok: false, reason: writeRes.reason, message: writeRes.message }
  }
  return {
    ok: true,
    relativePath: writeRes.relativePath,
    sha256: writeRes.sha256,
    beforeContent: readRes.content,
    afterContent: writeRes.persistedContent
  }
}

export async function deleteWorkspaceFileSafe(
  workspacePath: string,
  rawRelativePath: string,
  options: { mode: IdeExecutionMode }
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (options.mode !== 'agent') {
    return { ok: false, message: `Deletions are prohibited in ${options.mode} mode.` }
  }
  try {
    const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
    const fullPath = await resolveSafeWorkspacePath(workspacePath, normalized)
    const info = await statIfPresent(fullPath)
    if (!info) {
      return { ok: true }
    }
    await rm(fullPath, { force: false })
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
