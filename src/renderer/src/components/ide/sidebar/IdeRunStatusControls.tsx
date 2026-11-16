import { AppIcon } from '@/components/icons/app-icon'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { isArabicIdeConversation } from '../../../../../shared/ide-agent/ide-language'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'
import { getIdeChatCopy, getIdeRunStageLabel } from './ide-chat-copy'

export function IdeRunStatusControls({ conversation }: { conversation: IdeConversation | null }) {
  const controlRun = useIdeAgentStore((s) => s.controlRun)

  if (!conversation) {
    return null
  }

  const isRunning =
    conversation.status === 'analyzing' ||
    conversation.status === 'planning' ||
    conversation.status === 'executing' ||
    conversation.status === 'verifying'
  const isPaused = conversation.status === 'paused'
  const canRetry =
    conversation.activeRunId !== null &&
    (conversation.status === 'failed' || conversation.status === 'canceled')

  if (!isRunning && !isPaused && !canRetry && conversation.status !== 'awaiting_approval') {
    return null
  }

  const arabic = isArabicIdeConversation(conversation.messages)
  const copy = getIdeChatCopy(arabic)
  const executingPlan = conversation.plans.some(
    (candidate) =>
      candidate.id === conversation.activePlanId &&
      (candidate.status === 'executing' || candidate.status === 'approved')
  )
  const isAnsweringTurn = conversation.status === 'executing' && !executingPlan
  const statusLabel = getIdeRunStageLabel(conversation.status, arabic, isAnsweringTurn)

  return (
    <div
      dir={arabic ? 'rtl' : 'ltr'}
      className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1 text-2xs"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {isRunning ? (
          <LoadingSpinner className="size-3 text-muted-foreground" />
        ) : (
          <AppIcon name="security" className="size-3 text-muted-foreground" />
        )}
        <span className="truncate font-medium text-foreground">{statusLabel}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isRunning && conversation.activeRunId ? (
          <>
            <Button
              size="xs"
              variant="outline"
              className="h-6 px-2 text-3xs"
              onClick={() =>
                void controlRun({
                  conversationId: conversation.id,
                  runId: conversation.activeRunId!,
                  action: 'pause'
                })
              }
            >
              <AppIcon name="pause" className="size-2.5" />
              {copy.pause}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 px-2 text-3xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                void controlRun({
                  conversationId: conversation.id,
                  runId: conversation.activeRunId!,
                  action: 'stop'
                })
              }
            >
              <AppIcon name="stop" className="size-2.5" />
              {copy.stop}
            </Button>
          </>
        ) : null}
        {isPaused && conversation.activeRunId ? (
          <>
            <Button
              size="xs"
              className="h-6 px-2 text-3xs"
              onClick={() =>
                void controlRun({
                  conversationId: conversation.id,
                  runId: conversation.activeRunId!,
                  action: 'resume'
                })
              }
            >
              <AppIcon name="run" className="size-2.5" />
              {copy.resume}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 px-2 text-3xs text-muted-foreground hover:text-foreground"
              onClick={() =>
                void controlRun({
                  conversationId: conversation.id,
                  runId: conversation.activeRunId!,
                  action: 'stop'
                })
              }
            >
              <AppIcon name="stop" className="size-2.5" />
              {copy.stop}
            </Button>
          </>
        ) : null}
        {canRetry && conversation.activeRunId ? (
          <Button
            size="xs"
            variant="outline"
            className="h-6 px-2 text-3xs"
            onClick={() =>
              void controlRun({
                conversationId: conversation.id,
                runId: conversation.activeRunId!,
                action: 'retry'
              })
            }
          >
            <AppIcon name="reset" className="size-2.5" />
            {copy.retry}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
