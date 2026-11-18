import { useEffect } from 'react'
import { Code2, MessageSquare, Plus, Sparkles, TerminalSquare } from 'lucide-react'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import {
  hasOpenIdeBottomTerminal,
  openNewIdeBottomTerminalTab,
  toggleIdeBottomTerminal
} from './ide-bottom-terminal-toggle'
import { IDE_OPEN_INLINE_EDIT_EVENT } from './IdeMonacoInlineAssist'
import { getIdeRunStageLabel } from './sidebar/ide-chat-copy'
import { openWorkspaceFileInEditor } from './sidebar/ide-workspace-navigation'

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const MOD_LABEL = isMacPlatform ? '⌘' : 'Ctrl+'

export function IdeWorkbenchBar(): React.JSX.Element | null {
  const appMode = useAppStore((s) => s.appMode)
  const activeView = useAppStore((s) => s.activeView)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeFileId = useAppStore((s) =>
    s.activeWorktreeId
      ? (s.activeFileIdByWorktree[s.activeWorktreeId] ?? s.activeFileId)
      : s.activeFileId
  )
  const activeFile = useAppStore((s) =>
    activeFileId ? (s.openFiles.find((f) => f.id === activeFileId) ?? null) : null
  )
  const cursorLine = useAppStore((s) =>
    activeFileId ? (s.editorCursorLine[activeFileId] ?? null) : null
  )
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const toggleRightSidebar = useAppStore((s) => s.toggleRightSidebar)
  const bottomTerminalOpen = useAppStore((s) =>
    s.appMode === 'ide' ? hasOpenIdeBottomTerminal(s, s.activeWorktreeId) : false
  )

  const conversation = useIdeAgentStore((s) => s.activeConversation)

  useEffect(() => {
    if (appMode !== 'ide' || activeView !== 'terminal') {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (!mod || event.altKey) {
        return
      }
      if (event.code !== 'Backquote' && event.key !== '`' && event.key !== '~') {
        return
      }
      const worktreeId = useAppStore.getState().activeWorktreeId
      if (!worktreeId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) {
        openNewIdeBottomTerminalTab(worktreeId)
      } else {
        toggleIdeBottomTerminal(worktreeId)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeView, appMode])

  if (appMode !== 'ide' || activeView !== 'terminal') {
    return null
  }

  const pendingChanges = (conversation?.fileChanges ?? []).filter(
    (c) => c.acceptedState === 'pending'
  )
  const isRunning =
    conversation !== null &&
    (conversation.status === 'analyzing' ||
      conversation.status === 'planning' ||
      conversation.status === 'executing' ||
      conversation.status === 'verifying')

  const scratchWorkspace = conversation?.workspaceKey.startsWith('ide-scratch:') === true

  return (
    <div
      dir="ltr"
      data-testid="ide-workbench-bar"
      className="flex h-6 min-h-6 shrink-0 select-none items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-2.5 text-left text-2xs text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded bg-accent/80 px-1.5 py-0.5 text-3xs font-semibold tracking-wide text-foreground">
          <Code2 className="size-3 shrink-0" />
          <span>IDE STUDIO</span>
        </span>

        {activeFile && activeFile.worktreeId === activeWorktreeId ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-3xs text-foreground/85">
            <FileTypeIcon filePath={activeFile.relativePath} className="size-3.5 shrink-0" />
            <span className="truncate">{activeFile.relativePath}</span>
            {cursorLine ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">Ln {cursorLine}</span>
            ) : null}
            {activeFile.language ? (
              <span className="hidden shrink-0 rounded border border-border/60 px-1 uppercase text-muted-foreground sm:inline">
                {activeFile.language}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="truncate text-3xs text-muted-foreground">
            {activeWorktreeId ? 'Select a file in Explorer or press Ctrl+P' : 'Ready'}
          </span>
        )}

        {isRunning && conversation ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-3xs font-medium text-foreground">
            <LoadingSpinner className="size-2.5 shrink-0" />
            <span className="shimmer shimmer-duration-2000">
              {getIdeRunStageLabel(conversation.status)}
            </span>
          </span>
        ) : pendingChanges.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const first = pendingChanges[0]
              if (first) {
                openWorkspaceFileInEditor(first.relativePath, undefined, scratchWorkspace)
              }
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-3xs font-medium text-foreground transition-colors hover:bg-accent/80"
          >
            <Sparkles className="size-2.5" />
            <span>
              {pendingChanges.length} pending {pendingChanges.length === 1 ? 'edit' : 'edits'}
            </span>
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {activeFile && activeFile.mode === 'edit' && activeFile.worktreeId === activeWorktreeId ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(IDE_OPEN_INLINE_EDIT_EVENT))}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs transition-colors hover:bg-accent hover:text-foreground"
            title={`Inline AI Edit (${MOD_LABEL}K)`}
          >
            <Sparkles className="size-2.5" />
            <span>Inline Edit</span>
            <kbd className="font-mono opacity-75">{MOD_LABEL}K</kbd>
          </button>
        ) : null}

        <div className="inline-flex items-center overflow-hidden rounded border border-border/60 bg-background/60">
          <button
            type="button"
            data-testid="ide-toggle-bottom-terminal-btn"
            aria-pressed={bottomTerminalOpen}
            onClick={() => {
              if (activeWorktreeId) {
                toggleIdeBottomTerminal(activeWorktreeId)
              } else {
                useAppStore.getState().openModal('worktree-palette')
              }
            }}
            className={cn(
              'inline-flex h-5 items-center gap-1 px-1.5 text-3xs transition-colors',
              bottomTerminalOpen
                ? 'bg-accent font-medium text-foreground'
                : 'hover:bg-accent hover:text-foreground'
            )}
            title={
              activeWorktreeId
                ? `Toggle Docked Bottom Terminal (${MOD_LABEL}\`)`
                : 'Open a project folder to launch a docked terminal'
            }
          >
            <TerminalSquare className="size-2.5" />
            <span>Terminal</span>
            <kbd className="hidden font-mono opacity-70 sm:inline">{MOD_LABEL}`</kbd>
          </button>
          {activeWorktreeId ? (
            <button
              type="button"
              data-testid="ide-new-bottom-terminal-btn"
              onClick={() => openNewIdeBottomTerminalTab(activeWorktreeId)}
              className="inline-flex h-5 items-center justify-center border-l border-border/60 px-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="New Bottom Terminal"
              title={`New Bottom Terminal (${MOD_LABEL}Shift+\`)`}
            >
              <Plus className="size-2.5" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-pressed={rightSidebarOpen}
          onClick={toggleRightSidebar}
          className={cn(
            'inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs transition-colors',
            rightSidebarOpen
              ? 'bg-accent font-medium text-foreground'
              : 'hover:bg-accent hover:text-foreground'
          )}
          title="Toggle Carver AI Chat"
        >
          <MessageSquare className="size-2.5" />
          <span>AI Chat</span>
        </button>
      </div>
    </div>
  )
}
