import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  classifySensitiveFilePath,
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import { wslDistroForCommand } from '../../shared/wsl-paths'
import { requireLocalRuntimeFileRoute } from '../runtime/files/file-target'
import {
  inspectWorkspaceTree,
  type WorkspaceInspectionSnapshot
} from './ide-workspace-inspector'
import {
  runWorkspaceShellCommand,
  type IdeWorkspaceTarget,
  type WorkspaceCommandRunResult
} from './ide-workspace-shell'

export type { IdeWorkspaceTarget, WorkspaceCommandRunResult } from './ide-workspace-shell'
export type { WorkspaceInspectionSnapshot } from './ide-workspace-inspector'

const MAX_CONTEXT_FILE_BYTES = 128 * 1024

export type WorkspaceWriteResult =
  | { ok: true; relativePath: string; sha256: string; created: boolean }
  | {
      ok: false
      reason: 'dirty_conflict' | 'disk_conflict' | 'policy_blocked' | 'io_error'
      message: string
    }

export type IdeWorkspaceGateway = {
  readonly target: IdeWorkspaceTarget
  inspectWorkspace(hintTerms?: readonly string[]): Promise<WorkspaceInspectionSnapshot>
  readTextFile(
    relativePath: string,
    options?: { allowSecretRead?: boolean }
  ): Promise<
    | { ok: true; content: string | null; sha256: string | null }
    | {
        ok: false
        reason: 'secret_blocked' | 'unsafe_path' | 'too_large' | 'read_error'
        message: string
      }
  >
  writeTextChunk(
    relativePath: string,
    content: string,
    options: {
      mode: IdeExecutionMode
      expectedBeforeSha: string | null
      dirtyRelativePaths?: ReadonlySet<string>
      allowSecretWrite?: boolean
    }
  ): Promise<WorkspaceWriteResult>
  deleteWorkspaceFile(
    relativePath: string,
    options: { mode: IdeExecutionMode }
  ): Promise<{ ok: true } | { ok: false; message: string }>
  getGitDiffSummary(): Promise<string | null>
  runShellCommand(
    command: string,
    options: {
      timeoutMs?: number
      signal?: AbortSignal
      onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void
    }
  ): Promise<WorkspaceCommandRunResult>
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export class LocalIdeWorkspaceGateway implements IdeWorkspaceGateway {
  readonly target: IdeWorkspaceTarget

  constructor(target: IdeWorkspaceTarget) {
    requireLocalRuntimeFileRoute({ executionHostId: target.executionHostId })
    this.target = {
      ...target,
      wslDistro: target.wslDistro ?? wslDistroForCommand(target.workspacePath) ?? undefined
    }
  }

  private async resolveSafeWorkspacePath(rawRelativePath: string): Promise<string> {
    if (isUnsafeRelativePath(rawRelativePath)) {
      throw new Error(`Unsafe workspace path: ${rawRelativePath}`)
    }
    const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
    const rootReal = await realpath(this.target.workspacePath)
    const candidate = resolve(rootReal, normalized)
    const normalizedRoot = process.platform === 'win32' ? rootReal.toLowerCase() : rootReal
    const normalizedCandidate =
      process.platform === 'win32' ? candidate.toLowerCase() : candidate
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

  inspectWorkspace(hintTerms: readonly string[] = []): Promise<WorkspaceInspectionSnapshot> {
    return inspectWorkspaceTree(this.target.workspacePath, hintTerms, (relPath) =>
      this.readTextFile(relPath)
    )
  }

  async readTextFile(
    rawRelativePath: string,
    options?: { allowSecretRead?: boolean }
  ): Promise<
    | { ok: true; content: string | null; sha256: string | null }
    | {
        ok: false
        reason: 'secret_blocked' | 'unsafe_path' | 'too_large' | 'read_error'
        message: string
      }
  > {
    if (isUnsafeRelativePath(rawRelativePath)) {
      return { ok: false, reason: 'unsafe_path', message: `Refusing unsafe path "${rawRelativePath}".` }
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
      const fullPath = await this.resolveSafeWorkspacePath(normalized)
      if (!existsSync(fullPath)) {
        return { ok: true, content: null, sha256: null }
      }
      const info = await stat(fullPath)
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

  async writeTextChunk(
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
      return { ok: false, reason: 'policy_blocked', message: `Unsafe relative path "${rawRelativePath}".` }
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
      const fullPath = await this.resolveSafeWorkspacePath(normalized)
      const existed = existsSync(fullPath)
      const currentContent = existed ? await readFile(fullPath, 'utf8') : null
      const currentSha = currentContent === null ? null : sha256Text(currentContent)
      if (currentSha !== options.expectedBeforeSha) {
        return {
          ok: false,
          reason: 'disk_conflict',
          message: `"${normalized}" changed on disk while agent edits were in progress.`
        }
      }
      await mkdir(dirname(fullPath), { recursive: true })
      const tempPath = `${fullPath}.nexus-tmp-${process.pid}-${Date.now()}`
      await writeFile(tempPath, content, 'utf8')
      await rename(tempPath, fullPath)
      return { ok: true, relativePath: normalized, sha256: sha256Text(content), created: !existed }
    } catch (error) {
      return { ok: false, reason: 'io_error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  async deleteWorkspaceFile(
    rawRelativePath: string,
    options: { mode: IdeExecutionMode }
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (options.mode !== 'agent') {
      return { ok: false, message: `Deletions are prohibited in ${options.mode} mode.` }
    }
    try {
      const normalized = normalizeWorkspaceRelativePath(rawRelativePath)
      const fullPath = await this.resolveSafeWorkspacePath(normalized)
      if (!existsSync(fullPath)) {
        return { ok: true }
      }
      await rm(fullPath, { force: false })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async getGitDiffSummary(): Promise<string | null> {
    if (!existsSync(join(this.target.workspacePath, '.git'))) {
      return null
    }
    const statusRes = await this.runShellCommand('git status --short', { timeoutMs: 15_000 })
    const diffRes = await this.runShellCommand('git diff', { timeoutMs: 20_000 })
    const sections: string[] = []
    if (statusRes.stdout.trim()) {
      sections.push(`### git status --short\n${statusRes.stdout.trim()}`)
    }
    if (diffRes.stdout.trim()) {
      const trimmedDiff =
        diffRes.stdout.length > 32_000
          ? `${diffRes.stdout.slice(0, 32_000)}\n... [diff truncated]`
          : diffRes.stdout
      sections.push(`### git diff\n\`\`\`diff\n${trimmedDiff}\n\`\`\``)
    }
    return sections.length > 0 ? sections.join('\n\n') : null
  }

  runShellCommand(
    command: string,
    options: {
      timeoutMs?: number
      signal?: AbortSignal
      onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void
    }
  ): Promise<WorkspaceCommandRunResult> {
    return runWorkspaceShellCommand(this.target, command, options)
  }
}
