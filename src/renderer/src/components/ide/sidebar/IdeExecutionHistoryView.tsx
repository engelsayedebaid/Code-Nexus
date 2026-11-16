import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Play,
  Terminal,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'

function CommandRow({
  record,
  liveOutput
}: {
  record: IdeCommandExecutionRecord
  liveOutput?: string
}) {
  const [expanded, setExpanded] = useState(
    record.status === 'running' || record.status === 'failed'
  )
  const combinedOutput =
    liveOutput || [record.stdoutTail, record.stderrTail].filter(Boolean).join('\n')

  return (
    <div className="rounded-md border border-border/70 bg-card/70 text-xs overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="mt-0.5 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 font-mono text-[11px] font-medium text-foreground break-all">
            {record.command}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {record.category}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 gap-1',
              record.status === 'passed' &&
                'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
              record.status === 'failed' &&
                'border-destructive/40 bg-destructive/10 text-destructive',
              record.status === 'running' && 'border-sky-500/40 bg-sky-500/10 text-sky-500'
            )}
          >
            {record.status === 'passed' ? <CheckCircle2 className="size-2.5" /> : null}
            {record.status === 'failed' ? <XCircle className="size-2.5" /> : null}
            {record.status}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 px-2.5 py-1 text-[10.5px] text-muted-foreground">
        <span>
          exit: {record.exitCode ?? '—'}
          {record.durationMs !== undefined ? ` · ${record.durationMs}ms` : ''}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-2.5" />
          {new Date(record.startedAt).toLocaleTimeString()}
        </span>
      </div>

      {expanded && combinedOutput ? (
        <pre className="scrollbar-sleek max-h-56 overflow-auto border-t border-border/60 bg-background/90 p-2 font-mono text-[10.5px] text-foreground whitespace-pre-wrap break-all">
          {combinedOutput}
        </pre>
      ) : null}
    </div>
  )
}

export function IdeExecutionHistoryView({
  conversation,
  worktreeSelector
}: {
  conversation: IdeConversation | null
  worktreeSelector: string | null
}) {
  const runCommand = useIdeAgentStore((s) => s.runCommand)
  const commandLiveOutput = useIdeAgentStore((s) => s.commandLiveOutput)
  const [commandInput, setCommandInput] = useState('')
  const [category, setCategory] = useState<IdeCommandCategory>('test')
  const [running, setRunning] = useState(false)

  const commands = useMemo(
    () => [...(conversation?.commandExecutions ?? [])].sort((a, b) => b.startedAt - a.startedAt),
    [conversation?.commandExecutions]
  )

  const handleRun = async () => {
    const trimmed = commandInput.trim()
    if (!trimmed || !conversation || !worktreeSelector) {
      return
    }
    setRunning(true)
    try {
      await runCommand({
        conversationId: conversation.id,
        worktreeSelector,
        command: trimmed,
        category
      })
      setCommandInput('')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 p-2.5 space-y-1.5">
        <div className="text-[11px] font-medium text-muted-foreground">
          Run Workspace Check or Command (approved plan / permission gated)
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={category} onValueChange={(v) => setCategory(v as IdeCommandCategory)}>
            <SelectTrigger size="sm" density="compact" className="h-7 w-[88px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">Test</SelectItem>
              <SelectItem value="typecheck">Typecheck</SelectItem>
              <SelectItem value="lint">Lint</SelectItem>
              <SelectItem value="build">Build</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRun()
              }
            }}
            placeholder="e.g. pnpm test or npm run typecheck"
            className="h-7 flex-1 font-mono text-xs"
            disabled={!conversation || !worktreeSelector || running}
          />
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={!conversation || !worktreeSelector || !commandInput.trim() || running}
            onClick={() => void handleRun()}
          >
            <Play className="mr-1 size-3" />
            Run
          </Button>
        </div>
      </div>

      <div className="scrollbar-sleek flex-1 space-y-2 overflow-y-auto p-2.5">
        {commands.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Terminal className="mb-2 size-5 opacity-50" />
            <span>No commands or test runs recorded yet.</span>
          </div>
        ) : (
          commands.map((record) => (
            <CommandRow key={record.id} record={record} liveOutput={commandLiveOutput[record.id]} />
          ))
        )}
      </div>
    </div>
  )
}
