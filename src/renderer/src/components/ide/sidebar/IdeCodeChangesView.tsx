import { useMemo, useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  GitCompareArrows,
  History,
  RotateCcw,
  Undo2
} from 'lucide-react'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { openIdeChangeDiffInEditor } from '@/store/ide-agent/ide-diff-review-store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeFileChangeRecord
} from '../../../../../shared/ide-agent/ide-agent-types'
import { computeIdeDiffStats } from '../ide-diff-calculation'
import { IdeInlineStructuredDiffPreview } from './IdeChatTurnChangesCard'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

function reviewStateLabel(state: IdeFileChangeRecord['acceptedState']): string {
  switch (state) {
    case 'pending':
      return 'Pending'
    case 'accepted':
      return 'Accepted'
    case 'reverted':
      return 'Reverted'
    case 'conflict':
      return 'Conflict'
  }
}

function ChangeDiffRow({
  change,
  conversationId,
  scratchWorkspace,
  disabled
}: {
  change: IdeFileChangeRecord
  conversationId: string
  scratchWorkspace: boolean
  disabled: boolean
}) {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const stats = useMemo(
    () => computeIdeDiffStats(change.beforeContent, change.afterContent),
    [change.afterContent, change.beforeContent]
  )

  const runDecision = async (action: 'accept' | 'reject') => {
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
    <div
      dir="ltr"
      className="overflow-hidden rounded-lg border border-border/70 bg-card/70 text-left text-xs"
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
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
          <Badge variant="referenceLabel">{change.changeType}</Badge>
          <Badge
            variant={
              change.acceptedState === 'conflict'
                ? 'destructive'
                : change.acceptedState === 'accepted'
                  ? 'secondary'
                  : 'referenceLabel'
            }
          >
            {reviewStateLabel(change.acceptedState)}
          </Badge>
        </div>
      </div>

      {change.conflictMessage ? (
        <div className="border-t border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-2xs text-destructive">
          {change.conflictMessage}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-border/50 bg-muted/20 px-2.5 py-1.5">
        <span className="text-3xs tabular-nums text-muted-foreground">
          {new Date(change.updatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() => openIdeChangeDiffInEditor(change, scratchWorkspace)}
            title="Compare Side-by-Side Before & After in main editor"
          >
            <GitCompareArrows className="size-2.5" />
            Before / After
          </Button>
          {change.changeType !== 'deleted' ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                openWorkspaceFileInEditor(change.relativePath, undefined, scratchWorkspace)
              }
            >
              <ExternalLink className="size-2.5" />
              Open
            </Button>
          ) : null}
          {change.acceptedState === 'pending' ? (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || disabled}
                onClick={() => void runDecision('reject')}
              >
                <Undo2 className="size-2.5" />
                Revert
              </Button>
              <Button
                size="xs"
                disabled={busy || disabled}
                onClick={() => void runDecision('accept')}
              >
                <Check className="size-2.5" />
                Accept
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <IdeInlineStructuredDiffPreview
          beforeContent={change.beforeContent}
          afterContent={change.afterContent}
          maxHeightClass="max-h-60"
        />
      ) : null}
    </div>
  )
}

export function IdeCodeChangesView({ conversation }: { conversation: IdeConversation | null }) {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const changes = useMemo(
    () => [...(conversation?.fileChanges ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversation?.fileChanges]
  )
  const pendingChanges = useMemo(
    () => changes.filter((c) => c.acceptedState === 'pending'),
    [changes]
  )
  const checkpoints = useMemo(
    () => [...(conversation?.checkpoints ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [conversation?.checkpoints]
  )
  const plan = conversation?.plans.find((candidate) => candidate.id === conversation.activePlanId)
  const completedSteps = plan?.steps.filter((step) => step.status === 'completed').length ?? 0
  const totalSteps = plan?.steps.length ?? 0
  const totalFiles = plan?.affectedFiles.length ?? 0
  const changedFiles = new Set(changes.map((change) => change.relativePath)).size
  const running =
    conversation?.status === 'analyzing' ||
    conversation?.status === 'planning' ||
    conversation?.status === 'executing' ||
    conversation?.status === 'verifying'
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  const scratchWorkspace = conversation?.workspaceKey.startsWith('ide-scratch:') === true

  const runBatchDecision = async (action: 'accept' | 'reject') => {
    if (!conversation) {
      return
    }
    setBatchBusy(true)
    try {
      for (const item of pendingChanges) {
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
      className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2.5 text-left"
    >
      {conversation && (running || totalFiles > 0 || pendingChanges.length > 0) ? (
        <section className="rounded-xl border border-border bg-card p-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            {running ? (
              <LoadingSpinner className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileDiff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
                  {running ? 'Applying approved changes' : 'Review Before & After changes'}
                </p>
                {totalFiles > 0 ? (
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {changedFiles}/{totalFiles} files
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                Inspect side-by-side Before & After in the editor, then Accept or Revert each file.
              </p>
              {totalSteps > 0 ? <Progress value={progress} className="mt-2 h-1" /> : null}
              {!running && pendingChanges.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={batchBusy}
                    onClick={() => openIdeChangeDiffInEditor(pendingChanges[0], scratchWorkspace)}
                  >
                    <GitCompareArrows className="size-3" />
                    Compare in Editor
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={batchBusy}
                    onClick={() => void runBatchDecision('reject')}
                  >
                    <RotateCcw className="size-3" />
                    Revert All
                  </Button>
                  <Button
                    size="xs"
                    disabled={batchBusy}
                    onClick={() => void runBatchDecision('accept')}
                  >
                    <CheckCheck className="size-3" />
                    Accept All ({pendingChanges.length})
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {conversation && checkpoints.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Checkpoints ({checkpoints.length})
          </div>
          {checkpoints.map((cp) => (
            <div
              key={cp.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-card/60 px-2.5 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <History className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{cp.label}</span>
                </div>
                <div className="text-3xs tabular-nums text-muted-foreground">
                  {cp.files.length} files · {new Date(cp.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="shrink-0"
                disabled={running || restoringCheckpointId !== null}
                onClick={async () => {
                  setRestoringCheckpointId(cp.id)
                  try {
                    await decideChange({
                      conversationId: conversation.id,
                      action: 'restore_checkpoint',
                      checkpointId: cp.id
                    })
                  } finally {
                    setRestoringCheckpointId(null)
                  }
                }}
              >
                <RotateCcw className="size-2.5" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tracked File Changes ({changes.length})
        </div>
        {!conversation || changes.length === 0 ? (
          <div className="flex h-36 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <FileDiff className="mb-2 size-5 opacity-50" />
            <span>No AI file modifications in this conversation yet.</span>
          </div>
        ) : (
          changes.map((change) => (
            <ChangeDiffRow
              key={change.id}
              change={change}
              conversationId={conversation.id}
              scratchWorkspace={scratchWorkspace}
              disabled={running}
            />
          ))
        )}
      </div>
    </div>
  )
}
