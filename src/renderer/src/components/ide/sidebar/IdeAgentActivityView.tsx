import { useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileCode2,
  Terminal
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { cn } from '@/lib/class-names'
import type {
  IdeActivityEvent,
  IdeAgentRole,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

const ROLE_FILTERS: { id: 'all' | IdeAgentRole; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'planner', label: 'Planner' },
  { id: 'coder', label: 'Coder' },
  { id: 'test-fixer', label: 'Test Fixer' },
  { id: 'reviewer', label: 'Reviewer' }
]

function statusBadgeColor(status: IdeActivityEvent['status']): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
    case 'running':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-500'
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

function ActivityRow({
  event,
  scratchWorkspace
}: {
  event: IdeActivityEvent
  scratchWorkspace: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const hasPayload = Boolean(
    event.detail ||
    event.command ||
    (event.expandablePayload && Object.keys(event.expandablePayload).length > 0)
  )

  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-2.5 py-2 text-xs space-y-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
          disabled={!hasPayload}
          onClick={() => hasPayload && setExpanded((prev) => !prev)}
        >
          <span className="mt-0.5 text-muted-foreground">
            {hasPayload ? (
              expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )
            ) : event.status === 'running' ? (
              <LoadingSpinner className="size-3.5" />
            ) : event.status === 'error' ? (
              <AlertCircle className="size-3.5 text-destructive" />
            ) : event.status === 'completed' ? (
              <CheckCircle2 className="size-3.5 text-emerald-500" />
            ) : (
              <Activity className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 font-medium text-foreground break-words">
            {event.summary}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {event.role}
          </Badge>
          <Badge
            variant="outline"
            className={cn('text-[10px] px-1.5 py-0', statusBadgeColor(event.status))}
          >
            {event.status}
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pl-5 text-[10.5px] text-muted-foreground">
        <span className="font-mono">{event.type}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-2.5" />
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {event.relativePath ? (
        <div className="pl-5">
          <button
            type="button"
            onClick={() =>
              openWorkspaceFileInEditor(event.relativePath!, undefined, scratchWorkspace)
            }
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/80 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground hover:bg-accent/60"
          >
            <FileCode2 className="size-3 text-muted-foreground" />
            {event.relativePath}
          </button>
        </div>
      ) : null}

      {expanded && hasPayload ? (
        <div className="ml-5 space-y-1.5 rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
          {event.detail ? (
            <div className="whitespace-pre-wrap break-words">{event.detail}</div>
          ) : null}
          {event.command ? (
            <div className="flex items-center gap-1.5 font-mono text-foreground">
              <Terminal className="size-3 shrink-0" />
              <span className="break-all">{event.command}</span>
            </div>
          ) : null}
          {event.expandablePayload && Object.keys(event.expandablePayload).length > 0 ? (
            <pre className="scrollbar-sleek overflow-x-auto font-mono text-[10.5px] text-foreground/90">
              {JSON.stringify(event.expandablePayload, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function IdeAgentActivityView({ conversation }: { conversation: IdeConversation | null }) {
  const [roleFilter, setRoleFilter] = useState<'all' | IdeAgentRole>('all')

  const events = useMemo(() => {
    const raw = conversation?.activity ?? []
    const filtered = roleFilter === 'all' ? raw : raw.filter((e) => e.role === roleFilter)
    return [...filtered].sort((a, b) => b.seq - a.seq)
  }, [conversation?.activity, roleFilter])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70 px-2.5 py-2">
        {ROLE_FILTERS.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => setRoleFilter(role.id)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              roleFilter === role.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {role.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-sleek flex-1 space-y-2 overflow-y-auto p-2.5">
        {events.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Activity className="mb-2 size-5 opacity-50" />
            <span>No AI agent activity recorded yet.</span>
          </div>
        ) : (
          events.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              scratchWorkspace={conversation?.workspaceKey.startsWith('ide-scratch:') === true}
            />
          ))
        )}
      </div>
    </div>
  )
}
