import type { Translate } from '@/i18n/use-translate'
import type { WindowsTerminalCapabilities } from '@/runtime/hosts/capabilities/windows-terminal-capabilities'
import { buildWindowsShellMenuEntries } from '@/components/tab-bar/tab-bar-windows-shell-options'

export type IdeRunShellOption = {
  id: string
  label: string
  iconShell: string
}

/** Build the ordered shell choices shown in the IDE Run File dropdown menu. */
export function buildIdeRunShellOptions({
  showWindowsShellMenu,
  isWslWorktree,
  defaultWindowsShell,
  isMacHost,
  windowsTerminalCapabilities,
  t
}: {
  showWindowsShellMenu: boolean
  isWslWorktree: boolean
  defaultWindowsShell: string
  isMacHost: boolean
  windowsTerminalCapabilities: WindowsTerminalCapabilities
  t: Translate
}): IdeRunShellOption[] {
  const options: IdeRunShellOption[] = [
    {
      id: 'default',
      label: t('ide.runShellDefault', 'Default'),
      iconShell: showWindowsShellMenu
        ? isWslWorktree
          ? 'wsl.exe'
          : defaultWindowsShell
        : isMacHost
          ? 'zsh'
          : 'bash'
    }
  ]

  if (showWindowsShellMenu) {
    const entries =
      buildWindowsShellMenuEntries(
        {
          showWindowsShellMenu: true,
          hasShellLauncher: true,
          projectRuntimeShellMenuMode: isWslWorktree ? 'wsl' : 'host',
          defaultWindowsShell,
          gitBashAvailable: windowsTerminalCapabilities.gitBashAvailable,
          wslAvailable: windowsTerminalCapabilities.wslAvailable
        },
        t
      ) ?? []
    for (const entry of entries) {
      options.push({
        id: entry.shell,
        label: entry.label,
        iconShell: entry.shell
      })
    }
    return options
  }

  const posixShells = isMacHost
    ? (['zsh', 'bash', 'sh'] as const)
    : (['bash', 'sh', 'zsh'] as const)
  for (const shell of posixShells) {
    options.push({ id: shell, label: shell, iconShell: shell })
  }
  return options
}
