import { CornerDownRight, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { COUNCIL_MODES, type CouncilMode } from '../../../../../shared/council/council-contract'
import { MODE_LABELS } from '../../council/council-session-execution'
import { MAX_GROUP_ROUNDS, MIN_GROUP_ROUNDS } from './multi-model-chat-state'
import { useMultiModelChatContext } from './MultiModelChatContext'

/**
 * Compact multi-model discussion controls and active reply target pinned to the normal composer.
 * Renders nothing in Single Model mode so single-model UX stays untouched.
 */
export function NativeChatComposerMultiModelBar({
  onFocusComposer
}: {
  onFocusComposer?: () => void
}): React.JSX.Element | null {
  const group = useMultiModelChatContext()
  if (!group || group.mode !== 'multi') {
    return null
  }

  return (
    <div className="mb-1 flex flex-col gap-1 border-b border-border/50 px-1.5 pb-1.5">
      {group.replyTo ? (
        <div className="flex items-center gap-1.5 rounded-md bg-foreground/[0.04] px-2 py-1 text-xs text-chat-foreground">
          <CornerDownRight className="size-3 shrink-0 text-chat-foreground-faint" />
          <span className="shrink-0 font-medium">Replying to {group.replyTo.participantLabel}</span>
          {group.replyTo.preview ? (
            <span className="min-w-0 flex-1 truncate text-chat-foreground-faint">
              {group.replyTo.preview}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel reply"
            onClick={() => {
              group.clearReplyTarget?.()
              onFocusComposer?.()
            }}
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-chat-foreground-faint">
        <label className="flex items-center gap-1.5">
          <span>Discussion</span>
          <Select
            value={group.discussionMode}
            onValueChange={(value) => group.setDiscussionMode(value as CouncilMode)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Discussion mode"
              className="h-6 border-border/60 bg-transparent px-2 text-xs text-chat-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNCIL_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        {group.discussionMode === 'parallel' ? null : (
          <div className="flex items-center gap-1">
            <span>Rounds</span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Composer fewer rounds"
              disabled={group.maxRounds <= MIN_GROUP_ROUNDS}
              onClick={() => group.setMaxRounds(group.maxRounds - 1)}
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-4 text-center text-xs font-medium text-chat-foreground tabular-nums">
              {group.maxRounds}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Composer more rounds"
              disabled={group.maxRounds >= MAX_GROUP_ROUNDS}
              onClick={() => group.setMaxRounds(group.maxRounds + 1)}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        )}

        <span className="ml-auto text-2xs">Use @ to direct a participant</span>
      </div>
    </div>
  )
}
