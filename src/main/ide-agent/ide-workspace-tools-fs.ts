import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  classifySensitiveFilePath,
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'

const IGNORED_SEARCH_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

const BINARY_EXT_PATTERN =
  /\.(png|jpe?g|gif|webp|ico|bmp|svgz|woff2?|ttf|eot|otf|pdf|zip|gz|tar|7z|exe|dll|so|dylib|node|bin|mp3|mp4|webm|mov|sqlite|db|lockb)$/i

export type CodeSearchMatch = {
  relativePath: string
  line: number
  preview: string
}

export type SafePathResolver = (rawRelativePath: string) => Promise<string>

export async function listWorkspaceRelativeFiles(
  workspacePath: string,
  options?: { maxFiles?: number; maxDepth?: number; includeFolders?: boolean }
): Promise<{ files: string[]; folders: string[] }> {
  const maxFiles = options?.maxFiles ?? 600
  const maxDepth = options?.maxDepth ?? 7
  const files: string[] = []
  const folders: string[] = []

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > maxDepth || files.length >= maxFiles) {
      return
    }
    const absDir = relDir ? join(workspacePath, relDir) : workspacePath
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break
      }
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_SEARCH_DIRS.has(entry.name)) {
          if (options?.includeFolders) {
            folders.push(relPath)
          }
          await walk(relPath, depth + 1)
        }
      } else if (entry.isFile()) {
        files.push(relPath)
      }
    }
  }

  await walk('', 0)
  return { files, folders }
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
    const existed = existsSync(fullPath)
    if (existed) {
      const info = await stat(fullPath)
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
    if (!existsSync(fullFrom)) {
      return { ok: false, message: `Source path "${fromRel}" does not exist.` }
    }
    if (existsSync(fullTo)) {
      return { ok: false, message: `Destination path "${toRel}" already exists.` }
    }
    const info = await stat(fullFrom)
    await mkdir(dirname(fullTo), { recursive: true })
    await rename(fullFrom, fullTo)
    return {
      ok: true,
      fromRelativePath: fromRel,
      toRelativePath: toRel,
      isDirectory: info.isDirectory()
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
    if (!existsSync(fullPath)) {
      return { ok: true, relativePath: normalized }
    }
    const info = await stat(fullPath)
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
  resolveSafePath: SafePathResolver
  pathPrefix?: string
  caseSensitive?: boolean
  maxResults?: number
}): Promise<CodeSearchMatch[]> {
  const needleRaw = params.query.trim()
  if (!needleRaw) {
    return []
  }
  const maxResults = Math.min(100, Math.max(1, params.maxResults ?? 40))
  const needle = params.caseSensitive ? needleRaw : needleRaw.toLowerCase()
  const prefix = params.pathPrefix
    ? normalizeWorkspaceRelativePath(params.pathPrefix).toLowerCase()
    : ''
  const { files } = await listWorkspaceRelativeFiles(params.workspacePath, { maxFiles: 500 })
  const matches: CodeSearchMatch[] = []

  for (const relPath of files) {
    if (matches.length >= maxResults) {
      break
    }
    if (prefix && !relPath.toLowerCase().startsWith(prefix)) {
      continue
    }
    if (BINARY_EXT_PATTERN.test(relPath)) {
      continue
    }
    if (classifySensitiveFilePath(relPath, 'read-context') === 'send_secret_context') {
      continue
    }
    try {
      const fullPath = await params.resolveSafePath(relPath)
      const info = await stat(fullPath)
      if (!info.isFile() || info.size > 256 * 1024) {
        continue
      }
      const raw = await readFile(fullPath, 'utf8')
      if (raw.includes('\u0000')) {
        continue
      }
      const lines = raw.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i]
        const hay = params.caseSensitive ? lineText : lineText.toLowerCase()
        if (hay.includes(needle)) {
          matches.push({
            relativePath: relPath,
            line: i + 1,
            preview: lineText.trim().slice(0, 220)
          })
          if (matches.length >= maxResults) {
            break
          }
        }
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return matches
}
