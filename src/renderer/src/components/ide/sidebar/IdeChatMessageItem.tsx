import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, Copy, FileCode2, Terminal, XCircle } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { cn } from '@/lib/class-names'
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

  const [copied, setCopied] = useState(false)
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
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.attachments.map((att) => (
                <div
                  key={att.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1 text-2xs"
                >
                  {att.kind === 'image' && att.dataUrl ? (
                    <img src={att.dataUrl} alt={att.name} className="size-4 rounded object-cover" />
                  ) : (
                    <AppIcon name="attachFile" className="size-3 text-muted-foreground" />
                  )}
                  <span dir="ltr" className="max-w-[160px] truncate font-mono text-2xs">
                    {att.name}
                  </span>
                  {att.sensitiveWarning ? (
                    <AppIcon
                      name="warning"
                      className="size-3 text-amber-500"
                      label={copy.sensitiveFile}
                    />
                  ) : null}
                </div>
              ))}
            </div>
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
        <div className="flex flex-wrap gap-1.5">
          {message.attachments.map((att) => (
            <div
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1 text-2xs"
            >
              {att.kind === 'image' && att.dataUrl ? (
                <img src={att.dataUrl} alt={att.name} className="size-4 rounded object-cover" />
              ) : (
                <AppIcon name="attachFile" className="size-3 text-muted-foreground" />
              )}
              <span dir="ltr" className="max-w-[160px] truncate font-mono text-2xs">
                {att.name}
              </span>
              {att.sensitiveWarning ? (
                <AppIcon
                  name="warning"
                  className="size-3 text-amber-500"
                  label={copy.sensitiveFile}
                />
              ) : null}
            </div>
          ))}
        </div>
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

      {linkedCommands.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-border/60 bg-card/60 p-2.5">
          <div className="text-2xs font-medium text-muted-foreground">{copy.commandsTitle}</div>
          <div className="space-y-1">
            {linkedCommands.map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-2xs"
              >
                <span
                  dir="ltr"
                  className="flex min-w-0 items-center gap-1.5 font-mono text-foreground/90"
                >
                  <Terminal className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{cmd.command}</span>
                </span>
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
            ))}
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
