import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { persistAgentLaunchTabOrder } from '@/lib/agent-session/launch/pane/launch-agent-tab-order'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import { setGroupRatioThroughLayoutOwner } from '@/components/tab-group/tab-group-layout-owner-commands'
import { resolveWindowsShellLaunchTarget } from '@/components/tab-bar/windows-shell-launch'
import { sendRuntimePtyInputVerified } from '@/runtime/hosted-terminals/input/runtime-terminal-verified-input'
import { resolvePrimaryLayoutPtyId } from '@/store/terminals/terminal-pty-identities'
import { resolveTerminalCreatedShell } from '@/store/terminals/terminal-created-shell'
import {
  getRemoteConnectionIdForWorktree,
  isWindowsRendererRuntime,
  worktreeUsesWslPath
} from '@/store/terminals/terminal-workspace-routing'
import type { AgentStartupShell } from '../../../../shared/agent-launch/startup/tui-agent-startup-shell'
import { resolveIdeRunnerShellDialect } from '../../../../shared/ide/ide-file-runner'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import {
  resolveHostAgentStartupShell,
  WINDOWS_GIT_BASH_SHELL
} from '../../../../shared/windows-terminal-shell'
import { toWslExecutionSpace } from '../../../../shared/wsl-paths'
import { makePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import { collectLeafIds } from '../../../../shared/workspace-layout/terminal-topology/terminal-pane-layout-tree'
import {
  findBottomTerminalTarget,
  findVerticalSplitPathForGroups,
  resolveEditorGroupId
} from './ide-bottom-terminal-layout'

const IDE_BOTTOM_TERMINAL_SPLIT_RATIO = 0.68
const runnerTabIdByWorktreeAndShell = new Map<string, string>()

function normalizeShellCategory(shell: string | undefined): string {
  const leaf = shell?.trim().replaceAll('\\', '/').split('/').pop()?.toLowerCase()
  if (!leaf) {
    return 'default'
  }
  if (
    leaf === 'powershell.exe' ||
    leaf === 'pwsh.exe' ||
    leaf === 'powershell' ||
    leaf === 'pwsh'
  ) {
    return 'powershell'
  }
  if (leaf === 'cmd.exe' || leaf === 'cmd') {
    return 'cmd'
  }
  if (leaf === WINDOWS_GIT_BASH_SHELL || leaf === 'bash.exe') {
    return WINDOWS_GIT_BASH_SHELL
  }
  return leaf === 'wsl.exe' || leaf === 'wsl' ? 'wsl' : leaf
}

function resolveRequestedShellOverride(
  state: AppState,
  shellChoice: string | undefined,
  pwshAvailable: boolean
): string | undefined {
  if (!shellChoice || shellChoice === 'default') {
    return undefined
  }
  if (shellChoice === 'powershell.exe') {
    const impl = state.settings?.terminalWindowsPowerShellImplementation ?? 'auto'
    return resolveWindowsShellLaunchTarget('powershell.exe', impl, pwshAvailable)
  }
  return shellChoice
}

function resolveBottomRunnerSelection(
  state: AppState,
  worktreeId: string,
  fileId: string,
  shellOverride: string | undefined
) {
  const requestedCategory = shellOverride ? normalizeShellCategory(shellOverride) : null
  const cacheKey = `${worktreeId}\0${requestedCategory ?? 'default'}`
  const defaultShellOverride = resolveTerminalCreatedShell(
    state,
    worktreeId,
    undefined,
    undefined,
    undefined
  ).createdShellOverride
  const effectiveDefaultCategory = normalizeShellCategory(
    defaultShellOverride ??
      (isWindowsRendererRuntime()
        ? (state.settings?.terminalWindowsShell ?? 'powershell.exe')
        : undefined)
  )
  const editorGroupId = resolveEditorGroupId(state, worktreeId, fileId)
  const target = findBottomTerminalTarget(state, worktreeId, editorGroupId, {
    preferredTabId: runnerTabIdByWorktreeAndShell.get(cacheKey),
    matchesShell: requestedCategory
      ? (tabShell) =>
          (tabShell ? normalizeShellCategory(tabShell) : effectiveDefaultCategory) ===
          requestedCategory
      : undefined
  })
  return { cacheKey, requestedCategory, defaultShellOverride, editorGroupId, target }
}

function resolveTabPtyId(state: AppState, worktreeId: string, tabId: string): string | null {
  const layout = state.terminalLayoutsByTabId[tabId]
  const layoutPtyId = layout ? resolvePrimaryLayoutPtyId(layout) : null
  if (layoutPtyId) {
    return layoutPtyId
  }
  const listedPtyId = state.ptyIdsByTabId[tabId]?.[0]
  if (listedPtyId) {
    return listedPtyId
  }
  return (state.tabsByWorktree[worktreeId] ?? []).find((tab) => tab.id === tabId)?.ptyId ?? null
}

function isTabStarting(state: AppState, tabId: string): boolean {
  if (state.pendingStartupByTabId[tabId]) {
    return true
  }
  const layout = state.terminalLayoutsByTabId[tabId]
  if (!layout) {
    return false
  }
  const leafId = layout.activeLeafId ?? collectLeafIds(layout.root)[0]
  return Boolean(
    leafId && state.terminalPaneStartsByPaneKey[makePaneKey(tabId, leafId)]?.status === 'starting'
  )
}

function waitForTabPtyId(
  worktreeId: string,
  tabId: string,
  timeoutMs = 5000
): Promise<string | null> {
  const immediate = resolveTabPtyId(useAppStore.getState(), worktreeId, tabId)
  if (immediate) {
    return Promise.resolve(immediate)
  }
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    const finish = (ptyId: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      unsubscribe?.()
      resolve(ptyId)
    }
    const timer = setTimeout(
      () => finish(resolveTabPtyId(useAppStore.getState(), worktreeId, tabId)),
      timeoutMs
    )
    unsubscribe = useAppStore.subscribe((next) => {
      const found = resolveTabPtyId(next, worktreeId, tabId)
      if (found) {
        finish(found)
      } else if (!(next.tabsByWorktree[worktreeId] ?? []).some((t) => t.id === tabId)) {
        finish(null)
      }
    })
  })
}

export type IdeRunContext = {
  isRemote: boolean
  isWsl: boolean
  shell: AgentStartupShell
  shellOverride: string | undefined
  resolvePath: (filePath: string) => string
}

function toWslRunPath(filePath: string): string {
  const executionPath = toWslExecutionSpace(filePath)
  const driveMatch = executionPath.match(/^([A-Za-z]):[/\\](.*)$/)
  return driveMatch
    ? `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replaceAll('\\', '/')}`
    : executionPath
}

function toHostPlatform(raw: string | null | undefined): NodeJS.Platform | null {
  return raw === 'win32' || raw === 'darwin' || raw === 'linux' ? raw : null
}

export function resolveIdeRunContext(
  worktreeId: string,
  fileId: string,
  shellChoice?: string,
  pwshAvailable = false
): IdeRunContext {
  const state = useAppStore.getState()
  const shellOverride = resolveRequestedShellOverride(state, shellChoice, pwshAvailable)
  const { requestedCategory, defaultShellOverride, target } = resolveBottomRunnerSelection(
    state,
    worktreeId,
    fileId,
    shellOverride
  )
  const remoteConnectionId = getRemoteConnectionIdForWorktree(state, worktreeId)
  const isRemote = Boolean(remoteConnectionId)
  const isWslRun = worktreeUsesWslPath(state, worktreeId) || requestedCategory === 'wsl'
  if (isWslRun) {
    return { isRemote, isWsl: true, shell: 'posix', shellOverride, resolvePath: toWslRunPath }
  }
  const remotePlatform = remoteConnectionId
    ? toHostPlatform(state.sshConnectionStates.get(remoteConnectionId)?.remotePlatform)
    : null
  const reusedTabShell =
    target.kind === 'reuse-tab'
      ? (state.tabsByWorktree[worktreeId] ?? []).find((entry) => entry.id === target.tab.entityId)
          ?.shellOverride
      : undefined
  const activeShell = shellOverride ?? reusedTabShell ?? defaultShellOverride
  const platform: NodeJS.Platform = isRemote
    ? (remotePlatform ?? 'linux')
    : isWindowsRendererRuntime()
      ? 'win32'
      : 'linux'
  const hostShell =
    resolveHostAgentStartupShell({
      platform,
      isRemote,
      tabShellOverride: activeShell,
      hostTerminalWindowsShell: isRemote ? undefined : state.settings?.terminalWindowsShell
    }) ?? 'posix'

  return {
    isRemote,
    isWsl: false,
    shell: resolveIdeRunnerShellDialect(activeShell, hostShell),
    shellOverride,
    resolvePath: (filePath) => filePath
  }
}

function createBottomRunnerTab(args: {
  worktreeId: string
  editorGroupId: string
  targetGroupId: string | undefined
  splitDown: boolean
  shellOverride: string | undefined
  cacheKey: string
  label: string
  command: string
}): { tabId: string } {
  const {
    worktreeId,
    editorGroupId,
    targetGroupId,
    splitDown,
    shellOverride,
    cacheKey,
    label,
    command
  } = args
  const created = useAppStore.getState().createTab(worktreeId, targetGroupId, shellOverride, {
    quickCommandLabel: label,
    pendingStartup: { command },
    ...(splitDown
      ? { split: { sourceGroupId: editorGroupId, splitDirection: 'down' as const, activate: true } }
      : {})
  })
  const nextState = useAppStore.getState()
  if (splitDown) {
    const bottomGroupId = nextState.unifiedTabsByWorktree[worktreeId]?.find(
      (entry) => entry.id === created.id || entry.entityId === created.id
    )?.groupId
    const layout = nextState.layoutByWorktree[worktreeId]
    const splitPath =
      layout && bottomGroupId
        ? findVerticalSplitPathForGroups(layout, editorGroupId, bottomGroupId)
        : null
    if (splitPath !== null) {
      if (ORCA_LAYOUT_OWNER_IS_MAIN) {
        setGroupRatioThroughLayoutOwner(worktreeId, splitPath, IDE_BOTTOM_TERMINAL_SPLIT_RATIO)
      } else {
        nextState.setTabGroupSplitRatio(worktreeId, splitPath, IDE_BOTTOM_TERMINAL_SPLIT_RATIO)
      }
    }
  }
  nextState.setActiveTabType('terminal', worktreeId)
  persistAgentLaunchTabOrder(worktreeId, created.id)
  focusTerminalTabSurface(created.id)
  runnerTabIdByWorktreeAndShell.set(cacheKey, created.id)
  return { tabId: created.id }
}

export async function runIdeCommandInBottomTerminal({
  worktreeId,
  fileId,
  label,
  command,
  shellOverride
}: {
  worktreeId: string
  fileId: string
  label: string
  command: string
  shellOverride?: string
}): Promise<{ tabId: string } | null> {
  if (!command.trim()) {
    return null
  }
  const state = useAppStore.getState()
  const { cacheKey, editorGroupId, target } = resolveBottomRunnerSelection(
    state,
    worktreeId,
    fileId,
    shellOverride
  )

  if (target.kind === 'reuse-tab') {
    state.activateTab(target.tab.id, { worktreeId })
    state.setActiveTabType('terminal', worktreeId)
    focusTerminalTabSurface(target.tab.entityId)
    const ptyId =
      resolveTabPtyId(state, worktreeId, target.tab.entityId) ??
      (isTabStarting(state, target.tab.entityId)
        ? await waitForTabPtyId(worktreeId, target.tab.entityId)
        : null)
    if (ptyId) {
      try {
        if (await sendRuntimePtyInputVerified(ptyId, `${command}\r`, 'driving')) {
          runnerTabIdByWorktreeAndShell.set(cacheKey, target.tab.id)
          return { tabId: target.tab.id }
        }
      } catch {
        // Dead or disconnected PTY: fall through to spawn a fresh runner tab in the bottom pane.
      }
    }
  }

  return createBottomRunnerTab({
    worktreeId,
    editorGroupId,
    targetGroupId: target.kind === 'split-down' ? undefined : target.groupId,
    splitDown: target.kind === 'split-down',
    shellOverride,
    cacheKey,
    label,
    command
  })
}
