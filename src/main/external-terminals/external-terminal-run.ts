import { spawn, type SpawnOptions } from 'node:child_process'
import { posix, win32 } from 'node:path'
import { quoteStartupArg } from '../../shared/agent-launch/startup/tui-agent-startup-shell'
import { detectLanguage } from '../../shared/editor-language/editor-language-detect'
import {
  getIdeFileRunnerSpec,
  resolveIdeRunnerShellDialect
} from '../../shared/ide/ide-file-runner'
import type {
  ShellRunExternalTerminalRequest,
  ShellRunExternalTerminalResult
} from '../../shared/shell/opening/shell-open-types'
import { getCmdExePath } from '../../shared/windows-batch-spawn'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'
import { parseWslUncPath, toLinuxPath } from '../../shared/wsl-paths'
import { findCommandsOnLocalPath } from '../ipc/command-path/command-path-resolver'
import { resolveOwnedPathTarget } from '../ipc/shell-owned-path-target'
import type { Store } from '../persistence/loading-store/store'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability
} from '../providers/windows-powershell'
import { envWithoutAppImageRuntime } from '../pty/shell-startup/appimage-terminal-env'
import { resolveGitBashPath } from '../pty/shell-startup/git-bash'
import { isPwshAvailableAsync } from '../pty/shell-startup/pwsh'
import { hydrateShellPathForAgentDetection } from '../ipc/command-path/agent-detection-shell-path'

type ExternalTerminalStore = {
  getSettings: () => Partial<
    Pick<
      ReturnType<Store['getSettings']>,
      'terminalWindowsShell' | 'terminalWindowsPowerShellImplementation'
    >
  >
}

type WindowsExternalShellChoice =
  | 'powershell.exe'
  | 'pwsh.exe'
  | 'cmd.exe'
  | typeof WINDOWS_GIT_BASH_SHELL
  | 'wsl.exe'

const LINUX_TERMINALS = [
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'alacritty',
  'kitty',
  'wezterm',
  'xterm'
] as const

const POSIX_SHELLS = new Set(['bash', 'zsh', 'sh'])

function normalizeWindowsShellChoice(shell: string | undefined): WindowsExternalShellChoice | null {
  const leaf = shell?.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase()
  if (leaf === 'powershell.exe' || leaf === 'powershell') {
    return 'powershell.exe'
  }
  if (leaf === 'pwsh.exe' || leaf === 'pwsh') {
    return 'pwsh.exe'
  }
  if (leaf === 'cmd.exe' || leaf === 'cmd') {
    return 'cmd.exe'
  }
  if (leaf === WINDOWS_GIT_BASH_SHELL) {
    return WINDOWS_GIT_BASH_SHELL
  }
  if (leaf === 'wsl.exe' || leaf === 'wsl') {
    return 'wsl.exe'
  }
  return null
}

async function resolveRunnerExecutable(
  candidates: readonly string[],
  options: { skipPathCheck?: boolean } = {}
): Promise<string | null> {
  if (candidates.length === 0) {
    return ''
  }
  if (options.skipPathCheck) {
    return candidates[0]
  }
  let found = await findCommandsOnLocalPath([...candidates])
  if (found.size === 0) {
    await hydrateShellPathForAgentDetection()
    found = await findCommandsOnLocalPath([...candidates])
  }
  return candidates.find((candidate) => found.has(candidate)) ?? null
}

function spawnDetachedConsole(
  program: string,
  args: string[],
  options: Omit<SpawnOptions, 'detached' | 'stdio' | 'windowsHide'> = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(program, args, {
      ...options,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    const finish = (ok: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      child.off('error', onError)
      child.off('spawn', onSpawn)
      resolve(ok)
    }
    const onError = (): void => finish(false)
    const onSpawn = (): void => {
      child.unref()
      finish(true)
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}

async function launchWindowsExternalTerminal(
  store: ExternalTerminalStore,
  targetPath: string,
  language: string,
  requestedShell: string | undefined
): Promise<ShellRunExternalTerminalResult> {
  const settings = store.getSettings()
  const wslUnc = parseWslUncPath(targetPath)
  const selectedShell =
    normalizeWindowsShellChoice(requestedShell) ??
    (wslUnc ? 'wsl.exe' : null) ??
    normalizeWindowsShellChoice(settings.terminalWindowsShell) ??
    'powershell.exe'

  if (selectedShell === 'wsl.exe') {
    const execPath = wslUnc ? wslUnc.linuxPath : toLinuxPath(targetPath)
    const spec = getIdeFileRunnerSpec(execPath, language, 'posix')
    if (!spec) {
      return { ok: false, reason: 'unsupported-file' }
    }
    const command = spec.buildCommand(spec.candidates[0] ?? '')
    const wslCwd = wslUnc ? posix.dirname(wslUnc.linuxPath) : win32.dirname(targetPath)
    const distroArgs = wslUnc ? ['-d', wslUnc.distro] : []
    const ok = await spawnDetachedConsole('wsl.exe', [
      ...distroArgs,
      '--cd',
      wslCwd,
      '--',
      'sh',
      '-lc',
      `${command}; printf "\\n"; exec "\${SHELL:-bash}" -i`
    ])
    return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
  }

  const dialect = resolveIdeRunnerShellDialect(selectedShell, 'powershell')
  const execPath =
    selectedShell === WINDOWS_GIT_BASH_SHELL ? targetPath.replaceAll('\\', '/') : targetPath
  const spec = getIdeFileRunnerSpec(execPath, language, dialect)
  if (!spec) {
    return { ok: false, reason: 'unsupported-file' }
  }

  const skipPathCheck = selectedShell === WINDOWS_GIT_BASH_SHELL && language === 'shell'
  const executable = await resolveRunnerExecutable(spec.candidates, { skipPathCheck })
  if (executable === null) {
    return { ok: false, reason: 'missing-runner', candidates: spec.candidates }
  }

  const command = spec.buildCommand(executable)
  const targetDir = win32.dirname(targetPath)
  const windowsCwd = wslUnc ? undefined : targetDir

  if (selectedShell === WINDOWS_GIT_BASH_SHELL) {
    const gitBashPath = resolveGitBashPath()
    if (!gitBashPath) {
      return { ok: false, reason: 'missing-shell' }
    }
    const cdPrefix = wslUnc
      ? `cd ${quoteStartupArg(targetDir.replaceAll('\\', '/'), 'posix')} && `
      : ''
    const ok = await spawnDetachedConsole(
      gitBashPath,
      ['-lc', `${cdPrefix}${command}; echo; exec bash`],
      { cwd: windowsCwd, env: { ...process.env, CHERE_INVOKING: '1' } }
    )
    return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
  }

  if (selectedShell === 'cmd.exe') {
    const cmdPrefix = wslUnc ? `pushd "${targetDir}" && ` : ''
    const ok = await spawnDetachedConsole(
      getCmdExePath(),
      ['/d', '/s', '/k', `"${cmdPrefix}${command}"`],
      { cwd: windowsCwd, windowsVerbatimArguments: true }
    )
    return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
  }

  const implementation = settings.terminalWindowsPowerShellImplementation
  const pwshAvailable = shouldProbeWindowsPowerShellAvailability({
    shellFamily: selectedShell,
    implementation
  })
    ? await isPwshAvailableAsync()
    : false
  const psExe =
    resolveEffectiveWindowsPowerShell({
      shellFamily: selectedShell,
      implementation,
      pwshAvailable
    }) ?? 'powershell.exe'
  const psPrefix = wslUnc
    ? `Set-Location -LiteralPath ${quoteStartupArg(targetDir, 'powershell')}; `
    : ''
  const encoded = Buffer.from(`${psPrefix}${command}`, 'utf16le').toString('base64')
  const ok = await spawnDetachedConsole(psExe, ['-NoLogo', '-NoExit', '-EncodedCommand', encoded], {
    cwd: windowsCwd
  })
  return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
}

async function launchPosixExternalTerminal(
  targetPath: string,
  language: string,
  requestedShell: string | undefined
): Promise<ShellRunExternalTerminalResult> {
  const spec = getIdeFileRunnerSpec(targetPath, language, 'posix')
  if (!spec) {
    return { ok: false, reason: 'unsupported-file' }
  }
  const executable = await resolveRunnerExecutable(spec.candidates)
  if (executable === null) {
    return { ok: false, reason: 'missing-runner', candidates: spec.candidates }
  }
  const command = spec.buildCommand(executable)
  const targetDir = posix.dirname(targetPath)
  const trimmedShell = requestedShell?.trim().toLowerCase()
  const chosenShell = trimmedShell && POSIX_SHELLS.has(trimmedShell) ? trimmedShell : null

  if (process.platform === 'darwin') {
    const innerCommand = chosenShell
      ? `cd ${quoteStartupArg(targetDir, 'posix')} && ${chosenShell} -lc ${quoteStartupArg(command, 'posix')}`
      : `cd ${quoteStartupArg(targetDir, 'posix')} && ${command}`
    const appleScriptArg = innerCommand.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    const ok = await spawnDetachedConsole('osascript', [
      '-e',
      'tell application "Terminal" to activate',
      '-e',
      `tell application "Terminal" to do script "${appleScriptArg}"`
    ])
    return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
  }

  const terminals = await findCommandsOnLocalPath([...LINUX_TERMINALS])
  const terminal = LINUX_TERMINALS.find((candidate) => terminals.has(candidate))
  if (!terminal) {
    return { ok: false, reason: 'missing-shell' }
  }
  const shellBin = chosenShell ?? 'sh'
  const wrapped = `${command}; printf "\\nPress Enter to close..."; read _`
  const args =
    terminal === 'gnome-terminal' || terminal === 'mate-terminal'
      ? ['--', shellBin, '-lc', wrapped]
      : terminal === 'wezterm'
        ? ['start', '--cwd', targetDir, '--', shellBin, '-lc', wrapped]
        : ['-e', shellBin, '-lc', wrapped]
  const ok = await spawnDetachedConsole(terminal, args, {
    cwd: targetDir,
    env: envWithoutAppImageRuntime(process.env)
  })
  return ok ? { ok: true } : { ok: false, reason: 'launch-failed' }
}

/** Validate local/WSL file ownership and run the file inside a native external console window. */
export async function runFileInExternalTerminal(
  store: ExternalTerminalStore,
  request: ShellRunExternalTerminalRequest
): Promise<ShellRunExternalTerminalResult> {
  const target = await resolveOwnedPathTarget(request.filePath, request.ownerHostId)
  if (!target.ok) {
    return target
  }
  const language = detectLanguage(target.path)
  if (process.platform === 'win32') {
    return launchWindowsExternalTerminal(store, target.path, language, request.shell)
  }
  return launchPosixExternalTerminal(target.path, language, request.shell)
}
