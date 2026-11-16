import { spawn } from 'node:child_process'
import type { ExecutionHostId } from '../../shared/execution-host'
import { wslAwareSpawn } from '../git/command-runner/host-routing/wsl-aware-spawn'

const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000

export type IdeWorkspaceTarget = {
  worktreeId: string
  workspacePath: string
  executionHostId: ExecutionHostId
  wslDistro?: string
}

export type WorkspaceCommandRunResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  canceled: boolean
  timedOut: boolean
  durationMs: number
}

function appendTail(existing: string, next: string, maxChars = 24_000): string {
  const combined = existing + next
  return combined.length <= maxChars ? combined : combined.slice(combined.length - maxChars)
}

export async function runWorkspaceShellCommand(
  target: IdeWorkspaceTarget,
  command: string,
  options: {
    timeoutMs?: number
    signal?: AbortSignal
    onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void
  }
): Promise<WorkspaceCommandRunResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  let stdout = ''
  let stderr = ''
  let bytes = 0
  let timedOut = false
  let canceled = false

  return await new Promise<WorkspaceCommandRunResult>((resolveResult) => {
    const child =
      process.platform === 'win32' && target.wslDistro
        ? wslAwareSpawn('sh', ['-lc', command], {
            cwd: target.workspacePath,
            wslDistro: target.wslDistro,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
          })
        : process.platform === 'win32'
          ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
              cwd: target.workspacePath,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true
            })
          : spawn('/bin/sh', ['-c', command], {
              cwd: target.workspacePath,
              stdio: ['ignore', 'pipe', 'pipe']
            })

    let settled = false
    const killChildTree = (): void => {
      if (!child.pid) {
        return
      }
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } catch {
          child.kill()
        }
        return
      }
      try {
        child.kill('SIGTERM')
      } catch {
        // Process may already have exited.
      }
    }

    const finish = (exitCode: number | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolveResult({
        exitCode,
        stdout,
        stderr,
        canceled,
        timedOut,
        durationMs: Date.now() - startedAt
      })
    }

    const onAbort = (): void => {
      canceled = true
      killChildTree()
      finish(null)
    }

    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      timedOut = true
      killChildTree()
      finish(null)
    }, timeoutMs)

    child.stdout?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      if (bytes < MAX_COMMAND_OUTPUT_BYTES) {
        bytes += buf.byteLength
        stdout = appendTail(stdout, text)
        options.onOutput?.('stdout', text)
      }
    })

    child.stderr?.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      if (bytes < MAX_COMMAND_OUTPUT_BYTES) {
        bytes += buf.byteLength
        stderr = appendTail(stderr, text)
        options.onOutput?.('stderr', text)
      }
    })

    child.on('error', (error: Error) => {
      stderr = appendTail(stderr, `\n${error.message}`)
      finish(1)
    })

    child.on('close', (code) => {
      finish(code)
    })
  })
}
