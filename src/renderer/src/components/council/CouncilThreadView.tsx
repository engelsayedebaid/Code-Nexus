import { CircleStop, Loader2, Pause, Play, Send, Sparkles, Users } from 'lucide-react'
import CommentMarkdown, {
  type MarkdownDirectionOverride
} from '@/components/sidebar/CommentMarkdown'
import { MarkdownDirectionToggle } from '@/components/sidebar/MarkdownDirectionToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CouncilMessage, CouncilSession } from '../../../../shared/council/council-contract'
import { CouncilMessageCard } from './CouncilMessageCard'

export function CouncilThreadView(props: {
  session: CouncilSession
  isRunning: boolean
  isPaused: boolean
  briefDirection: MarkdownDirectionOverride
  intervention: string
  onBriefDirectionChange: (direction: MarkdownDirectionOverride) => void
  onInterventionChange: (value: string) => void
  onSendIntervention: () => void
  onTogglePause: () => void
  onResume: () => void
  onStop: () => void
  onRetryMessage: (message: CouncilMessage) => void
  onConfirmImplementation: () => void
}): React.JSX.Element {
  const { session, isRunning, isPaused } = props
  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="size-3.5" /> {session.participants.length} members
          <span>·</span>
          <span>
            Round {session.currentRound}/{session.maxRounds}
          </span>
          <span>·</span>
          <span className="capitalize">{session.status}</span>
        </div>
        <div className="flex items-center gap-1">
          {isRunning && (session.status === 'running' || session.status === 'paused') ? (
            <Button variant="outline" size="xs" onClick={props.onTogglePause}>
              {isPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
          ) : null}
          {!isRunning && (session.status === 'paused' || session.status === 'stopped') ? (
            <Button variant="outline" size="xs" onClick={props.onResume}>
              <Play className="size-3" /> Resume
            </Button>
          ) : null}
          {isRunning || session.status === 'running' || session.status === 'paused' ? (
            <Button variant="outline" size="xs" onClick={props.onStop}>
              <CircleStop className="size-3" /> Stop
            </Button>
          ) : null}
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-4 px-5 py-5">
          <section className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Council brief
              </p>
              <MarkdownDirectionToggle
                compact
                value={props.briefDirection}
                onChange={props.onBriefDirectionChange}
              />
            </div>
            <CommentMarkdown
              content={session.prompt}
              variant="document"
              math
              unknownHtmlAsText
              directionOverride={props.briefDirection}
              className="text-sm leading-6"
            />
          </section>
          {session.messages.map((message) => (
            <CouncilMessageCard
              key={message.id}
              message={message}
              canRetry={!isRunning && message.kind !== 'user'}
              onRetry={() => props.onRetryMessage(message)}
            />
          ))}
          {session.messages.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Preparing Council
            </div>
          ) : null}
          {session.finalDecision ? (
            <div className="flex justify-end pt-2">
              <Button onClick={props.onConfirmImplementation}>
                <Sparkles className="size-4" /> Implement Approved Solution
              </Button>
            </div>
          ) : null}
        </div>
      </ScrollArea>
      <div className="shrink-0 border-t border-border p-3">
        <div className="mx-auto flex max-w-4xl gap-2">
          <Input
            value={props.intervention}
            onChange={(event) => props.onInterventionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                props.onSendIntervention()
              }
            }}
            placeholder="Intervene in the next round; use @label to target one member"
          />
          <Button
            size="icon"
            disabled={!props.intervention.trim()}
            onClick={props.onSendIntervention}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </>
  )
}
