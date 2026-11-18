import { useMemo, useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  RotateCcw,
  Sparkles
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { useAppStore } from '@/store'
import {
  openIdeChangeDiffInEditor,
  useIdeDiffReviewStore
} from '@/store/ide-agent/ide-diff-review-store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'
import { computeIdeDiffStats } from './ide-diff-calculation'
import { openWorkspaceFileInEditor } from './sidebar/ide-workspace-navigation'

export function IdeEditorChangeReviewBar({
  activeFile,
  onReloadFile
}: {
  activeFile: OpenFile
  onReloadFile: () => void
}): React.JSX.Element | null {
  const appMode = useAppStore((s) => s.appMode)
  const conversation = useIdeAgentStore((s) => s.activeConversation)
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const reviewingChangeId = useIdeDiffReviewStore((s) => s.reviewingChangeId)
  const setReviewingChangeId = useIdeDiffReviewStore((s) => s.setReviewingChangeId)
  const [busy, setBusy] = useState(false)

  const normalizedActive = normalizeWorkspaceRelativePath(activeFile.relativePath).toLowerCase()
  const allChanges = conversation?.fileChanges
  const pendingChanges = useMemo(
    () => (allChanges ?? []).filter((c) => c.acceptedState === 'pending'),
    [allChanges]
  )

  const reviewedRecord = reviewingChangeId
    ? ((allChanges ?? []).find((c) => c.id === reviewingChangeId) ?? null)
    : null
  const pendingIdx = pendingChanges.findIndex(
    (c) => normalizeWorkspaceRelativePath(c.relativePath).toLowerCase() === normalizedActive
  )
  const currentChange =
    reviewedRecord &&
    (reviewedRecord.changeType === 'deleted' ||
      normalizeWorkspaceRelativePath(reviewedRecord.relativePath).toLowerCase() ===
        normalizedActive)
      ? reviewedRecord
      : pendingIdx !== -1
        ? pendingChanges[pendingIdx]
        : null

  const diffStats = useMemo(
    () =>
      currentChange
        ? computeIdeDiffStats(currentChange.beforeContent, currentChange.afterContent)
        : { added: 0, removed: 0 },
    [currentChange]
  )

  if (appMode !== 'ide' || !conversation || activeFile.mode !== 'edit') {
    return null
  }

  if (pendingChanges.length === 0 && !currentChange) {
    return null
  }

  const scratchWorkspace = conversation.workspaceKey.startsWith('ide-scratch:')
  const isShowingBeforeAfter = Boolean(currentChange && reviewingChangeId === currentChange.id)

  const jumpToPendingIndex = (nextIdx: number, openInDiff = isShowingBeforeAfter) => {
    if (pendingChanges.length === 0) {
      return
    }
    const wrapped = (nextIdx + pendingChanges.length) % pendingChanges.length
    const target = pendingChanges[wrapped]
    if (!target) {
      return
    }
    if (openInDiff) {
      openIdeChangeDiffInEditor(target, scratchWorkspace)
    } else {
      setReviewingChangeId(null)
      openWorkspaceFileInEditor(target.relativePath, undefined, scratchWorkspace)
    }
  }

  if (!currentChange) {
    const firstPending = pendingChanges[0]
    return (
      <div
        dir="ltr"
        data-testid="ide-editor-pending-changes-hint"
        className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-3 py-1 text-left text-2xs"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <Sparkles className="size-3 shrink-0 text-foreground/80" />
          <span className="truncate">
            <span className="font-medium text-foreground">{pendingChanges.length}</span>{' '}
            {pendingChanges.length === 1 ? 'modified file' : 'modified files'} awaiting Before /
            After review
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {firstPending ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => openIdeChangeDiffInEditor(firstPending, scratchWorkspace)}
            >
              <GitCompareArrows className="size-3" />
              Review Before / After
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  const currentIdx = pendingChanges.findIndex((c) => c.id === currentChange.id)
  const isPending = currentChange.acceptedState === 'pending'

  const handleSingleDecision = async (action: 'accept' | 'reject') => {
    setBusy(true)
    const remainingNext =
      pendingChanges.length > 1 && currentIdx !== -1
        ? pendingChanges[(currentIdx + 1) % pendingChanges.length]
        : null
    try {
      const ok = await decideChange({
        conversationId: conversation.id,
        action,
        changeId: currentChange.id
      })
      if (ok && action === 'reject' && currentChange.existedBefore) {
        onReloadFile()
      }
      if (ok && isShowingBeforeAfter && remainingNext && remainingNext.id !== currentChange.id) {
        openIdeChangeDiffInEditor(remainingNext, scratchWorkspace)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptAll = async () => {
    setBusy(true)
    try {
      for (const item of pendingChanges) {
        await decideChange({
          conversationId: conversation.id,
          action: 'accept',
          changeId: item.id
        })
      }
      setReviewingChangeId(null)
    } finally {
      setBusy(false)
    }
  }

  const verbLabel =
    currentChange.changeType === 'created'
      ? 'Created'
      : currentChange.changeType === 'deleted'
        ? 'Deleted'
        : 'Modified'

  return (
    <div
      dir="ltr"
      data-testid="ide-editor-change-review-bar"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-accent/35 px-3 py-1 text-left text-2xs"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Sparkles className="size-3.5 shrink-0 text-foreground" />
        <span className="font-medium text-foreground">{verbLabel} by Carver</span>
        <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums">
          <span className="font-medium text-chat-diff-added">+{diffStats.added}</span>
          <span className="font-medium text-chat-diff-removed">-{diffStats.removed}</span>
        </span>
        {currentIdx !== -1 ? (
          <Badge variant="referenceLabel">
            {currentIdx + 1} / {pendingChanges.length}
          </Badge>
        ) : (
          <Badge variant="secondary">{currentChange.acceptedState}</Badge>
        )}

        {pendingChanges.length > 1 && currentIdx !== -1 ? (
          <div className="flex items-center gap-0.5">
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              onClick={() => jumpToPendingIndex(currentIdx - 1)}
              aria-label="Previous modified file"
              title="Previous modified file"
            >
              <ChevronLeft className="size-3" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={busy}
              onClick={() => jumpToPendingIndex(currentIdx + 1)}
              aria-label="Next modified file"
              title="Next modified file"
            >
              <ChevronRight className="size-3" />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="xs"
          variant={isShowingBeforeAfter ? 'secondary' : 'outline'}
          onClick={() => setReviewingChangeId(isShowingBeforeAfter ? null : currentChange.id)}
        >
          <GitCompareArrows className="size-3" />
          {isShowingBeforeAfter ? 'Back to Code' : 'Before / After'}
        </Button>

        {isPending ? (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void handleSingleDecision('reject')}
            >
              <RotateCcw className="size-3" />
              Revert
            </Button>

            <Button size="xs" disabled={busy} onClick={() => void handleSingleDecision('accept')}>
              <Check className="size-3" />
              Accept
            </Button>

            {pendingChanges.length > 1 ? (
              <Button
                size="xs"
                variant="secondary"
                disabled={busy}
                onClick={() => void handleAcceptAll()}
              >
                <CheckCheck className="size-3" />
                Accept All ({pendingChanges.length})
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
