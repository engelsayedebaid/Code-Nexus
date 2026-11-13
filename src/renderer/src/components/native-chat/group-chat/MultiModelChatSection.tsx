import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Star } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'
import type {
  CouncilAgentCatalog,
  CouncilModelCatalog,
  CouncilParticipant
} from '../../../../../shared/council/council-contract'
import { MAX_GROUP_PARTICIPANTS } from './multi-model-chat-state'
import { MultiModelAvatar } from './MultiModelAvatar'
import {
  ModeButton,
  MultiModelDiscussionControls,
  ThinkingLevelPicker
} from './MultiModelDiscussionControls'
import type { MultiModelChatController } from './use-multi-model-chat'

const COLLAPSED_MODEL_LIMIT = 4

function filterProviderModels(agent: CouncilAgentCatalog, search: string): CouncilModelCatalog[] {
  if (!search) {
    return agent.models
  }
  const agentMatches =
    agent.label.toLowerCase().includes(search) || agent.id.toLowerCase().includes(search)
  if (agentMatches) {
    return agent.models
  }
  return agent.models.filter(
    (model) => model.label.toLowerCase().includes(search) || model.id.toLowerCase().includes(search)
  )
}

function visibleProviderModels(
  models: readonly CouncilModelCatalog[],
  selectedForAgent: readonly CouncilParticipant[],
  expanded: boolean,
  search: string
): CouncilModelCatalog[] {
  if (search || expanded || models.length <= COLLAPSED_MODEL_LIMIT) {
    return [...models]
  }
  const selectedIds = new Set(selectedForAgent.map((participant) => participant.model))
  const chosen = models.filter((model) => selectedIds.has(model.id))
  const rest = models.filter((model) => !selectedIds.has(model.id))
  const remainingSlots = Math.max(0, COLLAPSED_MODEL_LIMIT - chosen.length)
  return [...chosen, ...rest.slice(0, Math.max(2, remainingSlots))]
}

/** Multi-model controls live inside the composer's model dropdown, not a second surface. */
export function MultiModelChatSection({
  group,
  onClose
}: {
  group: MultiModelChatController
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({})
  const search = query.trim().toLowerCase()
  const probingSet = new Set(group.probingAgentIds ?? [])

  const agents = group.agents.filter((agent) => {
    if (!search) {
      return true
    }
    return (
      agent.label.toLowerCase().includes(search) ||
      agent.id.toLowerCase().includes(search) ||
      agent.models.some(
        (model) =>
          model.label.toLowerCase().includes(search) || model.id.toLowerCase().includes(search)
      )
    )
  })

  const toggleExpand = (agentId: string): void => {
    setExpandedAgents((current) => ({ ...current, [agentId]: !current[agentId] }))
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-1 pb-2">
      <div
        role="group"
        aria-label="Chat model mode"
        className="flex rounded-md border border-border p-0.5"
      >
        <ModeButton
          active={group.mode === 'single'}
          label="Single Model"
          onClick={() => group.setMode('single')}
        />
        <ModeButton
          active={group.mode === 'multi'}
          label="Multi-Model"
          onClick={() => group.setMode('multi')}
        />
      </div>

      {group.mode === 'single' ? (
        <p className="px-1 text-xs text-muted-foreground">
          One model answers every message. Switch to Multi-Model to discuss with several installed
          providers.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models…"
                aria-label="Search multi-model providers"
                className="h-7 pl-7 text-xs"
              />
            </div>
            {group.refreshCatalog ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Refresh installed providers and models"
                aria-label="Refresh providers"
                disabled={group.loadingAgents}
                onClick={() => void group.refreshCatalog?.()}
              >
                <RefreshCw className={cn('size-3', group.loadingAgents && 'animate-spin')} />
              </Button>
            ) : null}
            <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
              {group.participants.length}/{MAX_GROUP_PARTICIPANTS}
            </span>
          </div>

          <div className="scrollbar-sleek max-h-64 overflow-y-auto px-1">
            {group.loadingAgents ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Checking installed providers…
              </div>
            ) : agents.length === 0 ? (
              <p className="px-1 py-3 text-xs text-muted-foreground">
                {group.catalogError ?? 'No provider matched this search.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {agents.map((agent) => {
                  const selectedForAgent = group.participants.filter(
                    (participant) => participant.agent === agent.id
                  )
                  const unavailable = agent.available === false
                  const probing = probingSet.has(agent.id)
                  const filteredModels = filterProviderModels(agent, search)
                  const expanded = Boolean(expandedAgents[agent.id])
                  const shownModels = visibleProviderModels(
                    filteredModels,
                    selectedForAgent,
                    expanded,
                    search
                  )
                  const hiddenCount = filteredModels.length - shownModels.length

                  return (
                    <li
                      key={agent.id}
                      className="rounded-md border border-border/50 bg-background/40 px-1.5 py-1"
                    >
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={
                            unavailable ||
                            (selectedForAgent.length === 0 &&
                              group.participants.length >= MAX_GROUP_PARTICIPANTS)
                          }
                          onClick={() => group.toggleAgent(agent.id)}
                          aria-pressed={selectedForAgent.length > 0}
                          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-xs disabled:opacity-50"
                        >
                          <MultiModelAvatar agent={agent.id} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-chat-foreground">
                                {agent.label}
                              </span>
                              {selectedForAgent.length > 0 ? (
                                <Badge variant="secondary" className="h-4 px-1 text-2xs">
                                  {selectedForAgent.length}
                                </Badge>
                              ) : null}
                            </span>
                            <span className="block truncate text-2xs text-muted-foreground">
                              {unavailable
                                ? (agent.availabilityNote ??
                                  agent.authNote ??
                                  'Not available on this host')
                                : `${agent.authStatus === 'authenticated' ? 'Signed in · ' : ''}${agent.models.length} models${agent.modelSource === 'dynamic' ? ' · probed' : ''}`}
                            </span>
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={`Probe ${agent.label} models on this host`}
                          aria-label={`Probe ${agent.label} models`}
                          disabled={unavailable || probing}
                          onClick={() => void group.loadModels(agent.id)}
                        >
                          <RefreshCw className={cn('size-3', probing && 'animate-spin')} />
                        </Button>
                      </div>

                      {!unavailable && shownModels.length > 0 ? (
                        <div className="mt-1 flex flex-col gap-0.5 pl-1">
                          {shownModels.map((model) => {
                            const selectedParticipant = selectedForAgent.find(
                              (candidate) => candidate.model === model.id
                            )
                            const checked = Boolean(selectedParticipant)
                            const atCap =
                              !checked &&
                              agent.supportsMultipleModels !== false &&
                              group.participants.length >= MAX_GROUP_PARTICIPANTS

                            return (
                              <div
                                key={`${agent.id}:${model.id}`}
                                className="flex flex-col gap-0.5"
                              >
                                <div className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-foreground/5">
                                  <Checkbox
                                    checked={checked}
                                    disabled={atCap}
                                    aria-label={`${agent.label} ${model.label}`}
                                    onCheckedChange={() => {
                                      if (group.toggleAgentModel) {
                                        group.toggleAgentModel(agent.id, model.id)
                                        return
                                      }
                                      if (
                                        selectedForAgent[0] &&
                                        selectedForAgent[0].model !== model.id
                                      ) {
                                        group.chooseModel(
                                          selectedForAgent[0].id,
                                          agent.id,
                                          model.id
                                        )
                                      } else {
                                        group.toggleAgent(agent.id)
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    disabled={atCap}
                                    onClick={() => {
                                      if (group.toggleAgentModel) {
                                        group.toggleAgentModel(agent.id, model.id)
                                        return
                                      }
                                      group.toggleAgent(agent.id)
                                    }}
                                    className="min-w-0 flex-1 truncate text-left text-xs text-chat-foreground disabled:opacity-50"
                                  >
                                    {model.label}
                                  </button>
                                  {selectedParticipant ? (
                                    <div className="flex shrink-0 items-center gap-1">
                                      <span className="truncate text-2xs text-muted-foreground">
                                        {selectedParticipant.role}
                                      </span>
                                      <Button
                                        type="button"
                                        variant={
                                          selectedParticipant.moderator ? 'secondary' : 'ghost'
                                        }
                                        size="icon-xs"
                                        title={
                                          selectedParticipant.moderator
                                            ? 'This member writes the final decision'
                                            : 'Make this member the moderator'
                                        }
                                        aria-label={`Set ${model.label} as moderator`}
                                        onClick={() => group.setModerator(selectedParticipant.id)}
                                      >
                                        <Star
                                          className={cn(
                                            'size-3',
                                            selectedParticipant.moderator && 'fill-current'
                                          )}
                                        />
                                      </Button>
                                    </div>
                                  ) : null}
                                </div>
                                {selectedParticipant ? (
                                  <div className="pl-6">
                                    <ThinkingLevelPicker
                                      group={group}
                                      participantId={selectedParticipant.id}
                                      agentId={agent.id}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}

                          {!search && filteredModels.length > COLLAPSED_MODEL_LIMIT ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(agent.id)}
                              className="flex items-center gap-1 self-start px-1 py-0.5 text-2xs text-muted-foreground hover:text-chat-foreground"
                            >
                              {expanded ? (
                                <>
                                  <ChevronDown className="size-3" /> Show fewer models
                                </>
                              ) : (
                                <>
                                  <ChevronRight className="size-3" /> Show all{' '}
                                  {filteredModels.length} models ({hiddenCount} more)
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <MultiModelDiscussionControls group={group} onClose={onClose} />
        </>
      )}

      {group.mode === 'single' ? (
        <Button type="button" size="sm" className="mx-1" onClick={onClose}>
          Done
        </Button>
      ) : null}
    </div>
  )
}
