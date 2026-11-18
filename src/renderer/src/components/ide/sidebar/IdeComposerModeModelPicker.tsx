import {
  ChevronDown,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'
import { getIdeModeDescription, getIdeModeLabel } from './ide-chat-copy'
import { IdeModelPicker } from './IdeModelPicker'

export const IDE_EXECUTION_MODE_ORDER: readonly IdeExecutionMode[] = [
  'agent',
  'plan',
  'ask',
  'review'
]

function isIdeExecutionMode(value: string): value is IdeExecutionMode {
  return value === 'agent' || value === 'plan' || value === 'ask' || value === 'review'
}

const MODE_ICONS: Readonly<Record<IdeExecutionMode, LucideIcon>> = {
  agent: Sparkles,
  plan: ListTodo,
  ask: MessageSquare,
  review: GitPullRequest
}

/** Cursor-style Mode + Model pills rendered inside the composer toolbar. */
export function IdeComposerModeModelPicker({
  conversation,
  providers,
  providersLoading,
  worktreeSelector
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
  providersLoading: boolean
  worktreeSelector?: string | null
}) {
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)

  const activeMode: IdeExecutionMode = conversation?.mode ?? 'agent'
  const ActiveIcon = MODE_ICONS[activeMode]
  const activeLabel = getIdeModeLabel(activeMode)

  return (
    <div dir="ltr" className="flex min-w-0 items-center gap-1">
      <DropdownMenu dir="ltr">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={!conversation}
            data-testid="ide-mode-select"
            aria-label={`Mode: ${activeLabel}`}
            title={`${activeLabel} — ${getIdeModeDescription(activeMode)}`}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/80 bg-muted/50 px-2 text-2xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <ActiveIcon className="size-3 shrink-0 text-muted-foreground" />
            <span>{activeLabel}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-64">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Execution Mode</span>
            <kbd
              dir="ltr"
              className="rounded border border-border/70 bg-muted/50 px-1 py-0 font-mono text-3xs font-normal text-muted-foreground"
            >
              Ctrl+.
            </kbd>
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={activeMode}
            onValueChange={(value) => {
              if (conversation && isIdeExecutionMode(value)) {
                void updateSettings({ conversationId: conversation.id, mode: value })
              }
            }}
          >
            {IDE_EXECUTION_MODE_ORDER.map((modeId) => {
              const Icon = MODE_ICONS[modeId]
              return (
                <DropdownMenuRadioItem key={modeId} value={modeId} className="items-start">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block text-xs font-medium text-foreground">
                      {getIdeModeLabel(modeId)}
                    </span>
                    <span className="block text-2xs text-muted-foreground">
                      {getIdeModeDescription(modeId)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <IdeModelPicker
        conversation={conversation}
        providers={providers}
        providersLoading={providersLoading}
        worktreeSelector={worktreeSelector}
      />
    </div>
  )
}
