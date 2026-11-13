import { ChevronRight, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/class-names'
import {
  COUNCIL_MODES,
  COUNCIL_ROLES,
  type CouncilAgentCatalog,
  type CouncilMode,
  type CouncilParticipant
} from '../../../../shared/council/council-contract'
import { MODE_DESCRIPTIONS, MODE_LABELS } from './council-session-execution'

export function CouncilSetupPanel(props: {
  agents: CouncilAgentCatalog[]
  catalogError: string | null
  loadingAgents: boolean
  maxRounds: number
  mode: CouncilMode
  participants: CouncilParticipant[]
  prompt: string
  activeAgentModels: Map<string, CouncilAgentCatalog['models']>
  onLoadAgents: () => Promise<void>
  onModeChange: (mode: CouncilMode) => void
  onRoundsChange: (rounds: number) => void
  onPromptChange: (prompt: string) => void
  onSelectAgent: (participant: CouncilParticipant, agent: string) => void
  onRefreshModels: (participant: CouncilParticipant) => void
  onUpdateParticipant: (id: string, patch: Partial<CouncilParticipant>) => void
  onAddParticipant: () => void
  onRemoveParticipant: (id: string) => void
  onStart: () => void
}): React.JSX.Element {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <section>
          <h1 className="text-xl font-semibold tracking-tight">Convene an AI Council</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Compare independent model judgments, then let them challenge and refine one another
            before a decision is produced.
          </p>
        </section>

        <section className="space-y-2">
          <label className="text-xs font-semibold">Council brief</label>
          <Textarea
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            placeholder="Describe the decision, design, review, or implementation problem…"
            className="min-h-28"
          />
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {COUNCIL_MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={cn(
                'rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-accent/50',
                props.mode === candidate && 'border-foreground/35 bg-accent'
              )}
              onClick={() => props.onModeChange(candidate)}
            >
              <span className="block text-xs font-semibold">{MODE_LABELS[candidate]}</span>
              <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                {MODE_DESCRIPTIONS[candidate]}
              </span>
            </button>
          ))}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Council members</h2>
              <p className="text-xs text-muted-foreground">
                Choose 2–8 installed providers, models, and responsibilities.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Select
                value={String(props.maxRounds)}
                onValueChange={(value) => props.onRoundsChange(Number(value))}
              >
                <SelectTrigger size="sm" density="compact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((rounds) => (
                    <SelectItem key={rounds} value={String(rounds)}>
                      {rounds} round{rounds === 1 ? '' : 's'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={props.participants.length >= 8 || props.agents.length === 0}
                onClick={props.onAddParticipant}
              >
                <Plus className="size-3.5" /> Add member
              </Button>
            </div>
          </div>
          {props.catalogError ? (
            <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <span>{props.catalogError}</span>
              <Button variant="ghost" size="xs" onClick={() => void props.onLoadAgents()}>
                Retry
              </Button>
            </div>
          ) : null}
          {props.loadingAgents ? (
            <div className="flex items-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Discovering available Council
              providers…
            </div>
          ) : null}
          <div className="space-y-2">
            {props.participants.map((participant) => {
              const agentInfo = props.agents.find((candidate) => candidate.id === participant.agent)
              const models = props.activeAgentModels.get(participant.agent) ?? []
              const model = models.find((candidate) => candidate.id === participant.model)
              const unavailable = agentInfo?.available === false
              return (
                <div
                  key={participant.id}
                  className="space-y-1 rounded-lg border border-border bg-card p-2"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(120px,1.1fr)_minmax(140px,1.3fr)_minmax(130px,1.1fr)_auto] items-center gap-2">
                    <Select
                      value={participant.agent}
                      onValueChange={(value) => props.onSelectAgent(participant, value)}
                    >
                      <SelectTrigger className="w-full" size="sm" density="compact">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {props.agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.label}
                            {agent.available === false ? ' (Unavailable)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex min-w-0 gap-1">
                      <Select
                        value={participant.model}
                        onValueChange={(value) => {
                          const next = models.find((candidate) => candidate.id === value)
                          props.onUpdateParticipant(participant.id, {
                            model: value,
                            modelLabel: next?.label ?? value,
                            thinkingLevel: next?.defaultThinkingLevel
                          })
                        }}
                      >
                        <SelectTrigger className="min-w-0 flex-1" size="sm" density="compact">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Refresh models from provider"
                        onClick={() => props.onRefreshModels(participant)}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </div>
                    <Select
                      value={participant.role}
                      onValueChange={(value) =>
                        props.onUpdateParticipant(participant.id, { role: value })
                      }
                    >
                      <SelectTrigger className="w-full" size="sm" density="compact">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNCIL_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      {model?.thinkingLevels?.length ? (
                        <Select
                          value={participant.thinkingLevel ?? model.defaultThinkingLevel}
                          onValueChange={(value) =>
                            props.onUpdateParticipant(participant.id, { thinkingLevel: value })
                          }
                        >
                          <SelectTrigger size="sm" density="compact">
                            <SelectValue placeholder="Thinking" />
                          </SelectTrigger>
                          <SelectContent>
                            {model.thinkingLevels.map((level) => (
                              <SelectItem key={level.id} value={level.id}>
                                {level.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Button
                        variant={participant.moderator ? 'secondary' : 'ghost'}
                        size="icon-xs"
                        title="Use as moderator"
                        onClick={() =>
                          props.participants.forEach((candidate) =>
                            props.onUpdateParticipant(candidate.id, {
                              moderator: candidate.id === participant.id
                            })
                          )
                        }
                      >
                        <Sparkles className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Remove member"
                        disabled={props.participants.length <= 2}
                        onClick={() => props.onRemoveParticipant(participant.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {unavailable ? (
                    <p className="px-1 text-[11px] text-amber-500">
                      {agentInfo?.availabilityNote ||
                        `${participant.label} is not currently available on this host.`}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border pt-4 pb-2">
          <p className="text-xs text-muted-foreground">
            Council turns are read-only. Implementation requires a separate confirmation.
          </p>
          <Button
            className="shrink-0"
            disabled={!props.prompt.trim() || props.participants.length < 2}
            onClick={props.onStart}
          >
            Start Council <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </ScrollArea>
  )
}
