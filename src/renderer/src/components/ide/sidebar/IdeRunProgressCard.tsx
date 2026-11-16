import { CheckCircle2, Circle, FileCode2, Pause } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Progress } from '@/components/ui/progress'
import { isArabicIdeConversation } from '../../../../../shared/ide-agent/ide-language'
import type { IdeConversation, IdeRunStatus } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  formatIdeFileCount,
  formatIdeStepCount,
  getIdeChatCopy,
  getIdeRunStageLabel
} from './ide-chat-copy'

const ACTIVE_STATUSES = new Set<IdeRunStatus>([
  'analyzing',
  'planning',
  'executing',
  'verifying',
  'paused',
  'awaiting_permission'
])

export function IdeRunProgressCard({
  conversation
}: {
  conversation: IdeConversation
}): React.JSX.Element | null {
  if (!ACTIVE_STATUSES.has(conversation.status)) {
    return null
  }

  const arabic = isArabicIdeConversation(conversation.messages)
  const copy = getIdeChatCopy(arabic)

  // Only tie progress counters to a plan that is actively executing/paused/verifying—never to a prior plan during planning.
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

  // When an answer is already streaming prose into the chat, avoid duplicating a second status card below it.
  if (isAnsweringTurn && activeRunMessage?.streaming && activeRunMessage.text.trim().length > 0) {
    return null
  }

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

  const stageDetail =
    activeStep?.title ??
    (isAnsweringTurn
      ? copy.answeringDetail
      : conversation.status === 'analyzing'
        ? copy.analyzingDetail
        : conversation.status === 'planning'
          ? copy.planningDetail
          : copy.executingFallbackDetail)

  return (
    <div
      dir={arabic ? 'rtl' : 'ltr'}
      className="mx-auto mt-4 w-full max-w-2xl rounded-xl border border-border bg-card px-3.5 py-3 shadow-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
      aria-live="polite"
      aria-atomic="true"
      data-testid="ide-run-progress"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">
          {paused ? <Pause className="size-4" /> : <LoadingSpinner className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              {getIdeRunStageLabel(conversation.status, arabic, isAnsweringTurn)}
            </p>
            {executingPlan && totalSteps > 0 ? (
              <span className="text-2xs tabular-nums text-muted-foreground">
                {arabic
                  ? `${completedSteps} من ${formatIdeStepCount(totalSteps, true)}`
                  : `${completedSteps} of ${formatIdeStepCount(totalSteps, false)}`}
              </span>
            ) : null}
          </div>

          <p dir="auto" className="mt-0.5 truncate text-2xs text-muted-foreground">
            {stageDetail}
          </p>

          {executingPlan && totalSteps > 0 ? (
            <Progress value={progress} className="mt-2 h-1" />
          ) : null}

          {executingPlan && totalFiles > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 tabular-nums">
                <FileCode2 className="size-3" />
                {arabic
                  ? `${changedFiles} من ${formatIdeFileCount(totalFiles, true)}`
                  : `${changedFiles} of ${formatIdeFileCount(totalFiles, false)}`}
              </span>
              <span className="inline-flex items-center gap-1">
                {completedSteps > 0 ? (
                  <CheckCircle2 className="size-3 text-emerald-500" />
                ) : (
                  <Circle className="size-3" />
                )}
                {paused ? copy.resumeHint : copy.autoContinueHint}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
