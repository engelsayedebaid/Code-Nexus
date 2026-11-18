import { StringDecoder } from 'node:string_decoder'
import { spawnProcess } from '@orca/process-host'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '@orca/process-host/process-tree-termination'
import { windowsSystem32Binary } from '@orca/process-host/windows-system-binary'
import type { ExecutionHostId } from '../../shared/execution-host'
import { resolveExecutableCommand } from '../../shared/node-cli-command-resolution'
import { wslAwareSpawn } from '../git/command-runner/host-routing/wsl-aware-spawn'

const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000
const SHELL_METACHAR_PATTERN = /[&|;<>`$\n\r()]/
const WINDOWS_SHELL_BUILTINS = new Set([
  'cd',
  'dir',
  'echo',
  'set',
  'type',
  'copy',
  'move',
  'del',
  'rmdir',
  'mkdir',
  'md'
])

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

function parseSimpleCommandArgv(command: string): string[] | null {
  const trimmed = command.trim()
  if (!trimmed || SHELL_METACHAR_PATTERN.test(trimmed)) {
    return null
  }
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (quote !== null) {
    return null
  }
  if (current.length > 0) {
    tokens.push(current)
  }
  if (tokens.length === 0 || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    return null
  }
  return tokens
}

function spawnLocalWorkspaceCommand(cwd: string, command: string) {
  const argv = parseSimpleCommandArgv(command)
  if (argv) {
    const headLower = argv[0].toLowerCase()
    if (process.platform !== 'win32' || !WINDOWS_SHELL_BUILTINS.has(headLower)) {
      const resolved = resolveExecutableCommand(argv[0], {
        pathEnv: process.env.PATH ?? process.env.Path ?? null
      })
      if (resolved) {
        return spawnProcess({
          program: resolved,
          args: argv.slice(1),
          cwd,
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      }
    }
  }
  if (process.platform === 'win32') {
    return spawnProcess({
      program: process.env.ComSpec || windowsSystem32Binary('cmd.exe'),
      args: ['/d', '/s', '/c', `"${command}"`],
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: true
    })
  }
  return spawnProcess({
    program: '/bin/sh',
    args: ['-c', command],
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
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
        : spawnLocalWorkspaceCommand(target.workspacePath, command)

    let settled = false
    const killChildTree = (): void => {
      void signalProcessTree(child).then((ok) => {
        if (!ok) {
          void forceTerminateProcessTree(child)
        }
      })
    }

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

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
      const text = stdoutDecoder.write(buf)
      if (bytes < MAX_COMMAND_OUTPUT_BYTES && text) {
        bytes += buf.byteLength
        stdout = appendTail(stdout, text)
        options.onOutput?.('stdout', text)
      }
    })

    child.stderr?.on('data', (buf: Buffer) => {
      const text = stderrDecoder.write(buf)
      if (bytes < MAX_COMMAND_OUTPUT_BYTES && text) {
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
