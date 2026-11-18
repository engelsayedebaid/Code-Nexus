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

function statusBadgeVariant(
  status: IdeActivityEvent['status']
): 'secondary' | 'destructive' | 'referenceLabel' {
  if (status === 'error') {
    return 'destructive'
  }
  if (status === 'running' || status === 'warning') {
    return 'secondary'
  }
  return 'referenceLabel'
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
    <div className="space-y-1 rounded-md border border-border/60 bg-card/60 px-2.5 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-start"
          disabled={!hasPayload}
          onClick={() => hasPayload && setExpanded((prev) => !prev)}
        >
          <span className="mt-0.5 text-muted-foreground">
            {hasPayload ? (
              expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5 rtl:rotate-180" />
              )
            ) : event.status === 'running' ? (
              <LoadingSpinner className="size-3.5" />
            ) : event.status === 'error' ? (
              <AlertCircle className="size-3.5 text-destructive" />
            ) : event.status === 'completed' ? (
              <CheckCircle2 className="size-3.5 text-foreground/80" />
            ) : (
              <Activity className="size-3.5" />
            )}
          </span>
          <span dir="auto" className="min-w-0 flex-1 break-words font-medium text-foreground">
            {event.summary}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="referenceLabel">{event.role}</Badge>
          <Badge variant={statusBadgeVariant(event.status)}>{event.status}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 ps-5 text-3xs text-muted-foreground">
        <span dir="ltr" className="font-mono">
          {event.type}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock className="size-2.5" />
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {event.relativePath ? (
        <div className="ps-5">
          <button
            type="button"
            dir="ltr"
            onClick={() =>
              openWorkspaceFileInEditor(event.relativePath!, undefined, scratchWorkspace)
            }
            className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/80 px-1.5 py-0.5 font-mono text-3xs text-foreground hover:bg-accent/60"
          >
            <FileCode2 className="size-3 text-muted-foreground" />
            {event.relativePath}
          </button>
        </div>
      ) : null}

      {expanded && hasPayload ? (
        <div className="ms-5 space-y-1.5 rounded bg-muted/30 p-2 text-2xs text-muted-foreground">
          {event.detail ? (
            <div dir="auto" className="whitespace-pre-wrap break-words">
              {event.detail}
            </div>
          ) : null}
          {event.command ? (
            <div dir="ltr" className="flex items-center gap-1.5 font-mono text-foreground">
              <Terminal className="size-3 shrink-0" />
              <span className="break-all">{event.command}</span>
            </div>
          ) : null}
          {event.expandablePayload && Object.keys(event.expandablePayload).length > 0 ? (
            <pre
              dir="ltr"
              className="scrollbar-sleek overflow-x-auto font-mono text-3xs text-foreground/90"
            >
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
    const raw = (conversation?.activity ?? []).filter((e) => e.type !== 'editor.edit_chunk')
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
              'rounded-full px-2 py-0.5 text-2xs font-medium transition-colors',
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
