import { useMemo, useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  GitCompareArrows,
  RotateCcw
} from 'lucide-react'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { openIdeChangeDiffInEditor } from '@/store/ide-agent/ide-diff-review-store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeFileChangeRecord
} from '../../../../../shared/ide-agent/ide-agent-types'
import { normalizeWorkspaceRelativePath } from '../../../../../shared/ide-agent/ide-plan-policy'
import {
  computeIdeDiffStats,
  computeIdeStructuredDiffLines,
  type IdeStructuredDiffRow
} from '../ide-diff-calculation'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

export function IdeInlineStructuredDiffPreview({
  beforeContent,
  afterContent,
  maxHeightClass = 'max-h-60'
}: {
  beforeContent: string | null
  afterContent: string | null
  maxHeightClass?: string
}): React.JSX.Element {
  const rows = useMemo(
    () => computeIdeStructuredDiffLines(beforeContent, afterContent, 2),
    [afterContent, beforeContent]
  )

  const keyedRows = useMemo(() => {
    const counts = new Map<string, number>()
    return rows.map((row: IdeStructuredDiffRow) => {
      const base =
        row.kind === 'gap'
          ? `gap:${row.hiddenCount}`
          : `${row.kind}:${row.oldLine ?? 'x'}:${row.newLine ?? 'y'}:${row.text.slice(0, 24)}`
      const seen = (counts.get(base) ?? 0) + 1
      counts.set(base, seen)
      return { key: `${base}#${seen}`, row }
    })
  }, [rows])

  if (keyedRows.length === 0) {
    return (
      <div className="px-2.5 py-2 text-2xs text-muted-foreground">
        No line-level textual changes to display.
      </div>
    )
  }

  return (
    <div
      dir="ltr"
      className={cn(
        'scrollbar-sleek overflow-auto border-t border-chat-code-border bg-chat-code-surface py-1 font-mono text-2xs leading-relaxed text-chat-foreground',
        maxHeightClass
      )}
    >
      {keyedRows.map(({ key, row }) => {
        if (row.kind === 'gap') {
          return (
            <div
              key={key}
              role="separator"
              className="select-none border-y border-chat-code-border/70 bg-muted/30 py-0.5 text-center text-3xs text-muted-foreground"
            >
              ⋯ {row.hiddenCount} unchanged {row.hiddenCount === 1 ? 'line' : 'lines'}
            </div>
          )
        }
        return (
          <div
            key={key}
            className={cn(
              'flex items-start',
              row.kind === 'add' && 'bg-[var(--diff-added-background)]',
              row.kind === 'del' && 'bg-[var(--diff-removed-background)]'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'w-8 shrink-0 select-none pr-1 text-right tabular-nums text-3xs text-muted-foreground/75',
                row.kind === 'add' && 'bg-[var(--diff-added-gutter)]',
                row.kind === 'del' && 'bg-[var(--diff-removed-gutter)]'
              )}
            >
              {row.oldLine ?? ''}
            </span>
            <span
              aria-hidden
              className={cn(
                'w-8 shrink-0 select-none pr-1.5 text-right tabular-nums text-3xs text-muted-foreground/75',
                row.kind === 'add' && 'bg-[var(--diff-added-gutter)]',
                row.kind === 'del' && 'bg-[var(--diff-removed-gutter)]'
              )}
            >
              {row.newLine ?? ''}
            </span>
            <span
              aria-hidden
              className={cn(
                'w-4 shrink-0 select-none text-center font-semibold',
                row.kind === 'add' && 'text-chat-diff-added',
                row.kind === 'del' && 'text-chat-diff-removed'
              )}
            >
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre pr-2.5">{row.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function TurnChangeItemRow({
  change,
  conversationId,
  scratchWorkspace,
  defaultExpanded
}: {
  change: IdeFileChangeRecord
  conversationId: string
  scratchWorkspace: boolean
  defaultExpanded: boolean
}): React.JSX.Element {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [busy, setBusy] = useState(false)

  const stats = useMemo(
    () => computeIdeDiffStats(change.beforeContent, change.afterContent),
    [change.afterContent, change.beforeContent]
  )

  const handleDecision = async (action: 'accept' | 'reject') => {
    setBusy(true)
    try {
      await decideChange({
        conversationId,
        action,
        changeId: change.id
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/80">
      <div className="flex items-center justify-between gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <FileTypeIcon filePath={change.relativePath} className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-2xs font-medium text-foreground">
            {change.relativePath}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-3xs tabular-nums">
            <span className="font-medium text-chat-diff-added">+{stats.added}</span>
            <span className="font-medium text-chat-diff-removed">-{stats.removed}</span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {change.acceptedState !== 'pending' ? (
            <Badge variant={change.acceptedState === 'accepted' ? 'secondary' : 'referenceLabel'}>
              {change.acceptedState === 'accepted' ? 'Accepted' : 'Reverted'}
            </Badge>
          ) : null}

          <Button
            size="xs"
            variant="ghost"
            onClick={() => openIdeChangeDiffInEditor(change, scratchWorkspace)}
            title="Compare Before & After in main editor"
          >
            <GitCompareArrows className="size-3" />
            <span>Diff</span>
          </Button>

          {change.changeType !== 'deleted' ? (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                openWorkspaceFileInEditor(change.relativePath, undefined, scratchWorkspace)
              }
              aria-label={`Open ${change.relativePath}`}
              title="Open file in editor"
            >
              <ExternalLink className="size-3" />
            </Button>
          ) : null}

          {change.acceptedState === 'pending' ? (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={busy}
                onClick={() => void handleDecision('reject')}
                aria-label={`Revert ${change.relativePath}`}
                title="Revert to Before AI"
              >
                <RotateCcw className="size-3" />
              </Button>
              <Button
                size="xs"
                disabled={busy}
                onClick={() => void handleDecision('accept')}
                title="Accept changes"
              >
                <Check className="size-3" />
                <span>Accept</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <IdeInlineStructuredDiffPreview
          beforeContent={change.beforeContent}
          afterContent={change.afterContent}
          maxHeightClass="max-h-52"
        />
      ) : null}
    </div>
  )
}

export function IdeChatTurnChangesCard({
  conversation,
  runId,
  modifiedFiles,
  scratchWorkspace
}: {
  conversation: IdeConversation
  runId?: string
  modifiedFiles?: readonly string[]
  scratchWorkspace: boolean
}): React.JSX.Element | null {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [batchBusy, setBatchBusy] = useState(false)

  const resolvedChanges = useMemo(() => {
    const byRun = runId ? conversation.fileChanges.filter((c) => c.runId === runId) : []
    if (byRun.length > 0) {
      return byRun
    }
    if (!modifiedFiles || modifiedFiles.length === 0) {
      return []
    }
    const targetPaths = new Set(
      modifiedFiles.map((p) => normalizeWorkspaceRelativePath(p).toLowerCase())
    )
    const latestByPath = new Map<string, IdeFileChangeRecord>()
    for (const record of conversation.fileChanges) {
      const norm = normalizeWorkspaceRelativePath(record.relativePath).toLowerCase()
      if (!targetPaths.has(norm)) {
        continue
      }
      const prev = latestByPath.get(norm)
      if (!prev || record.updatedAt >= prev.updatedAt) {
        latestByPath.set(norm, record)
      }
    }
    return Array.from(latestByPath.values())
  }, [conversation.fileChanges, modifiedFiles, runId])

  const fallbackPaths = useMemo(() => {
    if (resolvedChanges.length > 0 || !modifiedFiles) {
      return []
    }
    return [...modifiedFiles]
  }, [modifiedFiles, resolvedChanges.length])

  const totals = useMemo(() => {
    let added = 0
    let removed = 0
    for (const item of resolvedChanges) {
      const s = computeIdeDiffStats(item.beforeContent, item.afterContent)
      added += s.added
      removed += s.removed
    }
    return { added, removed }
  }, [resolvedChanges])

  if (resolvedChanges.length === 0 && fallbackPaths.length === 0) {
    return null
  }

  if (resolvedChanges.length === 0) {
    return (
      <div
        dir="ltr"
        className="space-y-1.5 rounded-xl border border-border/60 bg-card/60 p-2.5 text-left"
      >
        <div className="text-2xs font-medium text-muted-foreground">
          Modified files ({fallbackPaths.length})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {fallbackPaths.map((filePath) => (
            <button
              key={filePath}
              type="button"
              onClick={() => openWorkspaceFileInEditor(filePath, undefined, scratchWorkspace)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-2xs text-foreground transition-colors hover:bg-accent/60"
            >
              <FileTypeIcon filePath={filePath} className="size-3.5 shrink-0" />
              <span>{filePath}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const pendingList = resolvedChanges.filter((c) => c.acceptedState === 'pending')

  const runBatchDecision = async (action: 'accept' | 'reject') => {
    setBatchBusy(true)
    try {
      for (const item of pendingList) {
        await decideChange({
          conversationId: conversation.id,
          action,
          changeId: item.id
        })
      }
    } finally {
      setBatchBusy(false)
    }
  }

  return (
    <div
      dir="ltr"
      data-testid="ide-chat-turn-changes-card"
      className="space-y-2 rounded-xl border border-border/70 bg-card/70 p-2.5 text-left shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-2xs">
          <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {resolvedChanges.length}{' '}
            {resolvedChanges.length === 1 ? 'file changed' : 'files changed'}
          </span>
          <span className="inline-flex items-center gap-1 font-mono tabular-nums">
            <span className="font-medium text-chat-diff-added">+{totals.added}</span>
            <span className="font-medium text-chat-diff-removed">-{totals.removed}</span>
          </span>
          {pendingList.length > 0 ? (
            <Badge variant="referenceLabel">{pendingList.length} pending</Badge>
          ) : null}
        </div>

        {pendingList.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              disabled={batchBusy}
              onClick={() => openIdeChangeDiffInEditor(pendingList[0], scratchWorkspace)}
              title="Inspect Side-by-Side Before & After in Editor"
            >
              <GitCompareArrows className="size-3" />
              <span>Compare</span>
            </Button>
            {pendingList.length > 1 ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={batchBusy}
                  onClick={() => void runBatchDecision('reject')}
                >
                  <RotateCcw className="size-3" />
                  <span>Revert All</span>
                </Button>
                <Button
                  size="xs"
                  disabled={batchBusy}
                  onClick={() => void runBatchDecision('accept')}
                >
                  <CheckCheck className="size-3" />
                  <span>Accept All</span>
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {resolvedChanges.map((change, index) => (
          <TurnChangeItemRow
            key={change.id}
            change={change}
            conversationId={conversation.id}
            scratchWorkspace={scratchWorkspace}
            defaultExpanded={resolvedChanges.length === 1 && index === 0}
          />
        ))}
      </div>
    </div>
  )
}
