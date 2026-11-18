import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileCode2,
  Pause,
  Play,
  Square
} from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdeConversation, IdeRunStatus } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  formatIdeFileCount,
  formatIdeStepCount,
  getIdeChatCopy,
  getIdeRunStageLabel,
  type IdeFineGrainedRunStage
} from './ide-chat-copy'
import { IdeToolActivityTimeline } from './IdeToolActivityTimeline'

const ACTIVE_STATUSES = new Set<IdeRunStatus>([
  'analyzing',
  'planning',
  'executing',
  'verifying',
  'paused',
  'awaiting_permission'
])

function formatElapsedDuration(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000))
  if (totalSec < 60) {
    return `${totalSec}s`
  }
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${mins}m ${secs}s`
}

export function IdeRunProgressCard({
  conversation
}: {
  conversation: IdeConversation
}): React.JSX.Element | null {
  const controlRun = useIdeAgentStore((s) => s.controlRun)
  const [expanded, setExpanded] = useState(true)
  const [tickNow, setTickNow] = useState<number | null>(null)

  const isActive = ACTIVE_STATUSES.has(conversation.status)
  const isRunning =
    conversation.status === 'analyzing' ||
    conversation.status === 'planning' ||
    conversation.status === 'executing' ||
    conversation.status === 'verifying'

  useEffect(() => {
    if (!isRunning) {
      return
    }
    const updateClock = () => setTickNow(Date.now())
    const immediateId = window.setTimeout(updateClock, 0)
    const intervalId = window.setInterval(updateClock, 1000)
    return () => {
      window.clearTimeout(immediateId)
      window.clearInterval(intervalId)
    }
  }, [isRunning, conversation.activeRunId])

  if (!isActive) {
    return null
  }

  const copy = getIdeChatCopy()
  const activeRunMessage = conversation.activeRunId
    ? conversation.messages.findLast(
        (m) => m.runId === conversation.activeRunId && m.role === 'assistant'
      )
    : undefined

  const executingPlan =
    conversation.status === 'executing' ||
    conversation.status === 'paused' ||
    conversation.status === 'verifying'
      ? conversation.plans.find(
          (candidate) =>
            candidate.id === conversation.activePlanId &&
            (candidate.status === 'executing' || candidate.status === 'approved')
        )
      : undefined
  const isAnsweringTurn = conversation.status === 'executing' && !executingPlan

  // Once prose is actively streaming into the assistant message, hide this thinking block.
  if (isAnsweringTurn && activeRunMessage?.streaming && activeRunMessage.text.trim().length > 0) {
    return null
  }

  const runActivity = conversation.activeRunId
    ? conversation.activity.filter((ev) => ev.runId === conversation.activeRunId)
    : []
  const hasReadActivity = runActivity.some(
    (ev) => ev.type === 'analysis.file_read' || ev.type === 'tool.search'
  )
  const latestMeaningfulEvent = runActivity
    .toReversed()
    .find(
      (ev) =>
        ev.type !== 'editor.edit_chunk' &&
        ev.type !== 'analysis.started' &&
        ev.type !== 'analysis.completed'
    )

  const completedSteps = executingPlan
    ? executingPlan.steps.filter((step) => step.status === 'completed').length
    : 0
  const totalSteps = executingPlan?.steps.length ?? 0
  const activeStep = executingPlan?.steps.find((step) => step.status === 'in_progress')
  const changedFiles = new Set(
    conversation.fileChanges
      .filter((change) => change.runId === conversation.activeRunId)
      .map((change) => change.relativePath)
  ).size
  const totalFiles = executingPlan?.affectedFiles.length ?? 0
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
  const paused = conversation.status === 'paused'

  const lastUserMsg = conversation.messages.findLast((m) => m.role === 'user')
  const startedAt = runActivity[0]?.timestamp ?? lastUserMsg?.createdAt ?? conversation.updatedAt
  const elapsedLabel =
    isRunning && tickNow !== null && tickNow >= startedAt
      ? formatElapsedDuration(tickNow - startedAt)
      : null

  const fineStage: IdeFineGrainedRunStage | null =
    latestMeaningfulEvent?.type === 'step.retrying' || latestMeaningfulEvent?.role === 'test-fixer'
      ? 'recovering_errors'
      : latestMeaningfulEvent?.type === 'command.started' && conversation.status === 'verifying'
        ? 'running_tests'
        : latestMeaningfulEvent?.type === 'tool.search' ||
            latestMeaningfulEvent?.type === 'tool.symbol_lookup'
          ? 'searching_repo'
          : latestMeaningfulEvent?.type === 'analysis.file_read'
            ? 'investigating_files'
            : latestMeaningfulEvent?.type === 'editor.file_opened' ||
                latestMeaningfulEvent?.type === 'file.modified' ||
                latestMeaningfulEvent?.type === 'file.created'
              ? 'editing_files'
              : null

  const stageLabel = getIdeRunStageLabel(
    conversation.status,
    false,
    isAnsweringTurn,
    hasReadActivity,
    fineStage
  )
  const stageDetail =
    activeStep?.title ??
    latestMeaningfulEvent?.summary ??
    (isAnsweringTurn
      ? copy.answeringDetail
      : conversation.status === 'analyzing'
        ? copy.analyzingDetail
        : conversation.status === 'planning'
          ? copy.planningDetail
          : copy.executingFallbackDetail)

  const canControl =
    Boolean(conversation.activeRunId) && !conversation.activeRunId?.startsWith('optimistic-run-')

  return (
    <div
      dir="ltr"
      className="mx-auto mt-3 w-full max-w-2xl px-0.5 text-left"
      aria-live="polite"
      aria-atomic="true"
      data-testid="ide-run-progress"
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex min-h-6 items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group/think inline-flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                {paused ? <Pause className="size-3.5" /> : <LoadingSpinner className="size-3.5" />}
              </span>

              <span
                className={cn(
                  'truncate text-xs font-medium',
                  isRunning ? 'shimmer shimmer-duration-2000 text-foreground/90' : 'text-foreground'
                )}
              >
                {stageLabel}
              </span>

              {executingPlan && totalSteps > 0 ? (
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  · {completedSteps}/{formatIdeStepCount(totalSteps)}
                </span>
              ) : null}

              {elapsedLabel ? (
                <span className="shrink-0 font-mono text-3xs tabular-nums text-muted-foreground/75">
                  {elapsedLabel}
                </span>
              ) : null}

              {expanded ? (
                <ChevronDown className="size-3 shrink-0 text-muted-foreground/70 transition-opacity group-hover/think:opacity-100" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/70 transition-opacity group-hover/think:opacity-100" />
              )}
            </button>
          </CollapsibleTrigger>

          {canControl && conversation.activeRunId ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {isRunning ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void controlRun({
                      conversationId: conversation.id,
                      runId: conversation.activeRunId!,
                      action: 'pause'
                    })
                  }
                >
                  <Pause className="size-2.5" />
                  {copy.pause}
                </Button>
              ) : paused ? (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void controlRun({
                      conversationId: conversation.id,
                      runId: conversation.activeRunId!,
                      action: 'resume'
                    })
                  }
                >
                  <Play className="size-2.5" />
                  {copy.resume}
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void controlRun({
                    conversationId: conversation.id,
                    runId: conversation.activeRunId!,
                    action: 'stop'
                  })
                }
              >
                <Square className="size-2.5" />
                {copy.stop}
              </Button>
            </div>
          ) : null}
        </div>

        <CollapsibleContent>
          <div className="ml-[6px] mt-1.5 space-y-2 border-l border-border/60 pl-3.5">
            <p className="truncate text-2xs text-muted-foreground">{stageDetail}</p>

            {executingPlan && totalSteps > 0 ? (
              <div className="space-y-1.5 pr-1">
                <Progress value={progress} className="h-1" />
                {totalFiles > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <FileCode2 className="size-3" />
                      {changedFiles} of {formatIdeFileCount(totalFiles)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {completedSteps > 0 ? (
                        <CheckCircle2 className="size-3 text-foreground/80" />
                      ) : (
                        <Circle className="size-3" />
                      )}
                      {paused ? copy.resumeHint : copy.autoContinueHint}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {runActivity.length > 0 ? (
              <IdeToolActivityTimeline
                events={runActivity}
                maxItems={6}
                scratchWorkspace={conversation.workspaceKey.startsWith('ide-scratch:')}
                compact
              />
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
