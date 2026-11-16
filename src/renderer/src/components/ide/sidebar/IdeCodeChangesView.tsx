import { useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileDiff,
  History,
  RotateCcw,
  Undo2
} from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeFileChangeRecord
} from '../../../../../shared/ide-agent/ide-agent-types'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

type DiffLine = { kind: 'context' | 'add' | 'remove'; text: string }

function reviewStateLabel(state: IdeFileChangeRecord['acceptedState']): string {
  switch (state) {
    case 'pending':
      return 'Review'
    case 'accepted':
      return 'Kept'
    case 'reverted':
      return 'Reverted'
    case 'conflict':
      return 'Conflict'
  }
}

function computeLineDiff(beforeText: string | null, afterText: string | null): DiffLine[] {
  const beforeLines = beforeText !== null ? beforeText.split(/\r?\n/) : []
  const afterLines = afterText !== null ? afterText.split(/\r?\n/) : []
  if (beforeText === null) {
    return afterLines.slice(0, 200).map((text) => ({ kind: 'add', text }))
  }
  if (afterText === null) {
    return beforeLines.slice(0, 200).map((text) => ({ kind: 'remove', text }))
  }

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix++
  }

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const out: DiffLine[] = []
  const contextStart = Math.max(0, prefix - 2)
  for (let i = contextStart; i < prefix; i++) {
    out.push({ kind: 'context', text: beforeLines[i] })
  }
  for (let i = prefix; i < beforeLines.length - suffix; i++) {
    out.push({ kind: 'remove', text: beforeLines[i] })
  }
  for (let i = prefix; i < afterLines.length - suffix; i++) {
    out.push({ kind: 'add', text: afterLines[i] })
  }
  const afterTailStart = Math.max(prefix, afterLines.length - suffix)
  for (let i = afterTailStart; i < Math.min(afterLines.length, afterTailStart + 2); i++) {
    out.push({ kind: 'context', text: afterLines[i] })
  }
  return out.slice(0, 220)
}

function ChangeDiffRow({
  change,
  conversationId,
  scratchWorkspace
}: {
  change: IdeFileChangeRecord
  conversationId: string
  scratchWorkspace: boolean
}) {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const [expanded, setExpanded] = useState(false)
  const diffLines = useMemo(
    () => (expanded ? computeLineDiff(change.beforeContent, change.afterContent) : []),
    [change.afterContent, change.beforeContent, expanded]
  )

  return (
    <div className="rounded-md border border-border/70 bg-card/70 text-xs overflow-hidden">
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
          <span className="truncate font-mono text-[11px] font-medium text-foreground">
            {change.relativePath}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
            {change.changeType}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 capitalize',
              change.acceptedState === 'accepted' &&
                'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
              change.acceptedState === 'conflict' &&
                'border-destructive/40 bg-destructive/10 text-destructive',
              change.acceptedState === 'reverted' && 'text-muted-foreground'
            )}
          >
            {reviewStateLabel(change.acceptedState)}
          </Badge>
        </div>
      </div>

      {change.conflictMessage ? (
        <div className="border-t border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {change.conflictMessage}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-border/50 bg-muted/20 px-2.5 py-1.5">
        <span className="text-[10.5px] text-muted-foreground">
          {change.chunksApplied}/{change.totalChunks} chunks ·{' '}
          {new Date(change.updatedAt).toLocaleTimeString()}
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={() =>
              openWorkspaceFileInEditor(change.relativePath, undefined, scratchWorkspace)
            }
          >
            <ExternalLink className="mr-1 size-2.5" />
            Open
          </Button>
          {change.acceptedState === 'pending' ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                onClick={() =>
                  void decideChange({
                    conversationId,
                    action: 'accept',
                    changeId: change.id
                  })
                }
              >
                <Check className="mr-1 size-2.5" />
                Accept
              </Button>
              <Button
                size="xs"
                variant="outline"
                className="h-6 px-1.5 text-[10px]"
                onClick={() =>
                  void decideChange({
                    conversationId,
                    action: 'reject',
                    changeId: change.id
                  })
                }
              >
                <Undo2 className="mr-1 size-2.5" />
                Revert
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="scrollbar-sleek max-h-60 overflow-auto border-t border-border/60 bg-background/90 p-2 font-mono text-[11px] leading-snug">
          {diffLines.length === 0 ? (
            <span className="text-muted-foreground">No textual diff available.</span>
          ) : (
            diffLines.map((line, index) => (
              <div
                key={index}
                className={cn(
                  'whitespace-pre px-1.5',
                  line.kind === 'add' && 'bg-[var(--diff-added-background)] text-chat-diff-added',
                  line.kind === 'remove' &&
                    'bg-[var(--diff-removed-background)] text-chat-diff-removed',
                  line.kind === 'context' && 'text-muted-foreground'
                )}
              >
                {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                {line.text}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function IdeCodeChangesView({ conversation }: { conversation: IdeConversation | null }) {
  const decideChange = useIdeAgentStore((s) => s.decideChange)
  const changes = useMemo(
    () => [...(conversation?.fileChanges ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversation?.fileChanges]
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

  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2.5">
      {conversation && (running || totalFiles > 0) ? (
        <section className="rounded-xl border border-border bg-card p-3 shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
          <div className="flex items-start gap-2.5">
            {running ? (
              <LoadingSpinner className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileDiff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
                  {running ? 'Applying approved changes' : 'Changes ready for review'}
                </p>
                {totalFiles > 0 ? (
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {changedFiles}/{totalFiles} files
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                Review does not block execution. Accept marks a change as kept; Revert restores its
                checkpoint content.
              </p>
              {totalSteps > 0 ? <Progress value={progress} className="mt-2 h-1" /> : null}
            </div>
          </div>
        </section>
      ) : null}
      {conversation && checkpoints.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                <div className="text-[10.5px] text-muted-foreground">
                  {cp.files.length} files · {new Date(cp.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="h-6 px-2 text-[10.5px] shrink-0"
                onClick={() =>
                  void decideChange({
                    conversationId: conversation.id,
                    action: 'restore_checkpoint',
                    checkpointId: cp.id
                  })
                }
              >
                <RotateCcw className="mr-1 size-2.5" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
              scratchWorkspace={conversation.workspaceKey.startsWith('ide-scratch:')}
            />
          ))
        )}
      </div>
    </div>
  )
}
