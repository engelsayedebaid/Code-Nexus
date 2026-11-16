import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runWorkspaceShellCommand, type IdeWorkspaceTarget } from './ide-workspace-shell'

export type WorkspaceDiagnosticResult = {
  available: boolean
  tool: string
  passed: boolean
  errorCount: number
  summary: string
  details: string
}

export async function probeWorkspaceDiagnostics(
  target: IdeWorkspaceTarget,
  signal?: AbortSignal
): Promise<WorkspaceDiagnosticResult> {
  const hasTsconfig = existsSync(join(target.workspacePath, 'tsconfig.json'))
  const hasPkgJson = existsSync(join(target.workspacePath, 'package.json'))
  if (!hasTsconfig && !hasPkgJson) {
    return {
      available: false,
      tool: 'none',
      passed: true,
      errorCount: 0,
      summary: 'No TypeScript or package diagnostics configured.',
      details: ''
    }
  }
  const hasLocalTsc =
    existsSync(join(target.workspacePath, 'node_modules', '.bin', 'tsc')) ||
    existsSync(join(target.workspacePath, 'node_modules', '.bin', 'tsc.cmd'))
  if (!hasTsconfig || !hasLocalTsc) {
    return {
      available: false,
      tool: 'typescript',
      passed: true,
      errorCount: 0,
      summary: hasTsconfig
        ? 'tsconfig.json found, but local tsc binary is not installed in node_modules.'
        : 'No tsconfig.json found for static TypeScript diagnostics.',
      details: ''
    }
  }
  const cmd = 'npx --no-install tsc --noEmit --pretty false'
  const res = await runWorkspaceShellCommand(target, cmd, {
    timeoutMs: 30_000,
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
