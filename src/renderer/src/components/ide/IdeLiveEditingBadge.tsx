import { useState } from 'react'
import { Check, Loader2, Sparkles, Undo2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'

export function IdeLiveEditingBadge({
  worktreeId,
  relativePath
}: {
  worktreeId?: string
  relativePath: string
}) {
  const t = useTranslate()
  const appMode = useAppStore((s) => s.appMode)
  const highlight = useAppStore((s) => s.ideActiveEditHighlight)
  const conversation = useIdeAgentStore((s) => s.activeConversation)
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [busyAction, setBusyAction] = useState<'accept' | 'reject' | null>(null)

  if (appMode !== 'ide') {
    return null
  }

  const cleanTarget = normalizeWorkspaceRelativePath(relativePath).toLowerCase()
  const isAnimating =
    highlight !== null &&
    (highlight.status === 'streaming' || highlight.status === 'revealing') &&
    (!highlight.worktreeId || !worktreeId || highlight.worktreeId === worktreeId) &&
    normalizeWorkspaceRelativePath(highlight.relativePath).toLowerCase() === cleanTarget

  if (isAnimating && highlight) {
    const modeTag =
      highlight.status === 'streaming'
        ? t('ide.liveEdit.streaming', 'Streaming')
        : t('ide.liveEdit.revealing', 'Applying')
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-2xs font-medium text-foreground"
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

  const sameWorkspace = !worktreeId || conversation?.workspaceKey === worktreeId
  const pendingChange = sameWorkspace
    ? (conversation?.fileChanges ?? []).findLast(
        (c) =>
          c.acceptedState === 'pending' &&
          normalizeWorkspaceRelativePath(c.relativePath).toLowerCase() === cleanTarget
      )
    : undefined

  if (pendingChange && conversation) {
    const handleDecision = async (action: 'accept' | 'reject') => {
      if (busyAction) {
        return
      }
      setBusyAction(action)
      try {
        await decideChange({
          conversationId: conversation.id,
          action,
          changeId: pendingChange.id
        })
      } finally {
        setBusyAction(null)
      }
    }

    return (
      <div
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-2xs"
        data-testid="ide-pending-change-controls"
      >
        <span className="px-1 text-muted-foreground">{t('ide.liveEdit.aiEdit', 'AI edit')}</span>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void handleDecision('accept')}
          className="inline-flex items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busyAction === 'accept' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Check className="size-3" />
          )}
          <span>{t('ide.liveEdit.keep', 'Keep')}</span>
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void handleDecision('reject')}
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {busyAction === 'reject' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Undo2 className="size-3" />
          )}
          <span>{t('ide.liveEdit.revert', 'Revert')}</span>
        </button>
      </div>
    )
  }

  return null
}
