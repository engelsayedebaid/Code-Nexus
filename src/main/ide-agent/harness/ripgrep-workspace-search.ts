import { StringDecoder } from 'node:string_decoder'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../shared/ide-agent/ide-plan-policy'
import { parseRipgrepMatchJson } from '../../../shared/ripgrep/ripgrep-dense-match-json'
import { decodeRipgrepLine } from '../../../shared/ripgrep/ripgrep-line-decoding'
import { SEARCH_JSON_STRUCTURE_LIMITS } from '../../../shared/file-search/text-search'
import { wslDistroForCommand } from '../../../shared/wsl-paths'
import { spawnBundledRipgrep } from '../../ripgrep/bundled-ripgrep-spawn'
import { stopBundledRipgrep } from '../../ripgrep/bundled-ripgrep-stop'

export type RipgrepCodeMatch = {
  relativePath: string
  line: number
  preview: string
}

const DEFAULT_EXCLUDED_GLOBS = [
  '!.git/**',
  '!node_modules/**',
  '!dist/**',
  '!out/**',
  '!build/**',
  '!.next/**',
  '!.nuxt/**',
  '!.turbo/**',
  '!coverage/**',
  '!__pycache__/**',
  '!.venv/**',
  '!venv/**',
  '!target/**'
] as const

const RIPGREP_SCAN_TIMEOUT_MS = 12_000
const FILE_LIST_CACHE_TTL_MS = 1_500

type CachedFileListEntry = {
  expiresAt: number
  maxFilesScanned: number
  files: string[]
  blockedSecretFiles: string[]
}

const fileListCache = new Map<string, CachedFileListEntry>()

export function invalidateWorkspaceFileListCache(workspacePath: string): void {
  fileListCache.delete(workspacePath)
}

function baseRipgrepFlags(): string[] {
  const args = ['--no-config', '--no-require-git', '--hidden']
  for (const glob of DEFAULT_EXCLUDED_GLOBS) {
    args.push('--glob', glob)
  }
  return args
}

export async function listWorkspaceFilesWithRipgrep(params: {
  workspacePath: string
  maxFiles?: number
  pathPrefix?: string
  nameFilter?: string
  signal?: AbortSignal
}): Promise<{ files: string[]; blockedSecretFiles: string[] }> {
  if (params.signal?.aborted) {
    return { files: [], blockedSecretFiles: [] }
  }
  const maxFiles = Math.max(1, params.maxFiles ?? 1_500)
  const prefix = params.pathPrefix
    ? normalizeWorkspaceRelativePath(params.pathPrefix).replace(/\/+$/, '').toLowerCase()
    : ''
  const needle = params.nameFilter?.trim().toLowerCase() ?? ''
  const isUnfiltered = !prefix && !needle
  if (isUnfiltered) {
    const cached = fileListCache.get(params.workspacePath)
    if (cached && cached.expiresAt > Date.now() && cached.maxFilesScanned >= maxFiles) {
      return {
        files: cached.files.slice(0, maxFiles),
        blockedSecretFiles: [...cached.blockedSecretFiles]
      }
    }
  }
  const wslDistro = wslDistroForCommand(params.workspacePath) ?? undefined
  const args = [...baseRipgrepFlags(), '--files', '.']

  return await new Promise((resolve) => {
    const files: string[] = []
    const blockedSecretFiles: string[] = []
    const decoder = new StringDecoder('utf8')
    let remainder = ''
    let settled = false

    const child = spawnBundledRipgrep(args, {
      cwd: params.workspacePath,
      wslDistro,
      wslDistroForOutput: wslDistro,
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', onAbort)
      if (isUnfiltered && !params.signal?.aborted) {
        fileListCache.set(params.workspacePath, {
          expiresAt: Date.now() + FILE_LIST_CACHE_TTL_MS,
          maxFilesScanned: maxFiles,
          files: [...files],
          blockedSecretFiles: [...blockedSecretFiles]
        })
      }
      resolve({ files, blockedSecretFiles })
    }

    const onAbort = (): void => {
      stopBundledRipgrep(child, Boolean(wslDistro))
      finish()
    }

    const ingestLine = (rawLine: string): boolean => {
      const cleaned = normalizeWorkspaceRelativePath(rawLine)
      if (!cleaned) {
        return true
      }
      const lower = cleaned.toLowerCase()
      if (
        prefix &&
        lower !== prefix &&
        !lower.startsWith(`${prefix}/`) &&
        !lower.startsWith(prefix)
      ) {
        return true
      }
      if (needle && !lower.includes(needle)) {
        return true
      }
      if (classifySensitiveFilePath(cleaned, 'read-context') === 'send_secret_context') {
        blockedSecretFiles.push(cleaned)
        return true
      }
      files.push(cleaned)
      return files.length < maxFiles
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      remainder += decoder.write(chunk)
      let newlineIdx = remainder.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = remainder.slice(0, newlineIdx).replace(/\r$/, '')
        remainder = remainder.slice(newlineIdx + 1)
        if (!ingestLine(line)) {
          stopBundledRipgrep(child, Boolean(wslDistro))
          finish()
          return
        }
        newlineIdx = remainder.indexOf('\n')
      }
    })

    child.once('error', () => finish())
    child.once('close', () => {
      const tail = (remainder + decoder.end()).trim()
      if (tail && !settled) {
        ingestLine(tail)
      }
      finish()
    })

    params.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      stopBundledRipgrep(child, Boolean(wslDistro))
      finish()
    }, RIPGREP_SCAN_TIMEOUT_MS)
  })
}

export async function searchWorkspaceCodeWithRipgrep(params: {
  workspacePath: string
  query: string
  pathPrefix?: string
  caseSensitive?: boolean
  maxResults?: number
  signal?: AbortSignal
}): Promise<RipgrepCodeMatch[]> {
  const query = params.query.trim()
  if (!query || params.signal?.aborted) {
    return []
  }
  const maxResults = Math.min(120, Math.max(1, params.maxResults ?? 40))
  const prefix = params.pathPrefix
    ? normalizeWorkspaceRelativePath(params.pathPrefix).replace(/\/+$/, '')
    : ''
  const wslDistro = wslDistroForCommand(params.workspacePath) ?? undefined

  const args = [
    ...baseRipgrepFlags(),
    '--json',
    '--fixed-strings',
    '--max-filesize',
    '2M',
    ...(params.caseSensitive ? [] : ['--ignore-case']),
    ...(prefix ? ['--glob', `${prefix}/**`, '--glob', prefix] : []),
    '--',
    query,
    '.'
  ]

  return await new Promise((resolve) => {
    const matches: RipgrepCodeMatch[] = []
    const decoder = new StringDecoder('utf8')
    let remainder = ''
    let settled = false

    const child = spawnBundledRipgrep(args, {
      cwd: params.workspacePath,
      wslDistro,
      wslDistroForOutput: wslDistro,
      stdio: ['ignore', 'pipe', 'ignore']
    })

    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', onAbort)
      resolve(matches)
    }

    const onAbort = (): void => {
      stopBundledRipgrep(child, Boolean(wslDistro))
      finish()
    }

    const ingestJsonLine = (rawLine: string): boolean => {
      if (!rawLine.trim()) {
        return true
      }
      try {
        const msg = parseRipgrepMatchJson(rawLine, 8, SEARCH_JSON_STRUCTURE_LIMITS)
        if (msg.type !== 'match' || !msg.data?.path?.text || !msg.data.lines) {
          return true
        }
        const relPath = normalizeWorkspaceRelativePath(msg.data.path.text)
        if (!relPath) {
          return true
        }
        if (classifySensitiveFilePath(relPath, 'read-context') === 'send_secret_context') {
          return true
        }
        const decoded = decodeRipgrepLine(msg.data.lines)
        matches.push({
          relativePath: relPath,
          line: msg.data.line_number ?? 1,
          preview: decoded.text.trim().slice(0, 220)
        })
        return matches.length < maxResults
      } catch {
        return true
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      remainder += decoder.write(chunk)
      let newlineIdx = remainder.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = remainder.slice(0, newlineIdx)
        remainder = remainder.slice(newlineIdx + 1)
        if (!ingestJsonLine(line)) {
          stopBundledRipgrep(child, Boolean(wslDistro))
          finish()
          return
        }
        newlineIdx = remainder.indexOf('\n')
      }
    })

    child.once('error', () => finish())
    child.once('close', () => {
      const tail = remainder + decoder.end()
      if (tail && !settled) {
        ingestJsonLine(tail)
      }
      finish()
    })

    params.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      stopBundledRipgrep(child, Boolean(wslDistro))
      finish()
    }, RIPGREP_SCAN_TIMEOUT_MS)
  })
}
