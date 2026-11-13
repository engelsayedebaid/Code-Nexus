import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import {
  MarkdownDirectionToggle,
  useMarkdownDirectionOverride
} from '@/components/sidebar/MarkdownDirectionToggle'
import type { CouncilMessage } from '../../../../shared/council/council-contract'

function statusTone(status: CouncilMessage['status']): string {
  if (status === 'failed') {
    return 'text-destructive'
  }
  if (status === 'completed') {
    return 'text-foreground'
  }
  if (status === 'processing') {
    return 'text-foreground'
  }
  return 'text-muted-foreground'
}

export function CouncilMessageCard({
  message,
  canRetry,
  onRetry
}: {
  message: CouncilMessage
  canRetry: boolean
  onRetry: () => void
}): React.JSX.Element {
  const isDecision = message.kind === 'decision'
  const [directionOverride, setDirectionOverride] = useMarkdownDirectionOverride(
    `council-msg:${message.id}`
  )
  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-card',
        isDecision && 'border-foreground/30'
      )}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold">{message.participantLabel}</span>
          <Badge variant="outline" className="max-w-48 truncate">
            {message.role}
          </Badge>
          {message.model ? (
            <span className="truncate text-[10px] text-muted-foreground">{message.model}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {message.content ? (
            <MarkdownDirectionToggle
              compact
              value={directionOverride}
              onChange={setDirectionOverride}
            />
          ) : null}
          {canRetry && (message.status === 'failed' || message.status === 'cancelled') ? (
            <Button variant="ghost" size="icon-xs" title="Retry this turn" onClick={onRetry}>
              <RefreshCw className="size-3" />
            </Button>
          ) : null}
          <div className={cn('flex items-center gap-1 text-[10px]', statusTone(message.status))}>
            {message.status === 'processing' ? <Loader2 className="size-3 animate-spin" /> : null}
            {message.status === 'completed' ? <Check className="size-3" /> : null}
            {message.status === 'failed' ? <AlertTriangle className="size-3" /> : null}
            {message.status}
          </div>
        </div>
      </div>
      <div className="px-4 py-3 text-sm leading-6">
        {message.content ? (
          <CommentMarkdown
            content={message.content}
            variant="document"
            math
            unknownHtmlAsText
            directionOverride={directionOverride}
            className="text-sm leading-6"
          />
        ) : null}
        {message.error ? <p className="text-destructive">{message.error}</p> : null}
        {message.status === 'processing' ? (
          <p className="text-muted-foreground">
            Waiting for the provider to complete this response…
          </p>
        ) : null}
      </div>
    </article>
  )
}
