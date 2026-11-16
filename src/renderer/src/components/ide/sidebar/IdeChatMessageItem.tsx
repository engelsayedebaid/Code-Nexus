import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  Terminal,
  XCircle
} from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import {
  hasArabicText,
  isArabicIdeConversation
} from '../../../../../shared/ide-agent/ide-language'
import type {
  IdeChatMessage,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeProviderAgentOption,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'
import { AppIcon } from '@/components/icons/app-icon'
import { formatIdeFileCount, getIdeChatCopy, getIdeModeLabel } from './ide-chat-copy'
import { IdeChatMarkdown } from './IdeChatMarkdown'
import { IdePlanProposalCard } from './IdePlanProposalCard'
import { IdeToolActivityTimeline } from './IdeToolActivityTimeline'
import { IdeMessageAttachmentsList } from './IdeMessageAttachmentsList'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

const LEGACY_PLAN_MARKDOWN_PREFIX =
  /^### (?:Proposed Implementation Plan|خطة التنفيذ المقترحة) \(v\d+\)/

function resolveDisplayModelLabel(
  providers: readonly IdeProviderAgentOption[],
  agentId?: string,
  modelId?: string
): string | null {
  if (!modelId) {
    return null
  }
  const provider = providers.find((p) => p.id === agentId)
  const model = provider?.models.find((m) => m.id === modelId)
  return model?.label ?? modelId
}

function resolveDisplayContent(
  message: IdeChatMessage,
  linkedPlan: IdeTaskPlan | undefined,
  arabic: boolean
): string {
  if (!linkedPlan) {
    return message.text
  }
  if (LEGACY_PLAN_MARKDOWN_PREFIX.test(message.text.trimStart())) {
    if (linkedPlan.intro?.trim()) {
      return linkedPlan.intro.trim()
    }
    return arabic
      ? `جهّزت لك خطة العمل (${formatIdeFileCount(linkedPlan.affectedFiles.length, true)}).`
      : `Prepared an implementation plan (${formatIdeFileCount(linkedPlan.affectedFiles.length, false)}).`
  }
  return message.text
}

export function IdeChatMessageItem({
  message,
  conversation,
  providers,
  plansById,
  commandsById
}: {
  message: IdeChatMessage
  conversation: IdeConversation
  providers: IdeProviderAgentOption[]
  plansById: Map<string, IdeTaskPlan>
  commandsById: Map<string, IdeCommandExecutionRecord>
}) {
  const linkedPlan = message.planId ? plansById.get(message.planId) : undefined
  const linkedCommands = (message.commandIds ?? [])
    .map((id) => commandsById.get(id))
    .filter((c): c is IdeCommandExecutionRecord => Boolean(c))
  const isUser = message.role === 'user'
  const commandLiveOutput = useIdeAgentStore((s) => s.commandLiveOutput)

  const [copied, setCopied] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({})
  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const isArabic =
    hasArabicText(message.text) ||
    (linkedPlan
      ? hasArabicText(`${linkedPlan.requestSummary ?? ''}\n${linkedPlan.objective}`)
      : false) ||
    isArabicIdeConversation(conversation.messages)
  const copy = getIdeChatCopy(isArabic)

  const handleCopy = useCallback(async (text: string) => {
    try {
      if (window.api?.ui?.writeClipboardText) {
        await window.api.ui.writeClipboardText(text)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
      setCopied(true)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1500)
    } catch {
      /* ignore clipboard unavailability */
    }
  }, [])

  if (isUser) {
    return (
      <div data-testid={`ide-chat-message-${message.role}`} className="flex justify-end">
        <div className="max-w-[88%] space-y-2">
          {message.attachments && message.attachments.length > 0 ? (
            <IdeMessageAttachmentsList
              conversationId={conversation.id}
              attachments={message.attachments}
              align="end"
              sensitiveFileLabel={copy.sensitiveFile}
            />
          ) : null}
          <div
            dir="auto"
            className="whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-muted px-3.5 py-2 text-xs leading-relaxed text-foreground"
          >
            {message.text}
          </div>
        </div>
      </div>
    )
  }

  // Only render the interactive plan card on the proposal message itself (not again on the final completion receipt).
  const isProposalForPlan =
    Boolean(linkedPlan) &&
    !message.modifiedFiles &&
    !message.commandIds?.length &&
    linkedPlan?.approvalRecord?.note !== 'auto_approved_small_change' &&
    conversation.messages.find((m) => m.planId === linkedPlan?.id)?.id === message.id

  const displayContent = resolveDisplayContent(message, linkedPlan, isArabic)
  const modelLabel = resolveDisplayModelLabel(providers, message.agentId, message.modelId)
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })
  const runActivity =
    !isProposalForPlan && message.runId
      ? conversation.activity.filter(
          (ev) => ev.runId === message.runId && ev.type !== 'editor.edit_chunk'
        )
      : []

  return (
    <div
      dir={isArabic ? 'rtl' : 'ltr'}
      data-testid={`ide-chat-message-${message.role}`}
      className="group space-y-2.5 px-0.5"
    >
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <AppIcon name="sparkles" className="size-3 text-foreground/80" />
        <span className="font-medium text-foreground">Nexus</span>
        <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0 text-3xs text-muted-foreground">
          {getIdeModeLabel(message.mode, isArabic)}
        </span>
        {modelLabel ? (
          <span className="truncate text-2xs text-muted-foreground/75">{modelLabel}</span>
        ) : null}
        {message.streaming ? <LoadingSpinner className="size-3 text-muted-foreground" /> : null}

        <div className="ms-auto flex items-center gap-1">
          {displayContent && !message.streaming ? (
            <button
              type="button"
              onClick={() => void handleCopy(displayContent)}
              aria-label={copied ? copy.copied : copy.copyMessage}
              title={copied ? copy.copied : copy.copyMessage}
              className={cn(
                'inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100',
                copied ? 'text-emerald-500 opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </button>
          ) : null}
          <span className="tabular-nums text-2xs text-muted-foreground/70">{timeLabel}</span>
        </div>
      </div>

      {message.attachments && message.attachments.length > 0 ? (
        <IdeMessageAttachmentsList
          conversationId={conversation.id}
          attachments={message.attachments}
          align="start"
          sensitiveFileLabel={copy.sensitiveFile}
        />
      ) : null}

      {displayContent ? (
        <IdeChatMarkdown
          content={displayContent}
          streaming={message.streaming}
          className="leading-[1.65]"
        />
      ) : message.streaming ? (
        <p className="text-xs text-muted-foreground">{copy.thinking}</p>
      ) : null}

      {message.modifiedFiles && message.modifiedFiles.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/60 p-2.5">
          <div className="text-2xs font-medium text-muted-foreground">
            {copy.modifiedFilesTitle} ({message.modifiedFiles.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {message.modifiedFiles.map((filePath) => (
              <button
                key={filePath}
                type="button"
                onClick={() => openWorkspaceFileInEditor(filePath)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-2xs text-foreground transition-colors hover:bg-accent/60"
              >
                <FileCode2 className="size-3 shrink-0 text-emerald-500" />
                <span dir="ltr">{filePath}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {runActivity.length > 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-2.5">
          <button
            type="button"
            onClick={() => setShowActivity((prev) => !prev)}
            className="flex w-full items-center gap-1.5 text-2xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showActivity ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            <span>
              {isArabic ? `النشاط (${runActivity.length})` : `Activity (${runActivity.length})`}
            </span>
          </button>
          {showActivity ? (
            <div className="mt-2">
              <IdeToolActivityTimeline events={runActivity} isArabic={isArabic} compact />
            </div>
          ) : null}
        </div>
      ) : null}

      {linkedCommands.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-border/60 bg-card/60 p-2.5">
          <div className="text-2xs font-medium text-muted-foreground">{copy.commandsTitle}</div>
          <div className="space-y-1">
            {linkedCommands.map((cmd) => {
              const liveText = commandLiveOutput[cmd.id]
              const combinedOutput = (liveText ?? `${cmd.stdoutTail}${cmd.stderrTail}`).trim()
              const hasOutput = combinedOutput.length > 0
              const expanded = Boolean(expandedCommands[cmd.id])
              return (
                <div key={cmd.id} className="rounded-md bg-muted/50 px-2 py-1 text-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={!hasOutput}
                      onClick={() =>
                        setExpandedCommands((prev) => ({ ...prev, [cmd.id]: !prev[cmd.id] }))
                      }
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      {hasOutput ? (
                        expanded ? (
                          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
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
                        cmd.status === 'passed' ? 'text-emerald-500' : 'text-destructive'
                      )}
                    >
                      {cmd.status === 'passed' ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <XCircle className="size-3" />
                      )}
                      {cmd.status === 'passed'
                        ? copy.passed
                        : cmd.status === 'failed'
                          ? copy.failed
                          : cmd.status}
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
      ) : null}

      {linkedPlan && isProposalForPlan ? (
        <IdePlanProposalCard
          plan={linkedPlan}
          conversationId={message.conversationId}
          agentId={conversation.agentId || providers[0]?.id || 'codex'}
          modelId={conversation.modelId || providers[0]?.defaultModelId || ''}
          providers={providers}
          compact
          arabic={isArabic}
        />
      ) : null}

      {message.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-2xs text-destructive">
          <AppIcon name="error" className="mt-0.5 size-3.5 shrink-0" />
          <span dir="auto" className="break-words">
            {message.error}
          </span>
        </div>
      ) : null}
    </div>
  )
}
