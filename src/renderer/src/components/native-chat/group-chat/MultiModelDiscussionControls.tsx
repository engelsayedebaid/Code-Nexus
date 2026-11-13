import { Minus, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/class-names'
import { COUNCIL_MODES } from '../../../../../shared/council/council-contract'
import { MODE_DESCRIPTIONS, MODE_LABELS } from '../../council/council-session-execution'
import {
  MAX_GROUP_ROUNDS,
  MIN_GROUP_PARTICIPANTS,
  MIN_GROUP_ROUNDS,
  composerParticipantsLabel
} from './multi-model-chat-state'
import type { MultiModelChatController } from './use-multi-model-chat'

export function MultiModelDiscussionControls({
  group,
  onClose
}: {
  group: MultiModelChatController
  onClose?: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="px-1">
        <p className="mb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
          Discussion
        </p>
        <div className="flex flex-wrap gap-1">
          {COUNCIL_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="xs"
              variant={group.discussionMode === mode ? 'secondary' : 'outline'}
              title={MODE_DESCRIPTIONS[mode]}
              onClick={() => group.setDiscussionMode(mode)}
            >
              {MODE_LABELS[mode]}
            </Button>
          ))}
        </div>
      </div>

      {group.discussionMode === 'parallel' ? null : (
        <div className="flex items-center justify-between px-1">
          <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
            Rounds
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label="Fewer rounds"
              disabled={group.maxRounds <= MIN_GROUP_ROUNDS}
              onClick={() => group.setMaxRounds(group.maxRounds - 1)}
            >
              <Minus className="size-3" />
            </Button>
            <span className="w-6 text-center text-xs tabular-nums">{group.maxRounds}</span>
            <Button
              type="button"
              size="icon-xs"
              variant="outline"
              aria-label="More rounds"
              disabled={group.maxRounds >= MAX_GROUP_ROUNDS}
              onClick={() => group.setMaxRounds(group.maxRounds + 1)}
            >
              <Plus className="size-3" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-1">
        <Badge variant="outline" className="min-w-0 flex-1 justify-start truncate">
          {composerParticipantsLabel(group.participants)}
        </Badge>
        {group.participants.length < MIN_GROUP_PARTICIPANTS ? (
          <span className="shrink-0 text-2xs text-destructive">
            Pick at least {MIN_GROUP_PARTICIPANTS}
          </span>
        ) : null}
      </div>

      <Button type="button" size="sm" className="mx-1" onClick={onClose}>
        Done
      </Button>
    </>
  )
}

export function ThinkingLevelPicker({
  group,
  participantId,
  agentId
}: {
  group: MultiModelChatController
  participantId: string
  agentId: string
}): React.JSX.Element | null {
  const participant = group.participants.find((candidate) => candidate.id === participantId)
  const agent = group.agents.find((candidate) => candidate.id === agentId)
  const model = agent?.models.find((candidate) => candidate.id === participant?.model)
  if (!participant || !model?.thinkingLevels?.length) {
    return null
  }
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="shrink-0 text-2xs text-muted-foreground">Reasoning</span>
      <Select
        value={
          participant.thinkingLevel ?? model.defaultThinkingLevel ?? model.thinkingLevels[0]?.id
        }
        onValueChange={(level) =>
          group.setThinkingLevel(participantId, level === 'default' ? undefined : level)
        }
      >
        <SelectTrigger size="sm" className="h-6 flex-1 text-2xs" aria-label="Reasoning effort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          {model.thinkingLevels.map((level) => (
            <SelectItem key={level.id} value={level.id}>
              {level.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ModeButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-2 py-1 text-xs transition-colors',
        active
          ? 'bg-foreground/10 font-medium text-chat-foreground-strong'
          : 'text-muted-foreground hover:bg-foreground/5'
      )}
    >
      {label}
    </button>
  )
}
