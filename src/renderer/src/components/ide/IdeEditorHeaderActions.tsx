import { Eye, Sparkles, TerminalSquare } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { hasOpenIdeBottomTerminal, toggleIdeBottomTerminal } from './ide-bottom-terminal-toggle'
import { IDE_OPEN_INLINE_EDIT_EVENT } from './IdeMonacoInlineAssist'
import { IdeLiveEditingBadge } from './IdeLiveEditingBadge'
import { IdeRunFileButton } from './IdeRunFileButton'

export function IdeEditorHeaderActions({
  activeFile,
  canOpenPreview,
  onOpenPreview
}: {
  activeFile: OpenFile
  canOpenPreview: boolean
  onOpenPreview: () => void
}): React.JSX.Element | null {
  const appMode = useAppStore((s) => s.appMode)
  const bottomTerminalOpen = useAppStore((s) =>
    s.appMode === 'ide' ? hasOpenIdeBottomTerminal(s, activeFile.worktreeId) : false
  )

  if (appMode !== 'ide') {
    if (!canOpenPreview) {
      return null
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onOpenPreview}
              aria-label="Preview"
            >
              <Eye size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Preview
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div dir="ltr" className="flex flex-shrink-0 items-center gap-1">
        {canOpenPreview ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onOpenPreview}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
                aria-label="Live Preview"
              >
                <Eye className="size-3" />
                <span>Preview</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              Open Live Preview beside editor
            </TooltipContent>
          </Tooltip>
        ) : null}

        {activeFile.mode === 'edit' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event(IDE_OPEN_INLINE_EDIT_EVENT))}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Inline AI Edit (Ctrl+K)"
              >
                <Sparkles className="size-3" />
                <span>AI Edit</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              Inline AI Edit in Editor (Ctrl+K)
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={bottomTerminalOpen}
              onClick={() => toggleIdeBottomTerminal(activeFile.worktreeId)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-2xs font-medium transition-colors',
                bottomTerminalOpen
                  ? 'border-border bg-accent text-foreground'
                  : 'border-border/70 bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-label="Toggle Docked Terminal"
            >
              <TerminalSquare className="size-3" />
              <span>Terminal</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Toggle Docked Bottom Terminal
          </TooltipContent>
        </Tooltip>

        <IdeLiveEditingBadge
          worktreeId={activeFile.worktreeId}
          relativePath={activeFile.relativePath}
        />
        <IdeRunFileButton file={activeFile} />
      </div>
    </TooltipProvider>
  )
}
