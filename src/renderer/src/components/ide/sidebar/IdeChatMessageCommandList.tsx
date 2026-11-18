import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Terminal, XCircle } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdeCommandExecutionRecord } from '../../../../../shared/ide-agent/ide-agent-types'
import { getIdeChatCopy } from './ide-chat-copy'

export function IdeChatMessageCommandList({
  commands
}: {
  commands: readonly IdeCommandExecutionRecord[]
  isArabic?: boolean
}) {
  const commandLiveOutput = useIdeAgentStore((s) => s.commandLiveOutput)
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({})
  const copy = getIdeChatCopy()

  if (commands.length === 0) {
    return null
  }

  return (
    <div
      dir="ltr"
      className="space-y-1 rounded-xl border border-border/60 bg-card/60 p-2.5 text-left"
    >
      <div className="text-2xs font-medium text-muted-foreground">{copy.commandsTitle}</div>
      <div className="space-y-1">
        {commands.map((cmd) => {
          const liveText = commandLiveOutput[cmd.id]
          const combinedOutput = (liveText ?? `${cmd.stdoutTail}${cmd.stderrTail}`).trim()
          const hasOutput = combinedOutput.length > 0
          const expanded = Boolean(expandedCommands[cmd.id])
          const statusLabel =
            cmd.status === 'passed'
              ? copy.passed
              : cmd.status === 'failed'
                ? copy.failed
                : cmd.status === 'running'
                  ? copy.running
                  : cmd.status === 'canceled'
                    ? copy.canceled
                    : copy.denied
          return (
            <div key={cmd.id} className="rounded-md bg-muted/45 px-2 py-1 text-2xs">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={!hasOutput}
                  onClick={() =>
                    setExpandedCommands((prev) => ({ ...prev, [cmd.id]: !prev[cmd.id] }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
                >
                  {hasOutput ? (
                    expanded ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground rtl:rotate-180" />
                    )
                  ) : (
                    <Terminal className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span dir="ltr" className="truncate font-mono text-foreground/90">
                    {cmd.command}
                  </span>
                </button>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 font-medium',
                    cmd.status === 'failed'
                      ? 'text-destructive'
                      : cmd.status === 'passed'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                  )}
                >
                  {cmd.status === 'passed' ? (
                    <CheckCircle2 className="size-3" />
                  ) : cmd.status === 'running' ? (
                    <LoadingSpinner className="size-3" />
                  ) : cmd.status === 'failed' ? (
                    <XCircle className="size-3" />
                  ) : null}
                  {statusLabel}
                </span>
              </div>
              {expanded && hasOutput ? (
                <pre
                  dir="ltr"
                  className="scrollbar-sleek mt-1.5 max-h-36 overflow-auto rounded bg-background/80 p-1.5 font-mono text-3xs whitespace-pre-wrap text-muted-foreground"
                >
                  {combinedOutput.slice(-2000)}
                </pre>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
