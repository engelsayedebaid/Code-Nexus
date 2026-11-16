import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeModelPicker } from './IdeModelPicker'

const EXECUTION_MODES: { id: IdeExecutionMode; label: string; description: string }[] = [
  { id: 'ask', label: 'Ask', description: 'Read-only Q&A, code explanations, no edits' },
  { id: 'plan', label: 'Plan', description: 'Inspect workspace & propose approval plan' },
  { id: 'agent', label: 'Agent', description: 'Plan -> Approve -> Execute edits & verify' },
  { id: 'review', label: 'Review', description: 'Inspect diffs, quality, bugs & security' }
]

/** Mode + model pickers rendered inside the composer toolbar. */
export function IdeComposerModeModelPicker({
  conversation,
  providers,
  providersLoading
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
  providersLoading: boolean
}) {
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)

  const activeMode: IdeExecutionMode = conversation?.mode ?? 'agent'

  return (
    <>
      <Select
        value={activeMode}
        onValueChange={(value) => {
          const nextMode = value as IdeExecutionMode
          if (conversation) {
            void updateSettings({ conversationId: conversation.id, mode: nextMode })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          density="compact"
          disabled={!conversation}
          className="h-6! w-[72px] shrink-0 gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[11px] font-medium shadow-none hover:bg-accent/60 [&_svg]:size-3.5"
          data-testid="ide-mode-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXECUTION_MODES.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              <span className="font-medium">{m.label}</span>
              <span className="text-[10px] text-muted-foreground">{m.description}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <IdeModelPicker
        conversation={conversation}
        providers={providers}
        providersLoading={providersLoading}
      />
    </>
  )
}
