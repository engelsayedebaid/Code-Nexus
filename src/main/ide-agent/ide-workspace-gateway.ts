import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
export type { IdeWorkspaceTarget, WorkspaceCommandRunResult } from './ide-workspace-shell'
export type { WorkspaceInspectionSnapshot } from './ide-workspace-inspector'
export type { CodeSearchMatch } from './ide-workspace-tools-fs'
export type { IndexedSymbolEntry } from './ide-codebase-intel'
export type { WorkspaceDiagnosticResult } from './ide-workspace-diagnostics'

export type IdeWorkspaceGateway = {
  readonly target: IdeWorkspaceTarget
  inspectWorkspace(hintTerms?: readonly string[]): Promise<WorkspaceInspectionSnapshot>
  readTextFile(
    relativePath: string,
    options?: { allowSecretRead?: boolean }
  ): Promise<WorkspaceReadResult>
  readTextFileRange?: (
    relativePath: string,
    startLine: number,
    endLine: number,
    options?: { allowSecretRead?: boolean }
  ) => Promise<
    | { ok: true; content: string | null; sha256: string | null; totalLines: number }
    | { ok: false; reason: string; message: string }
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
  applyFilePatches?: (
    relativePath: string,
    patches: readonly SearchReplacePatch[],
    options: {
      mode: IdeExecutionMode
      expectedBeforeSha: string | null
      dirtyRelativePaths?: ReadonlySet<string>
      allowSecretWrite?: boolean
    }
  ) => Promise<
    | {
        ok: true
        relativePath: string
        sha256: string
        beforeContent: string
        afterContent: string
      }
    | { ok: false; reason: string; message: string }
  >
  createDirectory?: (
    relativePath: string,
    options: { mode: IdeExecutionMode }
  ) => Promise<
    { ok: true; relativePath: string; created: boolean } | { ok: false; message: string }
  >
  renamePath?: (
    fromRelativePath: string,
    toRelativePath: string,
    options: { mode: IdeExecutionMode; allowSecretMove?: boolean }
  ) => Promise<
    | { ok: true; fromRelativePath: string; toRelativePath: string; isDirectory: boolean }
    | { ok: false; message: string }
  >
  deleteWorkspaceFile(
    relativePath: string,
    options: { mode: IdeExecutionMode }
  ): Promise<{ ok: true } | { ok: false; message: string }>
  deleteDirectory?: (
    relativePath: string,
    options: { mode: IdeExecutionMode; recursive?: boolean }
  ) => Promise<{ ok: true; relativePath: string } | { ok: false; message: string }>
  searchFiles?: (query: string, maxResults?: number) => Promise<string[]>
  searchCode?: (
    query: string,
    options?: { pathPrefix?: string; caseSensitive?: boolean; maxResults?: number }
  ) => Promise<CodeSearchMatch[]>
  findSymbols?: (query: string, maxResults?: number) => Promise<IndexedSymbolEntry[]>
  getImports?: (relativePath: string) => Promise<{ imports: string[]; importedBy: string[] }>
  getDiagnostics?: (signal?: AbortSignal) => Promise<WorkspaceDiagnosticResult>
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

  inspectWorkspace(hintTerms: readonly string[] = []): Promise<WorkspaceInspectionSnapshot> {
    return inspectWorkspaceTree(this.target.workspacePath, hintTerms, (relPath) =>
      this.readTextFile(relPath)
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

  writeTextChunk(
    rawRelativePath: string,
    content: string,
    options: {
      mode: IdeExecutionMode
      expectedBeforeSha: string | null
      dirtyRelativePaths?: ReadonlySet<string>
      allowSecretWrite?: boolean
    }
  ): Promise<WorkspaceWriteResult> {
    return writeWorkspaceTextFileSafe(this.target.workspacePath, rawRelativePath, content, options)
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

  createDirectory(rawRelativePath: string, options: { mode: IdeExecutionMode }) {
    return createWorkspaceDirectorySafe({
      rawRelativePath,
      mode: options.mode,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
  }

  renamePath(
    fromRawPath: string,
    toRawPath: string,
    options: { mode: IdeExecutionMode; allowSecretMove?: boolean }
  ) {
    return renameWorkspacePathSafe({
      fromRawPath,
      toRawPath,
      mode: options.mode,
      allowSecretMove: options.allowSecretMove,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
  }

  deleteWorkspaceFile(rawRelativePath: string, options: { mode: IdeExecutionMode }) {
    return deleteWorkspaceFileSafe(this.target.workspacePath, rawRelativePath, options)
  }

  deleteDirectory(
    rawRelativePath: string,
    options: { mode: IdeExecutionMode; recursive?: boolean }
  ) {
    return deleteWorkspaceDirectorySafe({
      rawRelativePath,
      mode: options.mode,
      recursive: options.recursive,
      resolveSafePath: (raw) => resolveSafeWorkspacePath(this.target.workspacePath, raw)
    })
  }

  async searchFiles(query: string, maxResults = 50): Promise<string[]> {
    const q = query.trim().toLowerCase()
    const { files } = await listWorkspaceRelativeFiles(this.target.workspacePath, { maxFiles: 600 })
    const filtered = q ? files.filter((f) => f.toLowerCase().includes(q)) : files
    return filtered.slice(0, maxResults)
  }

  searchCode(
    query: string,
    options?: { pathPrefix?: string; caseSensitive?: boolean; maxResults?: number }
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
    return probeWorkspaceDiagnostics(this.target, signal)
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
