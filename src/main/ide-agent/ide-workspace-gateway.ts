import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { SearchReplacePatch } from '../../shared/ide-agent/ide-patch-chunker'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import { wslDistroForCommand } from '../../shared/wsl-paths'
import { requireLocalRuntimeFileRoute } from '../runtime/files/file-target'
import { WorkspaceCodeIndex, type IndexedSymbolEntry } from './ide-codebase-intel'
import {
  probeWorkspaceDiagnostics,
  type WorkspaceDiagnosticResult
} from './ide-workspace-diagnostics'
import { invalidateWorkspaceFileListCache } from './harness/ripgrep-workspace-search'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway-types'
import { inspectWorkspaceTree, type WorkspaceInspectionSnapshot } from './ide-workspace-inspector'
import { resolveSafeWorkspacePath } from './ide-workspace-path-guard'
import {
  runWorkspaceShellCommand,
  type IdeWorkspaceTarget,
  type WorkspaceCommandRunResult
} from './ide-workspace-shell'
import {
  createWorkspaceDirectorySafe,
  deleteWorkspaceDirectorySafe,
  listWorkspaceRelativeFiles,
  renameWorkspacePathSafe,
  searchWorkspaceCodeMatches,
  type CodeSearchMatch
} from './ide-workspace-tools-fs'
import {
  applyWorkspaceFilePatchesSafe,
  deleteWorkspaceFileSafe,
  readWorkspaceTextFileSafe,
  sha256Text,
  writeWorkspaceTextFileSafe,
  type WorkspaceReadResult,
  type WorkspaceWriteResult
} from './ide-workspace-write-fs'

export { sha256Text, type WorkspaceReadResult, type WorkspaceWriteResult }
export type { IdeWorkspaceGateway } from './ide-workspace-gateway-types'
export type { IdeWorkspaceTarget, WorkspaceCommandRunResult } from './ide-workspace-shell'
export type { WorkspaceInspectionSnapshot } from './ide-workspace-inspector'
export type { CodeSearchMatch } from './ide-workspace-tools-fs'
export type { IndexedSymbolEntry } from './ide-codebase-intel'
export type { WorkspaceDiagnosticResult } from './ide-workspace-diagnostics'

export class LocalIdeWorkspaceGateway implements IdeWorkspaceGateway {
  readonly target: IdeWorkspaceTarget
  private readonly codeIndex: WorkspaceCodeIndex

  constructor(target: IdeWorkspaceTarget) {
    requireLocalRuntimeFileRoute({ executionHostId: target.executionHostId })
    this.target = {
      ...target,
      wslDistro: target.wslDistro ?? wslDistroForCommand(target.workspacePath) ?? undefined
    }
    this.codeIndex = new WorkspaceCodeIndex(this.target.workspacePath, (raw) =>
      resolveSafeWorkspacePath(this.target.workspacePath, raw)
    )
  }

  inspectWorkspace(
    hintTerms: readonly string[] = [],
    signal?: AbortSignal
  ): Promise<WorkspaceInspectionSnapshot> {
    return inspectWorkspaceTree(
      this.target.workspacePath,
      hintTerms,
      (relPath) => this.readTextFile(relPath),
      signal
    )
  }

  readTextFile(
    rawRelativePath: string,
    options?: { allowSecretRead?: boolean }
  ): Promise<WorkspaceReadResult> {
    return readWorkspaceTextFileSafe(this.target.workspacePath, rawRelativePath, options)
  }

  async readTextFileRange(
    rawRelativePath: string,
    startLine: number,
    endLine: number,
    options?: { allowSecretRead?: boolean }
  ): Promise<
    | { ok: true; content: string | null; sha256: string | null; totalLines: number }
    | { ok: false; reason: string; message: string }
  > {
    const full = await this.readTextFile(rawRelativePath, options)
    if (!full.ok) {
      return full
    }
    if (full.content === null) {
      return { ok: true, content: null, sha256: null, totalLines: 0 }
    }
    const lines = full.content.split(/\r?\n/)
    const from = Math.max(1, startLine)
    const to = Math.min(lines.length, Math.max(from, endLine))
    const numbered = lines
      .slice(from - 1, to)
      .map((line, i) => `${from + i}: ${line}`)
      .join('\n')
    return { ok: true, content: numbered, sha256: full.sha256, totalLines: lines.length }
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
    const res = await writeWorkspaceTextFileSafe(
      this.target.workspacePath,
      rawRelativePath,
      content,
      options
    )
    if (res.ok && res.created) {
      invalidateWorkspaceFileListCache(this.target.workspacePath)
    }
    return res
  }

  applyFilePatches(
    rawRelativePath: string,
    patches: readonly SearchReplacePatch[],
    options: {
      mode: IdeExecutionMode
      expectedBeforeSha: string | null
      dirtyRelativePaths?: ReadonlySet<string>
      allowSecretWrite?: boolean
    }
  ) {
    return applyWorkspaceFilePatchesSafe(
      this.target.workspacePath,
      rawRelativePath,
      patches,
      options
    )
  }

  async createDirectory(rawRelativePath: string, options: { mode: IdeExecutionMode }) {
    const res = await createWorkspaceDirectorySafe({
      rawRelativePath,
      mode: options.mode,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
    invalidateWorkspaceFileListCache(this.target.workspacePath)
    return res
  }

  async renamePath(
    fromRawPath: string,
    toRawPath: string,
    options: { mode: IdeExecutionMode; allowSecretMove?: boolean }
  ) {
    const res = await renameWorkspacePathSafe({
      fromRawPath,
      toRawPath,
      mode: options.mode,
      allowSecretMove: options.allowSecretMove,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
    invalidateWorkspaceFileListCache(this.target.workspacePath)
    return res
  }

  async deleteWorkspaceFile(rawRelativePath: string, options: { mode: IdeExecutionMode }) {
    const res = await deleteWorkspaceFileSafe(this.target.workspacePath, rawRelativePath, options)
    invalidateWorkspaceFileListCache(this.target.workspacePath)
    return res
  }

  async deleteDirectory(
    rawRelativePath: string,
    options: { mode: IdeExecutionMode; recursive?: boolean }
  ) {
    const res = await deleteWorkspaceDirectorySafe({
      rawRelativePath,
      mode: options.mode,
      recursive: options.recursive,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
    invalidateWorkspaceFileListCache(this.target.workspacePath)
    return res
  }

  async searchFiles(query: string, maxResults = 50, signal?: AbortSignal): Promise<string[]> {
    const q = query.trim().toLowerCase()
    const { files } = await listWorkspaceRelativeFiles(this.target.workspacePath, {
      maxFiles: maxResults,
      nameFilter: q || undefined,
      signal
    })
    return files.slice(0, maxResults)
  }

  searchCode(
    query: string,
    options?: {
      pathPrefix?: string
      caseSensitive?: boolean
      maxResults?: number
      signal?: AbortSignal
    }
  ): Promise<CodeSearchMatch[]> {
    return searchWorkspaceCodeMatches({
      workspacePath: this.target.workspacePath,
      query,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw),
      ...options
    })
  }

  findSymbols(query: string, maxResults = 30): Promise<IndexedSymbolEntry[]> {
    return this.codeIndex.findSymbols(query, maxResults)
  }

  getImports(relativePath: string): Promise<{ imports: string[]; importedBy: string[] }> {
    return this.codeIndex.getImports(normalizeWorkspaceRelativePath(relativePath))
  }

  getDiagnostics(signal?: AbortSignal): Promise<WorkspaceDiagnosticResult> {
    return probeWorkspaceDiagnostics(this.target, signal, (cmd, opts) =>
      this.runShellCommand(cmd, opts)
    )
  }

  async getGitDiffSummary(): Promise<string | null> {
    const insideRes = await this.runShellCommand('git rev-parse --is-inside-work-tree', {
      timeoutMs: 8_000
    })
    if (insideRes.exitCode !== 0 || insideRes.stdout.trim() !== 'true') {
      return null
    }
    const statusRes = await this.runShellCommand('git status --short', { timeoutMs: 15_000 })
    const diffHeadRes = await this.runShellCommand('git diff HEAD', { timeoutMs: 20_000 })
    const diffRes =
      diffHeadRes.exitCode === 0 && diffHeadRes.stdout.trim()
        ? diffHeadRes
        : await this.runShellCommand('git diff', { timeoutMs: 20_000 })
    const rawDiff =
      diffRes.stdout.length > 32_000
        ? `${diffRes.stdout.slice(0, 32_000)}\n... [diff truncated]`
        : diffRes.stdout
    const sections = [
      statusRes.stdout.trim() ? `### git status --short\n${statusRes.stdout.trim()}` : '',
      rawDiff.trim() ? `### git diff\n\`\`\`diff\n${rawDiff}\n\`\`\`` : ''
    ].filter(Boolean)
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
