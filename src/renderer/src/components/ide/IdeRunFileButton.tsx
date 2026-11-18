import { useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, Play, TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import {
  getIdeFileRunnerSpec,
  resolveIdeRunnerShellDialect
} from '../../../../shared/ide/ide-file-runner'
import { cn } from '@/lib/class-names'
import { requestEditorFileSave } from '@/components/editor/autosave/editor-autosave'
import { LocalOnlyMenuHint } from '@/components/local-only-menu-hint'
import { ShellIcon } from '@/components/tab-bar/shell-icons'
import { shouldShowWindowsShellMenu } from '@/components/tab-bar/windows-shell-menu-visibility'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import {
  isRevealOrEditorOpenBlocked,
  showLocalPathOpenBlockedToast
} from '@/lib/files/os-open/local-path-open-guard'
import { getOpenFileRevealOwner } from '@/lib/files/os-open/reveal-in-file-manager'
import { getConnectionIdFromState } from '@/lib/workspace/ownership/connection-owner-resolution'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '@/lib/workspace/ownership/worktree-runtime-owner'
import {
  getWindowsTerminalCapabilityOwnerKey,
  useWindowsTerminalCapabilities
} from '@/runtime/hosts/capabilities/windows-terminal-capabilities'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import {
  isWindowsRendererRuntime,
  worktreeUsesWslPath
} from '@/store/terminals/terminal-workspace-routing'
import { resolveIdeRunContext, runIdeCommandInBottomTerminal } from './ide-bottom-terminal-runner'
import { buildIdeRunShellOptions } from './ide-run-shell-options'
import {
  setIdeRunDestination,
  setIdeRunShell,
  useIdeRunPreference,
  type IdeRunDestination
} from './ide-run-target'

const isWebClient = (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ === true

export function IdeRunFileButton({ file }: { file: OpenFile }): React.JSX.Element | null {
  const t = useTranslate()
  const appMode = useAppStore((state) => state.appMode)
  const preference = useIdeRunPreference()
  const [running, setRunning] = useState(false)
  const revealOwner = useAppStore((state) => getOpenFileRevealOwner(state, file))
  const defaultWindowsShell = useAppStore(
    (state) => state.settings?.terminalWindowsShell ?? 'powershell.exe'
  )
  const activeRuntimeEnvironmentId = useAppStore((state) =>
    runtimeEnvironmentIdOrLocalUnlessTwin(state, file.worktreeId)
  )
  const worktreeConnectionId = useAppStore(
    (state) => getConnectionIdFromState(state, file.worktreeId)?.trim() || null
  )
  const worktreeRemotePlatform = useAppStore((state) =>
    worktreeConnectionId
      ? (state.sshConnectionStates.get(worktreeConnectionId)?.remotePlatform ?? null)
      : null
  )
  const isWslWorktree = useAppStore((state) => worktreeUsesWslPath(state, file.worktreeId))
  const isWindowsClient = isWindowsRendererRuntime()
  const windowsTerminalCapabilityOwnerKey = getWindowsTerminalCapabilityOwnerKey(
    activeRuntimeEnvironmentId,
    worktreeConnectionId
  )
  const runtimeTarget = useMemo(
    () => runtimeTargetForOwnerEnvironment(activeRuntimeEnvironmentId),
    [activeRuntimeEnvironmentId]
  )
  const isEnabled = appMode === 'ide' && file.mode === 'edit'
  const shouldProbeWindowsCapabilities =
    isEnabled &&
    (isWindowsClient ||
      Boolean(activeRuntimeEnvironmentId?.trim()) ||
      isWebClient ||
      Boolean(worktreeConnectionId))
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    shouldProbeWindowsCapabilities,
    false,
    windowsTerminalCapabilityOwnerKey,
    runtimeTarget,
    worktreeConnectionId
  )
  const shellMenuHostPlatform = worktreeConnectionId
    ? (worktreeRemotePlatform ?? windowsTerminalCapabilities.hostPlatform)
    : windowsTerminalCapabilities.hostPlatform
  const showWindowsShellMenu = shouldShowWindowsShellMenu({
    activeRuntimeEnvironmentId,
    hostPlatform: shellMenuHostPlatform,
    isWindowsClient,
    worktreeHasRemoteConnection: Boolean(worktreeConnectionId)
  })
  const isMacHost =
    shellMenuHostPlatform === 'darwin' ||
    (!showWindowsShellMenu && !worktreeConnectionId && navigator.userAgent.includes('Mac'))
  const shellOptions = useMemo(
    () =>
      buildIdeRunShellOptions({
        showWindowsShellMenu,
        isWslWorktree,
        defaultWindowsShell,
        isMacHost,
        windowsTerminalCapabilities,
        t
      }),
    [
      defaultWindowsShell,
      isMacHost,
      isWslWorktree,
      showWindowsShellMenu,
      t,
      windowsTerminalCapabilities
    ]
  )

  if (!isEnabled) {
    return null
  }

  const externalBlocked =
    isRevealOrEditorOpenBlocked(revealOwner) ||
    revealOwner === 'unresolved' ||
    !window.api?.shell?.runInExternalTerminal
  const effectiveDestination: IdeRunDestination =
    preference.destination === 'external' && !externalBlocked ? 'external' : 'bottom'
  const effectiveShell = shellOptions.some((option) => option.id === preference.shell)
    ? preference.shell
    : 'default'
  const activeShellOption =
    shellOptions.find((option) => option.id === effectiveShell) ?? shellOptions[0]
  const language = detectLanguage(file.filePath)
  const previewDialect = resolveIdeRunnerShellDialect(
    effectiveShell === 'default' ? activeShellOption?.iconShell : effectiveShell,
    showWindowsShellMenu ? (isWslWorktree ? 'posix' : 'powershell') : 'posix'
  )
  const canRunWithActiveShell = Boolean(
    getIdeFileRunnerSpec(file.filePath, language, previewDialect)
  )
  const isPotentiallyRunnable =
    canRunWithActiveShell ||
    Boolean(
      getIdeFileRunnerSpec(file.filePath, language, 'powershell') ||
      getIdeFileRunnerSpec(file.filePath, language, 'posix')
    )

  if (!isPotentiallyRunnable) {
    return null
  }

  const runFile = async (override?: {
    destination?: IdeRunDestination
    shell?: string
  }): Promise<void> => {
    if (running) {
      return
    }
    const targetDestination = override?.destination ?? effectiveDestination
    const targetShell = override?.shell ?? effectiveShell
    setRunning(true)
    try {
      if (targetDestination === 'external') {
        if (externalBlocked || !window.api?.shell?.runInExternalTerminal) {
          showLocalPathOpenBlockedToast()
          return
        }
        await requestEditorFileSave({ fileId: file.id })
        const result = await window.api.shell.runInExternalTerminal({
          filePath: file.filePath,
          shell: targetShell === 'default' ? undefined : targetShell,
          ownerHostId: revealOwner
        })
        if (result.ok) {
          return
        }
        if (result.reason === 'missing-runner') {
          toast.error(
            t(
              'ide.missingRunner',
              '{{commands}} was not found on PATH. Install it, add it to PATH, and restart the app.',
              { commands: result.candidates.join(' / ') }
            )
          )
          return
        }
        if (result.reason === 'missing-shell') {
          toast.error(
            t('ide.missingShell', 'The selected terminal shell is not installed on this computer.')
          )
          return
        }
        if (result.reason === 'remote-runtime-unsupported') {
          showLocalPathOpenBlockedToast()
          return
        }
        if (result.reason === 'unsupported-file') {
          toast.error(t('ide.noRunner', 'No runner is configured for this file type'))
          return
        }
        throw new Error(t('ide.runFailed', 'Could not start an external terminal for this file.'))
      }

      const runContext = resolveIdeRunContext(
        file.worktreeId,
        file.id,
        targetShell,
        windowsTerminalCapabilities.pwshAvailable
      )
      const targetPath = runContext.resolvePath(file.filePath)
      const spec = getIdeFileRunnerSpec(targetPath, language, runContext.shell)
      if (!spec) {
        toast.error(t('ide.noRunner', 'No runner is configured for this file type'))
        return
      }
      await requestEditorFileSave({ fileId: file.id })

      let executable = spec.candidates[0] ?? ''
      if (
        !runContext.isRemote &&
        !runContext.isWsl &&
        spec.candidates.length > 0 &&
        window.api?.preflight?.findCommandsOnPath
      ) {
        const found = await window.api.preflight.findCommandsOnPath({
          commands: [...spec.candidates]
        })
        const matched = spec.candidates.find((candidate) => found.includes(candidate))
        if (matched) {
          executable = matched
        }
      }

      const command = spec.buildCommand(executable)
      const launched = await runIdeCommandInBottomTerminal({
        worktreeId: file.worktreeId,
        fileId: file.id,
        label: `Run ${file.relativePath}`,
        command,
        shellOverride: runContext.shellOverride
      })
      if (!launched) {
        throw new Error(t('ide.runFailed', 'Could not start a terminal for this file.'))
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('ide.runFailed', 'Could not run this file.')
      )
    } finally {
      setRunning(false)
    }
  }

  const destinationLabel =
    effectiveDestination === 'external'
      ? t('ide.runDestinationExternal', 'External Terminal')
      : t('ide.runDestinationBottom', 'Bottom Terminal')
  const runTooltip = canRunWithActiveShell
    ? `${t('ide.runFile', 'Run file')} (${destinationLabel} · ${activeShellOption?.label ?? effectiveShell})`
    : t('ide.noRunner', 'No runner is configured for this file type')

  return (
    <DropdownMenu modal={false}>
      <div className="flex h-6 shrink-0 items-stretch overflow-hidden rounded border border-border/60 text-muted-foreground">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-center px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              disabled={!canRunWithActiveShell || running}
              onClick={() => void runFile()}
              aria-label={t('ide.runFile', 'Run file')}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {runTooltip}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center justify-center border-l border-border/60 px-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            disabled={running}
            aria-label={t('ide.runOptions', 'Run options')}
          >
            <ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-[210px]">
        <DropdownMenuLabel className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('ide.runInHeading', 'Run in')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={effectiveDestination}
          onValueChange={(value) => {
            const next: IdeRunDestination = value === 'external' ? 'external' : 'bottom'
            setIdeRunDestination(next)
            if (canRunWithActiveShell) {
              void runFile({ destination: next })
            }
          }}
        >
          <DropdownMenuRadioItem value="bottom" className="gap-2">
            <TerminalSquare className="size-3.5 text-muted-foreground" />
            <span>{t('ide.runDestinationBottom', 'Bottom Terminal')}</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="external" disabled={externalBlocked} className="gap-2">
            <ExternalLink className="size-3.5 text-muted-foreground" />
            <span>{t('ide.runDestinationExternal', 'External Terminal')}</span>
            {externalBlocked ? <LocalOnlyMenuHint /> : null}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('ide.runShellHeading', 'Shell')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={effectiveShell}
          onValueChange={(value) => {
            setIdeRunShell(value)
            const pickedOption = shellOptions.find((option) => option.id === value)
            const pickedDialect = resolveIdeRunnerShellDialect(
              value === 'default' ? pickedOption?.iconShell : value,
              showWindowsShellMenu ? (isWslWorktree ? 'posix' : 'powershell') : 'posix'
            )
            if (getIdeFileRunnerSpec(file.filePath, language, pickedDialect)) {
              void runFile({ shell: value })
            }
          }}
        >
          {shellOptions.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className={cn('gap-2')}>
              <ShellIcon shell={option.iconShell} size={13} />
              <span>{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
