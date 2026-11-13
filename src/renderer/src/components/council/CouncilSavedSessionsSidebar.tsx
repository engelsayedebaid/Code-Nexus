import { BrainCircuit, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/class-names'
import type { CouncilSession } from '../../../../shared/council/council-contract'
import { MODE_LABELS } from './council-session-execution'

export function CouncilSavedSessionsSidebar(props: {
  savedSessions: CouncilSession[]
  activeSessionId: string | undefined
  liveSessionId: string | undefined
  isRunning: boolean
  onNewCouncil: () => void
  onSelectSession: (session: CouncilSession, isLive: boolean) => void
  onDeleteSession: (sessionId: string) => void
}): React.JSX.Element {
  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-card/45">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BrainCircuit className="size-4" /> Nexus Council
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Multi-model analysis workspace</p>
      </div>
      <div className="p-3">
        <Button className="w-full justify-start" size="sm" onClick={props.onNewCouncil}>
          <Plus className="size-3.5 mr-1.5" /> New Council
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <p className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          Saved sessions
        </p>
        <div className="space-y-1 pb-3">
          {props.savedSessions.map((saved) => {
            const isLive = props.isRunning && props.liveSessionId === saved.id
            return (
              <div
                key={saved.id}
                className={cn(
                  'group/session flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-accent/60',
                  props.activeSessionId === saved.id && 'bg-accent'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 px-1 text-left"
                  onClick={() => props.onSelectSession(saved, isLive)}
                >
                  <span className="block truncate text-xs font-medium">{saved.title}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {MODE_LABELS[saved.mode]} · {isLive ? 'running' : saved.status}
                  </span>
                </button>
                {!isLive ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Delete Council session"
                    className="shrink-0 opacity-0 transition-opacity group-hover/session:opacity-100 focus-visible:opacity-100"
                    onClick={() => props.onDeleteSession(saved.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </div>
            )
          })}
          {props.savedSessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No Council sessions yet.</p>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}
