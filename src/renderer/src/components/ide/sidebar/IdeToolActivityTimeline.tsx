import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FolderPlus,
  FolderX,
  Search,
  Sparkles,
  Stethoscope,
  Terminal
} from 'lucide-react'
import { cn } from '@/lib/class-names'
import type { IdeActivityEvent } from '../../../../../shared/ide-agent/ide-agent-types'
import { formatIdeFileCount } from './ide-chat-copy'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

type TimelineItem =
  | { kind: 'read-group'; id: string; events: IdeActivityEvent[] }
  | { kind: 'single'; id: string; event: IdeActivityEvent }

const HIDDEN_TIMELINE_TYPES = new Set<IdeActivityEvent['type']>([
  'editor.edit_chunk',
  'analysis.started',
  'analysis.completed'
])

export function groupIdeActivityEvents(
  events: IdeActivityEvent[],
  maxItems?: number
): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const event of events) {
    if (HIDDEN_TIMELINE_TYPES.has(event.type)) {
      continue
    }
    if (event.type === 'analysis.file_read') {
      const prev = items.at(-1)
      if (prev?.kind === 'read-group') {
        prev.events.push(event)
      } else {
        items.push({ kind: 'read-group', id: `rg-${event.id}`, events: [event] })
      }
      continue
    }
    items.push({ kind: 'single', id: event.id, event })
  }
  if (typeof maxItems === 'number' && maxItems > 0 && items.length > maxItems) {
    return items.slice(-maxItems)
  }
  return items
}

function ActivityKindIcon({ event }: { event: IdeActivityEvent }) {
  if (event.status === 'error') {
    return <AlertTriangle className="size-3 shrink-0 text-destructive" />
  }
  switch (event.type) {
    case 'tool.search':
      return <Search className="size-3 shrink-0 text-muted-foreground" />
    case 'tool.symbol_lookup':
      return <Braces className="size-3 shrink-0 text-muted-foreground" />
    case 'diagnostics.checked':
      return <Stethoscope className="size-3 shrink-0 text-muted-foreground" />
    case 'folder.created':
      return <FolderPlus className="size-3 shrink-0 text-foreground/80" />
    case 'folder.deleted':
      return <FolderX className="size-3 shrink-0 text-destructive" />
    case 'command.started':
    case 'command.finished':
      return <Terminal className="size-3 shrink-0 text-muted-foreground" />
    case 'live_edit.started':
    case 'step.retrying':
    case 'context.compacted':
      return <Sparkles className="size-3 shrink-0 text-foreground/80" />
    case 'live_edit.completed':
    case 'step.completed':
    case 'run.completed':
      return <CheckCircle2 className="size-3 shrink-0 text-foreground/80" />
    default:
      return <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
  }
}

function formatPayloadPreview(event: IdeActivityEvent): string | null {
  if (event.detail && event.detail.trim().length > 0) {
    return event.detail.trim()
  }
  if (!event.expandablePayload) {
    return null
  }
  try {
    const raw = JSON.stringify(event.expandablePayload, null, 2)
    return raw.length > 700 ? `${raw.slice(0, 700)}\n…` : raw
  } catch {
    return null
  }
}

export function IdeToolActivityTimeline({
  events,
  maxItems,
  scratchWorkspace = false,
  compact = false
}: {
  events: IdeActivityEvent[]
  maxItems?: number
  isArabic?: boolean
  scratchWorkspace?: boolean
  compact?: boolean
}) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const items = useMemo(() => groupIdeActivityEvents(events, maxItems), [events, maxItems])

  if (items.length === 0) {
    return null
  }

  const toggle = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div dir="ltr" className={cn('space-y-1 text-left', compact ? 'text-2xs' : 'text-xs')}>
      {items.map((item) => {
        if (item.kind === 'read-group') {
          const open = Boolean(expandedIds[item.id])
          const count = item.events.length
          const label = count === 1 ? item.events[0].summary : `Read ${formatIdeFileCount(count)}`
          return (
            <div key={item.id} className="rounded-md px-1 py-0.5">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-center gap-1.5 text-left text-2xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="size-3 shrink-0" />
                ) : (
                  <ChevronRight className="size-3 shrink-0" />
                )}
                <FileCode2 className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
              {open ? (
                <div className="mt-1 space-y-0.5 border-l border-border/70 pl-3.5 pt-0.5">
                  {item.events.map((ev) => (
                    <div key={ev.id} className="flex items-center justify-between gap-2 text-3xs">
                      {ev.relativePath ? (
                        <button
                          type="button"
                          onClick={() =>
                            openWorkspaceFileInEditor(ev.relativePath!, undefined, scratchWorkspace)
                          }
                          className="truncate font-mono text-foreground/85 hover:underline"
                        >
                          {ev.relativePath}
                        </button>
                      ) : (
                        <span className="truncate text-muted-foreground">{ev.summary}</span>
                      )}
                      {ev.detail ? (
                        <span className="shrink-0 font-mono text-muted-foreground">
                          {ev.detail}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }

        const { event } = item
        const payload = formatPayloadPreview(event)
        const open = Boolean(expandedIds[item.id])

        return (
          <div
            key={item.id}
            className={cn(
              'rounded-md px-1 py-0.5',
              event.status === 'error' && 'border border-destructive/40 bg-destructive/5 py-1'
            )}
          >
            <div className="flex items-center gap-1.5">
              <ActivityKindIcon event={event} />
              <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {event.summary}
              </span>
              {event.relativePath ? (
                <button
                  type="button"
                  onClick={() =>
                    openWorkspaceFileInEditor(event.relativePath!, undefined, scratchWorkspace)
                  }
                  className="max-w-[140px] shrink-0 truncate font-mono text-3xs text-foreground/85 hover:underline"
                >
                  {event.relativePath}
                </button>
              ) : null}
              {payload ? (
                <button
                  type="button"
                  aria-label="Toggle activity detail"
                  onClick={() => toggle(item.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
              ) : null}
            </div>
            {open && payload ? (
              <pre className="scrollbar-sleek mt-1 max-h-32 overflow-auto rounded border border-border/50 bg-muted/35 p-1.5 font-mono text-3xs whitespace-pre-wrap text-muted-foreground">
                {payload}
              </pre>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
