import logo from '../../../../../resources/carver-logo.png'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { useAppStore } from '@/store'
import { useIdeDiffReviewStore } from '@/store/ide-agent/ide-diff-review-store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { IdeBeforeAfterDiffEditor } from './IdeBeforeAfterDiffEditor'
import { toggleIdeBottomTerminal } from './ide-bottom-terminal-toggle'

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const MOD_LABEL = isMacPlatform ? '⌘' : 'Ctrl+'

export function IdeEmptyEditorWatermark({
  onNewTerminal
}: {
  onNewTerminal: () => void
}): React.JSX.Element {
  const quickOpenShortcut = useOptionalShortcutLabel('worktree.quickOpen')
  const searchShortcut = useOptionalShortcutLabel('sidebar.search.toggle')
  const terminalShortcut = useOptionalShortcutLabel('tab.newTerminal')
  const chatShortcut = useOptionalShortcutLabel('sidebar.right.toggle')
  const reviewingChangeId = useIdeDiffReviewStore((s) => s.reviewingChangeId)
  const setReviewingChangeId = useIdeDiffReviewStore((s) => s.setReviewingChangeId)
  const activeReviewChange = useIdeAgentStore((s) =>
    reviewingChangeId
      ? (s.activeConversation?.fileChanges.find((c) => c.id === reviewingChangeId) ?? null)
      : null
  )

  if (activeReviewChange) {
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden bg-editor-surface">
        <IdeBeforeAfterDiffEditor
          change={activeReviewChange}
          onClose={() => setReviewingChangeId(null)}
        />
      </div>
    )
  }

  const hints = [
    {
      id: 'quick-open',
      label: 'Go to File',
      shortcut: quickOpenShortcut ?? `${MOD_LABEL}P`,
      onClick: () => useAppStore.getState().openModal('quick-open')
    },
    {
      id: 'search',
      label: 'Find in Files',
      shortcut: searchShortcut,
      onClick: () => {
        const state = useAppStore.getState()
        if (!state.sidebarOpen) {
          state.setSidebarOpen(true)
        }
        state.setIdeDevelopmentView('search')
      }
    },
    {
      id: 'inline-ai',
      label: 'Inline AI Edit in Editor',
      shortcut: `${MOD_LABEL}K`,
      onClick: () => useAppStore.getState().openModal('quick-open')
    },
    {
      id: 'terminal',
      label: 'Docked Bottom Terminal',
      shortcut: terminalShortcut,
      onClick: () => {
        const wt = useAppStore.getState().activeWorktreeId
        if (wt) {
          toggleIdeBottomTerminal(wt)
        } else {
          onNewTerminal()
        }
      }
    },
    {
      id: 'ai-chat',
      label: 'Toggle Carver AI Chat',
      shortcut: chatShortcut,
      onClick: () => useAppStore.getState().toggleRightSidebar()
    }
  ]

  return (
    <div
      dir="ltr"
      className="absolute inset-0 flex select-none flex-col items-center justify-center bg-editor-surface px-6 text-left"
    >
      <img src={logo} alt="" aria-hidden className="size-16 object-contain opacity-25 grayscale" />
      <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground/70">
        Carver IDE Studio
      </p>
      <div className="mt-5 w-full max-w-[280px] space-y-1.5">
        {hints.map((hint) => (
          <button
            key={hint.id}
            type="button"
            onClick={hint.onClick}
            className="flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1 text-xs text-muted-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="truncate">{hint.label}</span>
            {hint.shortcut ? (
              <kbd
                dir="ltr"
                className="shrink-0 rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
              >
                {hint.shortcut}
              </kbd>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
