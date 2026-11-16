import { getRuntimePathBasename, isWindowsAbsolutePathLike } from '../cross-platform-path'
import {
  quoteStartupArg,
  type AgentStartupShell
} from '../agent-launch/startup/tui-agent-startup-shell'

export type IdeFileRunnerSpec = {
  /** Candidate executables ordered by preference; empty when invoked directly by the shell. */
  candidates: readonly string[]
  /** Builds the shell command string for the selected executable. */
  buildCommand: (executable: string) => string
}

type DirectRunnerSpec = {
  candidates: readonly string[]
  buildArgs: (executable: string, filePath: string) => readonly string[]
}

const DIRECT_RUNNERS: Readonly<Record<string, DirectRunnerSpec>> = {
  javascript: { candidates: ['node'], buildArgs: (exe, file) => [exe, file] },
  typescript: { candidates: ['npx'], buildArgs: (exe, file) => [exe, '--no-install', 'tsx', file] },
  ruby: { candidates: ['ruby'], buildArgs: (exe, file) => [exe, file] },
  php: { candidates: ['php'], buildArgs: (exe, file) => [exe, file] },
  go: { candidates: ['go'], buildArgs: (exe, file) => [exe, 'run', file] },
  java: { candidates: ['java'], buildArgs: (exe, file) => [exe, file] },
  kotlin: { candidates: ['kotlinc'], buildArgs: (exe, file) => [exe, '-script', file] },
  csharp: { candidates: ['dotnet'], buildArgs: (exe, file) => [exe, 'script', file] },
  swift: { candidates: ['swift'], buildArgs: (exe, file) => [exe, file] },
  shell: { candidates: ['bash'], buildArgs: (exe, file) => [exe, file] },
  powershell: {
    candidates: ['pwsh', 'powershell'],
    buildArgs: (exe, file) => [exe, '-File', file]
  },
  lua: { candidates: ['lua'], buildArgs: (exe, file) => [exe, file] },
  r: { candidates: ['Rscript'], buildArgs: (exe, file) => [exe, file] },
  scala: { candidates: ['scala'], buildArgs: (exe, file) => [exe, file] },
  groovy: { candidates: ['groovy'], buildArgs: (exe, file) => [exe, file] },
  dart: { candidates: ['dart'], buildArgs: (exe, file) => [exe, 'run', file] },
  elixir: { candidates: ['elixir'], buildArgs: (exe, file) => [exe, file] },
  erlang: { candidates: ['escript'], buildArgs: (exe, file) => [exe, file] },
  haskell: { candidates: ['runhaskell'], buildArgs: (exe, file) => [exe, file] },
  clojure: { candidates: ['clojure'], buildArgs: (exe, file) => [exe, file] },
  nim: { candidates: ['nim'], buildArgs: (exe, file) => [exe, 'compile', '--run', file] },
  zig: { candidates: ['zig'], buildArgs: (exe, file) => [exe, 'run', file] }
}

function defaultShellForPath(filePath: string): AgentStartupShell {
  return isWindowsAbsolutePathLike(filePath) ? 'powershell' : 'posix'
}

/** Map a configured or user-picked shell identifier onto its command-quoting dialect. */
export function resolveIdeRunnerShellDialect(
  shell: string | undefined,
  fallback: AgentStartupShell
): AgentStartupShell {
  const leaf = shell?.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase()
  if (!leaf) {
    return fallback
  }
  if (leaf === 'cmd.exe' || leaf === 'cmd') {
    return 'cmd'
  }
  if (
    leaf === 'powershell.exe' ||
    leaf === 'pwsh.exe' ||
    leaf === 'powershell' ||
    leaf === 'pwsh'
  ) {
    return 'powershell'
  }
  if (
    leaf === 'git-bash' ||
    leaf === 'bash.exe' ||
    leaf === 'bash' ||
    leaf === 'zsh' ||
    leaf === 'sh' ||
    leaf === 'fish' ||
    leaf === 'wsl.exe' ||
    leaf === 'wsl'
  ) {
    return 'posix'
  }
  return fallback
}

function getParentDirectory(filePath: string): string {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (separator < 0) {
    return '.'
  }
  if (separator === 0) {
    return filePath.slice(0, 1)
  }
  if (/^[A-Za-z]:[\\/]$/.test(filePath.slice(0, separator + 1))) {
    return filePath.slice(0, separator + 1)
  }
  return filePath.slice(0, separator)
}

function joinChildPath(parent: string, child: string, useBackslash: boolean): string {
  const separator = useBackslash ? '\\' : '/'
  const trimmed = parent.endsWith('/') || parent.endsWith('\\') ? parent.slice(0, -1) : parent
  return `${trimmed}${separator}${child}`
}

function formatTargetPathForShell(filePath: string, shell: AgentStartupShell): string {
  if (!isWindowsAbsolutePathLike(filePath)) {
    return filePath
  }
  return shell === 'posix' ? filePath.replaceAll('\\', '/') : filePath.replaceAll('/', '\\')
}

function formatDirectCommand(args: readonly string[], shell: AgentStartupShell): string {
  const [executable, ...rest] = args
  if (!executable) {
    return ''
  }
  const quotedArgs = rest.map((arg) => quoteStartupArg(arg, shell))
  return quotedArgs.length > 0 ? `${executable} ${quotedArgs.join(' ')}` : executable
}

function compiledCommandSpec(
  candidates: readonly string[],
  filePath: string,
  shell: AgentStartupShell
): IdeFileRunnerSpec {
  const windowsTarget = isWindowsAbsolutePathLike(filePath)
  const useBackslash = windowsTarget && shell !== 'posix'
  const execFilePath = formatTargetPathForShell(filePath, shell)
  const sourceName = getRuntimePathBasename(execFilePath)
  const stem = sourceName.includes('.')
    ? sourceName.slice(0, sourceName.lastIndexOf('.'))
    : sourceName
  const outputPath = joinChildPath(
    getParentDirectory(execFilePath),
    `${stem}.orca-run${windowsTarget ? '.exe' : ''}`,
    useBackslash
  )
  const quotedFile = quoteStartupArg(execFilePath, shell)
  const quotedOut = quoteStartupArg(outputPath, shell)
  return {
    candidates,
    buildCommand: (compiler) => {
      const compile = `${compiler} ${quotedFile} -o ${quotedOut}`
      return shell === 'powershell'
        ? `${compile}; if ($LASTEXITCODE -eq 0) { & ${quotedOut} }`
        : `${compile} && ${quotedOut}`
    }
  }
}

/** Resolve candidate executables and command builder for running `filePath` in `shell`. */
export function getIdeFileRunnerSpec(
  filePath: string,
  language: string,
  shell: AgentStartupShell = defaultShellForPath(filePath)
): IdeFileRunnerSpec | null {
  const execFilePath = formatTargetPathForShell(filePath, shell)
  if (language === 'python') {
    const candidates = isWindowsAbsolutePathLike(filePath)
      ? ['python', 'python3', 'py']
      : ['python3', 'python']
    return {
      candidates,
      buildCommand: (executable) => formatDirectCommand([executable, execFilePath], shell)
    }
  }
  if (language === 'bat') {
    if (shell === 'posix') {
      return null
    }
    const quotedFile = quoteStartupArg(execFilePath, shell)
    return {
      candidates: [],
      buildCommand: () => (shell === 'powershell' ? `& ${quotedFile}` : quotedFile)
    }
  }
  const direct = DIRECT_RUNNERS[language]
  if (direct) {
    return {
      candidates: direct.candidates,
      buildCommand: (executable) =>
        formatDirectCommand(direct.buildArgs(executable, execFilePath), shell)
    }
  }
  if (language === 'c') {
    return compiledCommandSpec(
      shell === 'posix' ? ['gcc', 'clang', 'cc'] : ['gcc', 'clang'],
      filePath,
      shell
    )
  }
  if (language === 'cpp') {
    return compiledCommandSpec(['g++', 'clang++'], filePath, shell)
  }
  if (language === 'cuda-cpp') {
    return compiledCommandSpec(['nvcc'], filePath, shell)
  }
  if (language === 'rust') {
    return compiledCommandSpec(['rustc'], filePath, shell)
  }
  return null
}

/** Convenience wrapper returning the default command string without preflight executable resolution. */
export function buildIdeFileRunCommand(
  filePath: string,
  language: string,
  shell: AgentStartupShell = defaultShellForPath(filePath)
): string | null {
  const spec = getIdeFileRunnerSpec(filePath, language, shell)
  return spec ? spec.buildCommand(spec.candidates[0] ?? '') : null
}
