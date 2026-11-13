import {
  ChevronDown,
  ChevronRight,
  CircleStop,
  Loader2,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  StepForward,
  Users,
  X
} from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/class-names'
import type { CouncilMessage } from '../../../../../shared/council/council-contract'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { MODE_LABELS } from '../../council/council-session-execution'
import { NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS } from '../appearance/native-chat-appearance-style'
import { MultiModelAvatar } from './MultiModelAvatar'
import { MultiModelChatMessageRow, MultiModelPriorMessageRow } from './MultiModelChatMessage'
import type { MultiModelChatController } from './use-multi-model-chat'

/** What the chat's find bar needs from this transcript. */
export type MultiModelChatTranscriptHandle = {
  /** Bring a find match into the group transcript's view. */
  revealFindMatch: (match: Range) => void
}

/**
 * The group conversation lives in the normal chat timeline: earlier single-model
 * turns stay above it, and every participant replies as its real provider.
 */
export function MultiModelChatTranscript({
  group,
  priorMessages,
  agent,
  findRef,
  onFocusComposer
}: {
  group: MultiModelChatController
  priorMessages: readonly NativeChatMessage[]
  agent: string | null
  findRef?: React.RefObject<MultiModelChatTranscriptHandle | null>
  onFocusComposer?: () => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const session = group.session
  const messageCount = session?.messages.length ?? 0
  const lastContentLength = session?.messages.at(-1)?.content.length ?? 0
  const hasContent = messageCount > 0 || priorMessages.length > 0

  const revealFindMatch = useCallback((match: Range) => {
    const container = scrollRef.current
    const node =
      match.startContainer instanceof Element
        ? match.startContainer
        : match.startContainer.parentElement
    if (!container || !node) {
      return
    }
    const offset =
      node.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      container.clientHeight / 2
    container.scrollTop = Math.max(0, offset)
  }, [])
  useImperativeHandle(findRef, () => ({ revealFindMatch }), [revealFindMatch])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [messageCount, lastContentLength, group.isRunning])

  const completedResponses =
    session?.messages.filter(
      (message) => message.kind === 'response' && message.status === 'completed'
    ).length ?? 0
  const showDecision = completedResponses > 0 && !group.isRunning

  const handleReply = useCallback(
    (message: CouncilMessage) => {
      group.setReplyTarget?.(message)
      onFocusComposer?.()
    },
    [group, onFocusComposer]
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-chat-pane">
      <div
        ref={scrollRef}
        data-native-chat-scroll
        className="scrollbar-sleek relative h-full overflow-y-auto [scrollbar-gutter:stable_both_edges]"
      >
        <div className="px-3 pt-10 pb-10 sm:px-4">
          <div className={NATIVE_CHAT_TRANSCRIPT_COLUMN_CLASS} data-native-chat-transcript-column>
            <GroupHeader group={group} />
            {group.notice ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <span className="flex-1">{group.notice}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Dismiss"
                  onClick={group.dismissNotice}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ) : null}
            <SharedContextBanner group={group} />
            {hasContent ? null : <GroupInvitation group={group} />}
            {priorMessages.length > 0 ? (
              <section className="flex flex-col gap-4">
                <p className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Earlier in this chat
                </p>
                {priorMessages.map((message) => (
                  <MultiModelPriorMessageRow
                    key={message.id}
                    message={message}
                    agent={agent}
                    chatId={group.chatId}
                  />
                ))}
              </section>
            ) : null}
            {session?.messages.length ? (
              <div className="flex flex-col gap-5">
                {session.messages.map((message) => {
                  const replyTarget = message.replyToMessageId
                    ? session.messages.find(
                        (candidate) => candidate.id === message.replyToMessageId
                      )
                    : undefined
                  const rawExcerpt = replyTarget?.content.replace(/\s+/g, ' ').trim() ?? ''
                  const replyExcerpt =
                    rawExcerpt.length > 96
                      ? `${rawExcerpt.slice(0, 96).trimEnd()}…`
                      : rawExcerpt || undefined
                  const onJumpToReply = replyTarget
                    ? () =>
                        document
                          .getElementById(`council-msg-${replyTarget.id}`)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    : undefined
                  return (
                    <MultiModelChatMessageRow
                      key={message.id}
                      message={message}
                      mode={session.mode}
                      replyExcerpt={replyExcerpt}
                      onJumpToReply={onJumpToReply}
                      canRetry={!group.isRunning}
                      onRetry={() => group.retry(message)}
                      onReply={() => handleReply(message)}
                    />
                  )
                })}
              </div>
            ) : null}
            {session && !group.isRunning ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {showDecision ? (
                  <Button variant="outline" size="xs" onClick={group.requestDecision}>
                    <Sparkles className="size-3" /> Request final decision
                  </Button>
                ) : null}
                <Button variant="outline" size="xs" onClick={group.continueDiscussion}>
                  <StepForward className="size-3" /> Continue discussion
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SharedContextBanner({
  group
}: {
  group: MultiModelChatController
}): React.JSX.Element | null {
  const [previewOpen, setPreviewOpen] = useState(false)
  if (!group.sharedContext || (group.session?.messages.length ?? 0) > 0) {
    return null
  }
  const shareEnabled = group.sharePriorContext !== false
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <Checkbox
          id={`share-context-${group.chatId}`}
          checked={shareEnabled}
          aria-label="Share earlier chat text with group"
          onCheckedChange={(value) => group.setSharePriorContext?.(Boolean(value))}
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor={`share-context-${group.chatId}`}
            className="flex cursor-pointer items-center gap-1.5 font-medium text-chat-foreground"
          >
            <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
            <span>
              Share {group.sharedContext.messageCount} earlier visible{' '}
              {group.sharedContext.messageCount === 1 ? 'message' : 'messages'} on first turn
            </span>
          </label>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Text only — excludes tool output, hidden reasoning, system prompts, and redacted tokens.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setPreviewOpen((current) => !current)}
        >
          {previewOpen ? (
            <>
              <ChevronDown className="size-3" /> Hide context
            </>
          ) : (
            <>
              <ChevronRight className="size-3" /> Preview context
            </>
          )}
        </Button>
      </div>
      {previewOpen ? (
        <pre className="scrollbar-sleek max-h-40 overflow-y-auto rounded border border-border/60 bg-background/60 p-2 font-mono text-2xs whitespace-pre-wrap text-chat-foreground-faint">
          {group.sharedContext.preview}
        </pre>
      ) : null}
    </div>
  )
}

function GroupHeader({ group }: { group: MultiModelChatController }): React.JSX.Element {
  const session = group.session
  const canResumeIdlePaused = !group.isRunning && session?.status === 'paused'
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {group.participants.map((participant) => (
          <MultiModelAvatar
            key={participant.id}
            agent={participant.agent}
            size={30}
            className={cn(participant.moderator && 'ring-2 ring-foreground/25')}
          />
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
        <Users className="size-3.5" />
        <span>
          {group.participants.length} models · {MODE_LABELS[group.discussionMode]}
          {group.discussionMode === 'parallel' ? '' : ` · ${group.maxRounds} rounds`}
        </span>
        {session ? (
          <>
            <span>·</span>
            <span>
              Round {session.currentRound}/{session.maxRounds}
            </span>
            <span>·</span>
            <span className="capitalize">{group.isPaused ? 'paused' : session.status}</span>
          </>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-1">
        {group.isRunning ? (
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={group.isPaused ? group.resume : group.pause}
            >
              {group.isPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
              {group.isPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="xs" variant="outline" onClick={group.stop}>
              <CircleStop className="size-3" /> Stop
            </Button>
          </>
        ) : canResumeIdlePaused ? (
          <Button size="xs" variant="outline" onClick={group.resume}>
            <Play className="size-3" /> Resume
          </Button>
        ) : null}
      </div>
    </header>
  )
}

function GroupInvitation({ group }: { group: MultiModelChatController }): React.JSX.Element {
  if (group.blockedReason) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
        <p className="text-sm font-medium text-chat-foreground">Multi-model chat is not ready</p>
        <p className="mt-1 text-xs text-muted-foreground">{group.blockedReason}</p>
      </div>
    )
  }
  if (group.loadingAgents) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking installed models…
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <div className="flex items-center gap-1.5">
        {group.participants.map((participant) => (
          <MultiModelAvatar key={participant.id} agent={participant.agent} size={34} />
        ))}
      </div>
      <p className="text-sm font-medium text-chat-foreground">
        Ask once, get answers from {group.participants.length} models
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        Send a message to start the discussion. Use @name to target one member for the next round;
        every reply stays in this chat and is read-only unless you approve implementation.
      </p>
      {group.catalogError ? <p className="text-xs text-destructive">{group.catalogError}</p> : null}
    </div>
  )
}
