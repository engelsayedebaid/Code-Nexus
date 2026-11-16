import type React from 'react'
import { useMemo, useState } from 'react'
import { ArrowDownAZ, Check, ChevronDown, History, Layers, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { AgentIcon } from '@/components/agent/icons/AgentIcon'
import { AgentLetterIcon } from '@/components/agent/icons/agent-icon-glyphs'
import { agentTypeToIconAgent } from '../../../../../shared/agent-status/presentation/agent-type-icon-agent'
import type { AgentType } from '../../../../../shared/agent-status/contracts/agent-status-types'
import { useAppStore } from '@/store/index'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeProviderAgentOption,
  IdeProviderModelOption
} from '../../../../../shared/ide-agent/ide-agent-events'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  readModelPickerProviderFilter,
  readModelPickerRecents,
  readModelPickerSort,
  recordModelPickerRecent,
  writeModelPickerProviderFilter,
  writeModelPickerSort,
  type IdeModelPickerSort
} from './ide-model-picker-preferences'

const ALL_PROVIDERS = 'all'

type ModelEntry = {
  provider: IdeProviderAgentOption
  model: IdeProviderModelOption
  value: string
}

function providerModels(provider: IdeProviderAgentOption): IdeProviderModelOption[] {
  return provider.models.length > 0
    ? provider.models
    : [{ id: provider.defaultModelId, label: provider.defaultModelId }]
}

function providerIcon(provider: IdeProviderAgentOption, size = 14): React.JSX.Element {
  const iconAgent = agentTypeToIconAgent(provider.id as AgentType)
  if (iconAgent) {
    return <AgentIcon agent={iconAgent} size={size} />
  }
  return <AgentLetterIcon letter={provider.label.charAt(0).toUpperCase()} size={size} />
}

function openAgentSettings(): void {
  const state = useAppStore.getState()
  state.openSettingsTarget({ pane: 'agents', repoId: null })
  state.openSettingsPage()
}

const SORT_OPTIONS: { id: IdeModelPickerSort; label: string; icon: typeof Layers }[] = [
  { id: 'provider', label: 'Provider', icon: Layers },
  { id: 'name', label: 'Name', icon: ArrowDownAZ },
  { id: 'recent', label: 'Recently used', icon: History }
]

/** Searchable provider-first model picker for the composer toolbar. */
export function IdeModelPicker({
  conversation,
  providers,
  providersLoading
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
  providersLoading: boolean
}) {
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [providerFilter, setProviderFilter] = useState(readModelPickerProviderFilter)
  const [sort, setSort] = useState<IdeModelPickerSort>(readModelPickerSort)
  const [recents, setRecents] = useState<readonly string[]>(readModelPickerRecents)

  const activeAgentId = conversation?.agentId ?? providers[0]?.id ?? 'codex'
  const activeProvider = providers.find((p) => p.id === activeAgentId)
  const activeModelId = conversation?.modelId ?? activeProvider?.defaultModelId ?? ''
  const activeModel = activeProvider
    ? providerModels(activeProvider).find((m) => m.id === activeModelId)
    : undefined

  const triggerLabel = providersLoading
    ? 'Loading models...'
    : (activeModel?.label ?? activeModelId ?? 'Select model')
  const triggerTitle = activeProvider ? `${activeProvider.label} · ${triggerLabel}` : triggerLabel

  const filteredProviders = useMemo(() => {
    if (providerFilter === ALL_PROVIDERS) {
      return providers
    }
    const match = providers.find((p) => p.id === providerFilter)
    return match ? [match] : providers
  }, [providers, providerFilter])

  const selectModel = (provider: IdeProviderAgentOption, model: IdeProviderModelOption): void => {
    if (!conversation) {
      return
    }
    const value = `${provider.id}::${model.id}`
    recordModelPickerRecent(value)
    setRecents(readModelPickerRecents())
    setOpen(false)
    void updateSettings({
      conversationId: conversation.id,
      agentId: provider.id,
      modelId: model.id
    })
  }

  const renderItem = (provider: IdeProviderAgentOption, model: IdeProviderModelOption) => {
    const value = `${provider.id}::${model.id}`
    const selected = provider.id === activeAgentId && model.id === activeModelId
    return (
      <CommandItem
        key={value}
        value={value}
        aria-label={`${provider.label} ${model.label}`}
        keywords={[provider.label, model.label, model.id, provider.id]}
        disabled={!provider.available}
        onSelect={() => selectModel(provider, model)}
        title={provider.available ? undefined : provider.unavailableReason}
        className="gap-2 px-2 py-1.5"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {providerIcon(provider, 13)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-4 text-foreground">
            {model.label}
          </span>
          <span className="block truncate text-[10px] leading-3.5 text-muted-foreground">
            {provider.label}
            {model.isDefault ? ' · Default' : ''}
          </span>
        </span>
        {selected ? <Check className="size-3.5 shrink-0 text-foreground" /> : null}
      </CommandItem>
    )
  }

  const renderGroups = () => {
    if (sort === 'provider') {
      return filteredProviders.map((provider) => (
        <CommandGroup
          key={provider.id}
          heading={provider.label}
          className="[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:gap-1.5"
        >
          {providerModels(provider).map((model) => renderItem(provider, model))}
        </CommandGroup>
      ))
    }
    const entries: ModelEntry[] = filteredProviders.flatMap((provider) =>
      providerModels(provider).map((model) => ({
        provider,
        model,
        value: `${provider.id}::${model.id}`
      }))
    )
    const byName = (a: ModelEntry, b: ModelEntry): number =>
      a.model.label.localeCompare(b.model.label) || a.provider.label.localeCompare(b.provider.label)
    const ordered =
      sort === 'recent'
        ? [
            ...recents
              .map((value) => entries.find((e) => e.value === value))
              .filter((e): e is ModelEntry => Boolean(e)),
            ...entries.filter((e) => !recents.includes(e.value)).sort(byName)
          ]
        : [...entries].sort(byName)
    return (
      <CommandGroup>{ordered.map((entry) => renderItem(entry.provider, entry.model))}</CommandGroup>
    )
  }

  const activeFilterProvider =
    providerFilter === ALL_PROVIDERS
      ? null
      : (providers.find((p) => p.id === providerFilter) ?? null)
  const totalModels = filteredProviders.reduce((n, p) => n + providerModels(p).length, 0)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setProviderFilter(readModelPickerProviderFilter())
          setSort(readModelPickerSort())
          setRecents(readModelPickerRecents())
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!conversation}
          data-testid="ide-model-select"
          title={triggerTitle}
          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-[11px] text-foreground shadow-none transition-colors hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50"
        >
          {activeProvider ? (
            <span className="flex size-3.5 shrink-0 items-center justify-center">
              {providerIcon(activeProvider, 12)}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[min(340px,calc(100vw-24px))] p-0"
      >
        {providers.length === 0 && !providersLoading ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
            No AI CLI agents detected
          </div>
        ) : (
          <Command label="Search all models" className="rounded-md">
            <CommandInput placeholder="Search all models" className="h-9 text-[12px]" />
            <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-[11px] text-foreground transition-colors hover:bg-accent/60"
                  >
                    {activeFilterProvider ? (
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {providerIcon(activeFilterProvider, 12)}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-left">
                      {activeFilterProvider?.label ?? 'All providers'}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {totalModels}
                    </span>
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuRadioGroup
                    value={providerFilter}
                    onValueChange={(value) => {
                      setProviderFilter(value)
                      writeModelPickerProviderFilter(value)
                    }}
                  >
                    <DropdownMenuRadioItem value={ALL_PROVIDERS}>
                      All providers
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {providers.map((provider) => (
                      <DropdownMenuRadioItem
                        key={provider.id}
                        value={provider.id}
                        title={provider.unavailableReason}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="flex size-4 shrink-0 items-center justify-center">
                            {providerIcon(provider, 13)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{provider.label}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {providerModels(provider).length}
                          </span>
                          {!provider.available ? (
                            <span className="shrink-0 text-[10px] text-destructive">
                              Unavailable
                            </span>
                          ) : null}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openAgentSettings}>
                    <Settings2 className="size-3.5" />
                    Agent settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Sort models"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  >
                    {(() => {
                      const active = SORT_OPTIONS.find((o) => o.id === sort) ?? SORT_OPTIONS[0]
                      return <active.icon className="size-3.5" />
                    })()}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) => {
                      const next = value as IdeModelPickerSort
                      setSort(next)
                      writeModelPickerSort(next)
                    }}
                  >
                    {SORT_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.id} value={option.id}>
                        <span className="flex items-center gap-2">
                          <option.icon className="size-3.5 text-muted-foreground" />
                          {option.label}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <CommandList className="max-h-64 min-h-24 scrollbar-sleek scroll-pb-2">
              <CommandEmpty>
                <span className="text-[11px]">No models found</span>
              </CommandEmpty>
              {renderGroups()}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
