import type { SearchReplacePatch } from '../../shared/ide-agent/ide-patch-chunker'
import type { IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import type { IndexedSymbolEntry } from './ide-codebase-intel'
import type { WorkspaceDiagnosticResult } from './ide-workspace-diagnostics'
import type { WorkspaceInspectionSnapshot } from './ide-workspace-inspector'
import type { IdeWorkspaceTarget, WorkspaceCommandRunResult } from './ide-workspace-shell'
import type { CodeSearchMatch } from './ide-workspace-tools-fs'
import type { WorkspaceReadResult, WorkspaceWriteResult } from './ide-workspace-write-fs'

export type IdeWorkspaceGateway = {
  readonly target: IdeWorkspaceTarget
  inspectWorkspace(
    hintTerms?: readonly string[],
    signal?: AbortSignal
  ): Promise<WorkspaceInspectionSnapshot>
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
  searchFiles?: (query: string, maxResults?: number, signal?: AbortSignal) => Promise<string[]>
  searchCode?: (
    query: string,
    options?: {
      pathPrefix?: string
      caseSensitive?: boolean
      maxResults?: number
      signal?: AbortSignal
    }
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
