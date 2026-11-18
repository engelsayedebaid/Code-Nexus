import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  classifySensitiveFilePath,
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import {
  listWorkspaceFilesWithRipgrep,
  searchWorkspaceCodeWithRipgrep
} from './harness/ripgrep-workspace-search'

export type CodeSearchMatch = {
  relativePath: string
  line: number
  preview: string
}

export type SafePathResolver = (rawRelativePath: string) => Promise<string>

async function statIfPresent(targetPath: string) {
  try {
    return await stat(targetPath)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function listWorkspaceRelativeFiles(
  workspacePath: string,
  options?: {
    maxFiles?: number
    maxDepth?: number
    includeFolders?: boolean
    pathPrefix?: string
    nameFilter?: string
    signal?: AbortSignal
  }
): Promise<{ files: string[]; folders: string[]; blockedSecretFiles: string[] }> {
  const { files, blockedSecretFiles } = await listWorkspaceFilesWithRipgrep({
    workspacePath,
    maxFiles: options?.maxFiles ?? 1_200,
    pathPrefix: options?.pathPrefix,
    nameFilter: options?.nameFilter,
    signal: options?.signal
  })
  files.sort((a, b) => a.localeCompare(b))
  const foldersSet = new Set<string>()
  if (options?.includeFolders) {
    for (const rel of files) {
      const dir = dirname(rel).replaceAll('\\', '/')
      if (dir && dir !== '.') {
        foldersSet.add(dir)
      }
    }
  }
  return {
    files,
    folders: [...foldersSet].sort((a, b) => a.localeCompare(b)),
    blockedSecretFiles
  }
}

export async function createWorkspaceDirectorySafe(params: {
  rawRelativePath: string
  mode: IdeExecutionMode
  resolveSafePath: SafePathResolver
}): Promise<{ ok: true; relativePath: string; created: boolean } | { ok: false; message: string }> {
  if (params.mode !== 'agent') {
    return { ok: false, message: `Creating folders is prohibited in ${params.mode} mode.` }
  }
  if (isUnsafeRelativePath(params.rawRelativePath)) {
    return { ok: false, message: `Unsafe folder path "${params.rawRelativePath}".` }
  }
  const normalized = normalizeWorkspaceRelativePath(params.rawRelativePath).replace(/\/+$/, '')
  if (!normalized) {
    return { ok: false, message: 'Folder path cannot be empty.' }
  }
  try {
    const fullPath = await params.resolveSafePath(normalized)
    const info = await statIfPresent(fullPath)
    if (info) {
      if (!info.isDirectory()) {
        return { ok: false, message: `"${normalized}" already exists as a file.` }
      }
      return { ok: true, relativePath: normalized, created: false }
    }
    await mkdir(fullPath, { recursive: true })
    return { ok: true, relativePath: normalized, created: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function renameWorkspacePathSafe(params: {
  fromRawPath: string
  toRawPath: string
  mode: IdeExecutionMode
  resolveSafePath: SafePathResolver
  allowSecretMove?: boolean
}): Promise<
  | { ok: true; fromRelativePath: string; toRelativePath: string; isDirectory: boolean }
  | { ok: false; message: string }
> {
  if (params.mode !== 'agent') {
    return { ok: false, message: `Renaming or moving paths is prohibited in ${params.mode} mode.` }
  }
  if (isUnsafeRelativePath(params.fromRawPath) || isUnsafeRelativePath(params.toRawPath)) {
    return { ok: false, message: 'Unsafe source or destination relative path.' }
  }
  const fromRel = normalizeWorkspaceRelativePath(params.fromRawPath).replace(/\/+$/, '')
  const toRel = normalizeWorkspaceRelativePath(params.toRawPath).replace(/\/+$/, '')
  if (!fromRel || !toRel) {
    return { ok: false, message: 'Source and destination paths cannot be empty.' }
  }
  if (
    !params.allowSecretMove &&
    (classifySensitiveFilePath(fromRel, 'write') === 'modify_secrets' ||
      classifySensitiveFilePath(toRel, 'write') === 'modify_secrets')
  ) {
    return { ok: false, message: 'Moving secret files requires explicit permission.' }
  }
  try {
    const fullFrom = await params.resolveSafePath(fromRel)
    const fullTo = await params.resolveSafePath(toRel)
    const fromInfo = await statIfPresent(fullFrom)
    if (!fromInfo) {
      return { ok: false, message: `Source path "${fromRel}" does not exist.` }
    }
    const toInfo = await statIfPresent(fullTo)
    if (fromRel.toLowerCase() !== toRel.toLowerCase() && toInfo !== null) {
      return { ok: false, message: `Destination path "${toRel}" already exists.` }
    }
    await mkdir(dirname(fullTo), { recursive: true })
    await rename(fullFrom, fullTo)
    return {
      ok: true,
      fromRelativePath: fromRel,
      toRelativePath: toRel,
      isDirectory: fromInfo.isDirectory()
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function deleteWorkspaceDirectorySafe(params: {
  rawRelativePath: string
  mode: IdeExecutionMode
  resolveSafePath: SafePathResolver
  recursive?: boolean
}): Promise<{ ok: true; relativePath: string } | { ok: false; message: string }> {
  if (params.mode !== 'agent') {
    return { ok: false, message: `Deleting folders is prohibited in ${params.mode} mode.` }
  }
  if (isUnsafeRelativePath(params.rawRelativePath)) {
    return { ok: false, message: `Unsafe folder path "${params.rawRelativePath}".` }
  }
  const normalized = normalizeWorkspaceRelativePath(params.rawRelativePath).replace(/\/+$/, '')
  if (!normalized || normalized === '.' || normalized === '..') {
    return { ok: false, message: 'Refusing to delete workspace root.' }
  }
  try {
    const fullPath = await params.resolveSafePath(normalized)
    const info = await statIfPresent(fullPath)
    if (!info) {
      return { ok: true, relativePath: normalized }
    }
    if (!info.isDirectory()) {
      return { ok: false, message: `"${normalized}" is not a directory.` }
    }
    await rm(fullPath, { recursive: params.recursive ?? true, force: false })
    return { ok: true, relativePath: normalized }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function searchWorkspaceCodeMatches(params: {
  workspacePath: string
  query: string
  resolveSafePath?: SafePathResolver
  pathPrefix?: string
  caseSensitive?: boolean
  maxResults?: number
  signal?: AbortSignal
}): Promise<CodeSearchMatch[]> {
  return searchWorkspaceCodeWithRipgrep({
    workspacePath: params.workspacePath,
    query: params.query,
    pathPrefix: params.pathPrefix,
    caseSensitive: params.caseSensitive,
    maxResults: params.maxResults,
    signal: params.signal
  })
}
