import { AlertTriangle, Copy, CornerDownRight, Loader2, RefreshCw, Reply } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import {
  MarkdownDirectionToggle,
  useMarkdownDirectionOverride
} from '@/components/sidebar/MarkdownDirectionToggle'
import type { CouncilMessage, CouncilMode } from '../../../../../shared/council/council-contract'
import type { NativeChatMessage } from '../../../../../shared/native-chat/native-chat-types'
import { nativeChatMessageCopyText } from '../../../../../shared/native-chat/transcript/native-chat-message-copy-text'
import { NativeChatCodeBlock } from '../markdown/code/NativeChatCodeBlock'
import { NativeChatMarkdown } from '../markdown/NativeChatMarkdown'
import { uiDateTimeFormat } from '@/i18n/ui-intl-formatters'
import { MultiModelAvatar } from './MultiModelAvatar'

const TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit'
}

function formatTime(timestamp: number): string {
  return uiDateTimeFormat(TIME_FORMAT_OPTIONS).format(new Date(timestamp))
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success('Copied')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not copy')
  }
}

function StatusNote({ message }: { message: CouncilMessage }): React.JSX.Element | null {
  if (message.status === 'processing' || message.status === 'completed') {
    return null
  }
  const label =
    message.status === 'failed' ? 'Failed' : message.status === 'cancelled' ? 'Stopped' : 'Pending'
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-2xs',
        message.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
      )}
    >
      {message.status === 'failed' ? <AlertTriangle className="size-3" /> : null}
      {label}
    </span>
  )
}

function ReplyQuote({
  label,
  excerpt,
  onClick,
  alignEnd = false
}: {
  label: string
  excerpt?: string
  onClick?: () => void
  alignEnd?: boolean
}): React.JSX.Element {
  const content = (
    <>
      <CornerDownRight className="size-3 shrink-0" />
      <span className="shrink-0 font-medium">Replying to {label}</span>
      {excerpt ? (
        <span dir="auto" className="min-w-0 truncate opacity-75">
          <bdi>{`“${excerpt}”`}</bdi>
        </span>
      ) : null}
    </>
  )
  const sharedClass = cn(
    'mt-1 flex max-w-full items-center gap-1.5 text-2xs text-muted-foreground',
    alignEnd ? 'justify-end' : 'border-s-2 border-primary/35 ps-2'
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(sharedClass, 'text-start transition-colors hover:text-chat-foreground')}
      >
        {content}
      </button>
    )
  }
  return <p className={sharedClass}>{content}</p>
}

/** One group turn inside the normal chat timeline. */
export function MultiModelChatMessageRow({
  message,
  mode,
  replyExcerpt,
  onJumpToReply,
  canRetry,
  onRetry,
  onReply
}: {
  message: CouncilMessage
  mode?: CouncilMode
  replyExcerpt?: string
  onJumpToReply?: () => void
  canRetry: boolean
  onRetry: () => void
  onReply?: () => void
}): React.JSX.Element {
  const [directionOverride, setDirectionOverride] = useMarkdownDirectionOverride(
    `multi-model-msg:${message.id}`
  )
  const isUser = message.kind === 'user'
  const isDecision = message.kind === 'decision'
  const processing = message.status === 'processing'
  const showRole = (isDecision || mode === 'code-review') && Boolean(message.role)

  if (isUser) {
    return (
      <article id={`council-msg-${message.id}`} className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-border bg-muted px-3.5 py-2 text-chat-foreground">
          <div className="mb-0.5 flex items-center justify-end gap-2 text-2xs text-muted-foreground">
            <span>You</span>
            <time dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt)}
            </time>
            {message.content ? (
              <MarkdownDirectionToggle
                compact
                value={directionOverride}
                onChange={setDirectionOverride}
              />
            ) : null}
          </div>
          {message.replyToLabel ? (
            <ReplyQuote
              label={message.replyToLabel}
              excerpt={replyExcerpt}
              onClick={onJumpToReply}
              alignEnd
            />
          ) : null}
          <NativeChatMarkdown
            rowKey={message.id}
            content={message.content}
            variant="document"
            math
            unknownHtmlAsText
            linkifyFilePaths
            renderCodeBlock={NativeChatCodeBlock}
            directionOverride={directionOverride}
            className="text-sm leading-6"
          />
        </div>
      </article>
    )
  }

  const activeStatusLabel = message.content
    ? 'Writing…'
    : message.replyToLabel
      ? 'Replying…'
      : 'Thinking…'

  return (
    <article
      id={`council-msg-${message.id}`}
      className={cn('flex gap-3', isDecision && 'rounded-lg bg-muted/40 p-2')}
    >
      <MultiModelAvatar
        agent={message.provider}
        size={32}
        className={cn(processing && 'ring-2 ring-primary/35')}
      />
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold text-chat-foreground">
            {message.participantLabel}
          </span>
          {message.model ? (
            <span className="text-2xs text-muted-foreground">{message.model}</span>
          ) : null}
          {showRole ? <span className="text-2xs text-muted-foreground">{message.role}</span> : null}
          <Badge
            variant="secondary"
            className="h-4 border-0 px-1.5 text-2xs font-normal text-muted-foreground"
          >
            Round {message.round}
          </Badge>
          <time
            className="text-2xs text-muted-foreground"
            dateTime={new Date(message.createdAt).toISOString()}
          >
            {formatTime(message.createdAt)}
          </time>
          {processing ? (
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {activeStatusLabel}
            </span>
          ) : (
            <StatusNote message={message} />
          )}
          <span className="ml-auto flex items-center gap-0.5">
            {message.content ? (
              <MarkdownDirectionToggle
                compact
                value={directionOverride}
                onChange={setDirectionOverride}
              />
            ) : null}
            {onReply && message.status === 'completed' ? (
              <Button
                variant="ghost"
                size="icon-xs"
                title={`Reply to ${message.participantLabel}`}
                aria-label={`Reply to ${message.participantLabel}`}
                onClick={onReply}
              >
                <Reply className="size-3" />
              </Button>
            ) : null}
            {message.content ? (
              <Button
                variant="ghost"
                size="icon-xs"
                title="Copy this response"
                aria-label="Copy response"
                onClick={() => void copyText(message.content)}
              >
                <Copy className="size-3" />
              </Button>
            ) : null}
            {canRetry && (message.status === 'failed' || message.status === 'cancelled') ? (
              <Button
                variant="ghost"
                size="icon-xs"
                title="Retry this turn"
                aria-label="Retry this turn"
                onClick={onRetry}
              >
                <RefreshCw className="size-3" />
              </Button>
            ) : null}
          </span>
        </header>
        {message.replyToLabel ? (
          <ReplyQuote label={message.replyToLabel} excerpt={replyExcerpt} onClick={onJumpToReply} />
        ) : null}
        <div className="mt-1 text-sm leading-6 text-chat-foreground">
          {message.content ? (
            <NativeChatMarkdown
              rowKey={message.id}
              content={message.content}
              variant="document"
              math
              unknownHtmlAsText
              linkifyFilePaths
              streaming={processing}
              renderCodeBlock={NativeChatCodeBlock}
              directionOverride={directionOverride}
              className="text-sm leading-6"
            />
          ) : null}
          {message.error ? <p className="text-destructive">{message.error}</p> : null}
          {processing && !message.content ? (
            <div className="flex items-center gap-1 py-1.5" aria-hidden="true">
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/** An earlier single-model turn, kept in the same timeline as the group replies. */
export function MultiModelPriorMessageRow({
  message,
  agent,
  chatId
}: {
  message: NativeChatMessage
  agent: string | null
  chatId: string
}): React.JSX.Element | null {
  const [directionOverride, setDirectionOverride] = useMarkdownDirectionOverride(
    `multi-model-prior:${chatId}:${message.id}`
  )
  const text = nativeChatMessageCopyText(message).trim()
  if (!text) {
    return null
  }
  const isUser = message.role === 'user'
  return (
    <article className={cn('flex gap-3', isUser && 'justify-end')}>
      {isUser ? null : <MultiModelAvatar agent={agent} size={32} />}
      <div className={cn('min-w-0', isUser ? 'max-w-[85%]' : 'flex-1')}>
        <header
          className={cn(
            'flex items-center gap-2 text-2xs text-muted-foreground',
            isUser && 'justify-end'
          )}
        >
          <span className="font-semibold">{isUser ? 'You' : 'This model'}</span>
          <span>Single-model turn</span>
          <MarkdownDirectionToggle
            compact
            value={directionOverride}
            onChange={setDirectionOverride}
          />
        </header>
        <div
          className={cn(
            'mt-1 rounded-md text-sm leading-6',
            isUser
              ? 'rounded-2xl rounded-br-sm border border-border bg-muted px-3.5 py-2'
              : 'text-chat-foreground'
          )}
        >
          <NativeChatMarkdown
            rowKey={`prior:${message.id}`}
            content={text}
            variant="document"
            math
            unknownHtmlAsText
            linkifyFilePaths
            renderCodeBlock={NativeChatCodeBlock}
            directionOverride={directionOverride}
            className="text-sm leading-6"
          />
        </div>
      </div>
    </article>
  )
}
