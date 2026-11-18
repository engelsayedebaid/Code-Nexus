import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  runWorkspaceShellCommand,
  type IdeWorkspaceTarget,
  type WorkspaceCommandRunResult
} from './ide-workspace-shell'

export type WorkspaceDiagnosticResult = {
  available: boolean
  tool: string
  passed: boolean
  errorCount: number
  summary: string
  details: string
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

export async function probeWorkspaceDiagnostics(
  target: IdeWorkspaceTarget,
  signal?: AbortSignal,
  runCommand?: (
    command: string,
    options: { timeoutMs?: number; signal?: AbortSignal }
  ) => Promise<WorkspaceCommandRunResult>
): Promise<WorkspaceDiagnosticResult> {
  const hasTsconfig = await pathExists(join(target.workspacePath, 'tsconfig.json'))
  if (!hasTsconfig) {
    return {
      available: false,
      tool: 'none',
      passed: true,
      errorCount: 0,
      summary: 'No tsconfig.json configured for static diagnostics.',
      details: ''
    }
  }

  const hasLocalTsc =
    (await pathExists(join(target.workspacePath, 'node_modules', '.bin', 'tsc'))) ||
    (await pathExists(join(target.workspacePath, 'node_modules', '.bin', 'tsc.cmd')))
  if (!hasLocalTsc) {
    return {
      available: false,
      tool: 'typescript',
      passed: true,
      errorCount: 0,
      summary: 'tsconfig.json found, but local tsc binary is not installed in node_modules.',
      details: ''
    }
  }

  const execute =
    runCommand ??
    ((command: string, options: { timeoutMs?: number; signal?: AbortSignal }) =>
      runWorkspaceShellCommand(target, command, options))
  const res = await execute('npx --no-install tsc --noEmit --pretty false', {
    timeoutMs: 35_000,
    signal
  })
  const combined = [res.stdout, res.stderr].filter(Boolean).join('\n').trim()
  const errorLines = combined
    .split(/\r?\n/)
    .filter((line) => /\berror TS\d+:|:\d+:\d+\s+-\s+error\b/i.test(line))
  const passed = !res.timedOut && !res.canceled && res.exitCode === 0
  return {
    available: true,
    tool: 'tsc',
    passed,
    errorCount: passed ? 0 : Math.max(1, errorLines.length),
    summary: passed
      ? 'TypeScript check passed with 0 errors.'
      : `TypeScript check found ${Math.max(1, errorLines.length)} error(s).`,
    details: combined.slice(-8_000)
  }
}
