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
import { LoadingSpinner } from '@/components/LoadingSpinner'
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
    <div className="overflow-hidden rounded-md border border-border/70 bg-card/70 text-xs">
      <div className="flex items-start justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-start"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="mt-0.5 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5 rtl:rotate-180" />
            )}
          </span>
          <span
            dir="ltr"
            className="min-w-0 flex-1 break-all font-mono text-2xs font-medium text-foreground"
          >
            {record.command}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="referenceLabel">{record.category}</Badge>
          <Badge
            variant={
              record.status === 'failed'
                ? 'destructive'
                : record.status === 'running'
                  ? 'secondary'
                  : 'referenceLabel'
            }
          >
            {record.status === 'passed' ? <CheckCircle2 className="size-2.5" /> : null}
            {record.status === 'failed' ? <XCircle className="size-2.5" /> : null}
            {record.status === 'running' ? <LoadingSpinner className="size-2.5" /> : null}
            {record.status}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border/50 px-2.5 py-1 text-3xs text-muted-foreground">
        <span dir="ltr">
          exit: {record.exitCode ?? '—'}
          {record.durationMs !== undefined ? ` · ${record.durationMs}ms` : ''}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock className="size-2.5" />
          {new Date(record.startedAt).toLocaleTimeString()}
        </span>
      </div>

      {expanded && combinedOutput ? (
        <pre
          dir="ltr"
          className="scrollbar-sleek max-h-56 overflow-auto border-t border-border/60 bg-background/90 p-2 font-mono text-3xs whitespace-pre-wrap break-all text-foreground"
        >
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
      const ok = await runCommand({
        conversationId: conversation.id,
        worktreeSelector,
        command: trimmed,
        category
      })
      if (ok) {
        setCommandInput('')
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b border-border/70 p-2.5">
        <div className="text-2xs font-medium text-muted-foreground">
          Run Workspace Check or Command
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={category} onValueChange={(v) => setCategory(v as IdeCommandCategory)}>
            <SelectTrigger size="sm" density="compact" className="w-[96px]">
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
            dir="ltr"
            variant="code"
            density="compact"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRun()
              }
            }}
            placeholder="e.g. pnpm test or pnpm tc"
            className="flex-1"
            disabled={!conversation || !worktreeSelector || running}
          />
          <Button
            size="xs"
            disabled={!conversation || !worktreeSelector || !commandInput.trim() || running}
            onClick={() => void handleRun()}
          >
            {running ? <LoadingSpinner className="size-3" /> : <Play className="size-3" />}
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
