import { Check, Sparkles, Undo2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'

export function IdeLiveEditingBadge({ relativePath }: { relativePath: string }) {
  const highlight = useAppStore((s) => s.ideActiveEditHighlight)
  const conversation = useIdeAgentStore((s) => s.activeConversation)
  const decideChange = useIdeAgentStore((s) => s.decideChange)

  const cleanTarget = normalizeWorkspaceRelativePath(relativePath).toLowerCase()
  const highlightActive =
    highlight !== null &&
    normalizeWorkspaceRelativePath(highlight.relativePath).toLowerCase() === cleanTarget

  const pendingChange = (conversation?.fileChanges ?? []).findLast(
    (c) =>
      c.acceptedState === 'pending' &&
      normalizeWorkspaceRelativePath(c.relativePath).toLowerCase() === cleanTarget
  )

  if (highlightActive && highlight) {
    const modeTag =
      highlight.status === 'streaming'
        ? 'Streaming'
        : highlight.status === 'revealing'
          ? 'Live preview'
          : 'Updated'
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-2xs font-medium text-foreground"
        title={highlight.label}
        data-testid="ide-live-editing-badge"
      >
        <Sparkles className="size-3 shrink-0 motion-safe:animate-pulse" />
        <span>
          {modeTag}
          {typeof highlight.progressPercent === 'number' && highlight.progressPercent < 100
            ? ` · ${highlight.progressPercent}%`
            : ''}
        </span>
      </span>
    )
  }

  if (pendingChange && conversation) {
    return (
      <div
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-2xs"
        data-testid="ide-pending-change-controls"
      >
        <span className="px-1 text-muted-foreground">AI edit</span>
        <button
          type="button"
          onClick={() =>
            void decideChange({
              conversationId: conversation.id,
              action: 'accept',
              changeId: pendingChange.id
            })
          }
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium text-emerald-600 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
          title="Keep AI changes"
        >
          <Check className="size-3" />
          <span>Keep</span>
        </button>
        <button
          type="button"
          onClick={() =>
            void decideChange({
              conversationId: conversation.id,
              action: 'reject',
              changeId: pendingChange.id
            })
          }
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Revert AI changes"
        >
          <Undo2 className="size-3" />
          <span>Revert</span>
        </button>
      </div>
    )
  }

  return null
}
