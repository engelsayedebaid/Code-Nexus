import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { markdownMessageDirection } from '@/components/sidebar/comment-markdown-direction'
import {
  MarkdownDirectionToggle,
  useMarkdownDirectionOverride
} from '@/components/sidebar/MarkdownDirectionToggle'
import { SecuritySurface } from '@/components/ui/security-surface'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdeCommandExecutionRecord } from '../../../../../shared/ide-agent/ide-agent-types'
import { AppIcon } from '@/components/icons/app-icon'
import { IdeAlertCard } from './IdeAlertCard'
import { getIdeChatCopy, getIdeModeLabel } from './ide-chat-copy'
import {
  areIdeChatMessagePropsEqual,
  resolveDisplayContent,
  resolveDisplayModelLabel,
  type IdeChatMessageItemProps
} from './ide-chat-message-equality'
import { IdeChatMarkdown } from './IdeChatMarkdown'
import { IdeChatMessageCommandList } from './IdeChatMessageCommandList'
import { IdeChatTurnChangesCard } from './IdeChatTurnChangesCard'
import { IdePlanProposalCard } from './IdePlanProposalCard'
import { IdeToolActivityTimeline } from './IdeToolActivityTimeline'
import { IdeMessageAttachmentsList } from './IdeMessageAttachmentsList'

export const IdeChatMessageItem = React.memo(function IdeChatMessageItem({
  message,
  conversation,
  providers,
  providersLoading = false,
  worktreeSelector,
  plansById,
  commandsById,
  isLatestMessage = false
}: IdeChatMessageItemProps) {
  const linkedPlan = message.planId ? plansById.get(message.planId) : undefined
  const linkedCommands = (message.commandIds ?? [])
    .map((id) => commandsById.get(id))
    .filter((c): c is IdeCommandExecutionRecord => Boolean(c))
  const controlRun = useIdeAgentStore((s) => s.controlRun)
  const refreshProviders = useIdeAgentStore((s) => s.refreshProviders)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const clearError = useIdeAgentStore((s) => s.clearError)

  const [copied, setCopied] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [directionOverride, setDirectionOverride] = useMarkdownDirectionOverride(message.id)
  const copyTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const copy = getIdeChatCopy()
  const scratchWorkspace = conversation.workspaceKey.startsWith('ide-scratch:')
  const timeLabel = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })

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

  if (message.role === 'user') {
    const autoUserDir = markdownMessageDirection(message.text)
    const effectiveUserDir = directionOverride === 'auto' ? autoUserDir : directionOverride
    return (
      <div
        dir="ltr"
        data-testid="ide-chat-message-user"
        className={cn(
          'group flex w-full flex-col items-end gap-1',
          !isLatestMessage && '[content-visibility:auto] [contain-intrinsic-size:auto_72px]'
        )}
      >
        {message.attachments && message.attachments.length > 0 ? (
          <IdeMessageAttachmentsList
            conversationId={conversation.id}
            attachments={message.attachments}
            align="end"
            sensitiveFileLabel={copy.sensitiveFile}
          />
        ) : null}
        <div
          dir={effectiveUserDir}
          className={cn(
            'max-w-[85%] rounded-2xl border border-border/60 bg-chat-user-surface px-3.5 py-2 text-sm leading-relaxed text-chat-foreground-strong shadow-xs',
            effectiveUserDir === 'rtl' ? 'text-right' : 'text-left'
          )}
        >
          <IdeChatMarkdown
            content={message.text}
            directionOverride={directionOverride}
            className="orca-ide-user-bubble-markdown text-sm leading-relaxed text-chat-foreground-strong"
          />
        </div>
        <div className="flex select-none items-center gap-1 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void handleCopy(message.text)}
            aria-label={copied ? copy.copied : copy.copyMessage}
            title={copied ? copy.copied : copy.copyMessage}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
          <MarkdownDirectionToggle
            value={directionOverride}
            onChange={setDirectionOverride}
            compact
          />
          <span className="tabular-nums text-3xs text-muted-foreground/75">{timeLabel}</span>
        </div>
      </div>
    )
  }

  if (message.role === 'system') {
    return (
      <div
        data-testid="ide-chat-message-system"
        dir="ltr"
        className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1.5 text-left text-2xs leading-relaxed text-muted-foreground"
      >
        {message.text}
      </div>
    )
  }

  const displayContent = resolveDisplayContent(message, linkedPlan)

  if (
    isLatestMessage &&
    message.streaming &&
    displayContent.trim().length === 0 &&
    !message.error
  ) {
    return null
  }

  const isProposalForPlan =
    Boolean(linkedPlan) &&
    !message.modifiedFiles &&
    !message.commandIds?.length &&
    linkedPlan?.approvalRecord?.note !== 'auto_approved_small_change' &&
    conversation.messages.find((m) => m.planId === linkedPlan?.id)?.id === message.id

  const modelLabel = resolveDisplayModelLabel(providers, message.agentId, message.modelId)
  const runActivity =
    !isProposalForPlan && message.runId
      ? conversation.activity.filter(
          (ev) =>
            ev.runId === message.runId &&
            ev.type !== 'editor.edit_chunk' &&
            ev.type !== 'analysis.started' &&
            ev.type !== 'analysis.completed'
        )
      : []

  const canRetryTurn =
    isLatestMessage &&
    !message.streaming &&
    (conversation.status === 'failed' || conversation.status === 'canceled')

  const handleRetry = () => {
    clearError()
    void controlRun({
      conversationId: conversation.id,
      ...(conversation.activeRunId ? { runId: conversation.activeRunId } : {}),
      action: 'retry'
    })
  }

  return (
    <div
      data-testid={`ide-chat-message-${message.role}`}
      className={cn(
        'group space-y-2 px-0.5',
        !isLatestMessage &&
          !message.streaming &&
          '[content-visibility:auto] [contain-intrinsic-size:auto_180px]'
      )}
    >
      <div dir="ltr" className="flex items-center gap-1.5 text-left text-2xs text-muted-foreground">
        <AppIcon name="sparkles" className="size-3 text-foreground/80" />
        <span className="font-medium text-foreground">Carver</span>
        <span className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0 text-3xs text-muted-foreground">
          {getIdeModeLabel(message.mode)}
        </span>
        {modelLabel ? (
          <span className="truncate text-2xs text-muted-foreground/75">{modelLabel}</span>
        ) : null}
        {message.streaming ? <LoadingSpinner className="size-3 text-muted-foreground" /> : null}

        <div className="ml-auto flex items-center gap-1">
          {displayContent && !message.streaming ? (
            <>
              <MarkdownDirectionToggle
                value={directionOverride}
                onChange={setDirectionOverride}
                compact
              />
              <button
                type="button"
                onClick={() => void handleCopy(displayContent)}
                aria-label={copied ? copy.copied : copy.copyMessage}
                title={copied ? copy.copied : copy.copyMessage}
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100',
                  copied ? 'text-foreground opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </button>
            </>
          ) : null}
          <span className="tabular-nums text-2xs text-muted-foreground/70">{timeLabel}</span>
        </div>
      </div>

      {runActivity.length > 0 ? (
        <div dir="ltr" className="text-left">
          <button
            type="button"
            onClick={() => setShowActivity((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {showActivity ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
            <span>
              Explored {runActivity.length} {runActivity.length === 1 ? 'action' : 'actions'}
            </span>
          </button>
          {showActivity ? (
            <div className="mt-1 rounded-lg border border-border/60 bg-muted/15 p-2">
              <IdeToolActivityTimeline
                events={runActivity}
                scratchWorkspace={scratchWorkspace}
                compact
              />
            </div>
          ) : null}
        </div>
      ) : null}

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
          directionOverride={directionOverride}
          className="rounded-lg pr-1"
        />
      ) : message.streaming ? (
        <div
          dir="ltr"
          className="inline-flex items-center gap-1.5 text-left text-xs text-muted-foreground"
        >
          <LoadingSpinner className="size-3.5 shrink-0" />
          <span className="shimmer shimmer-duration-2000 font-medium">{copy.thinking}</span>
        </div>
      ) : null}

      {!isProposalForPlan ? (
        <IdeChatTurnChangesCard
          conversation={conversation}
          runId={message.runId}
          modifiedFiles={message.modifiedFiles}
          scratchWorkspace={scratchWorkspace}
        />
      ) : null}

      <IdeChatMessageCommandList commands={linkedCommands} />

      {linkedPlan && isProposalForPlan ? (
        <SecuritySurface>
          <IdePlanProposalCard
            plan={linkedPlan}
            conversationId={message.conversationId}
            agentId={conversation.agentId || providers[0]?.id || 'codex'}
            modelId={conversation.modelId || providers[0]?.defaultModelId || ''}
            providers={providers}
            compact
          />
        </SecuritySurface>
      ) : null}

      {message.error ? (
        <IdeAlertCard
          error={message.error}
          conversation={conversation}
          providers={providers}
          providersLoading={providersLoading}
          onRetry={canRetryTurn ? handleRetry : undefined}
          onRefreshModels={() => void refreshProviders(worktreeSelector ?? undefined)}
          onSelectFallbackModel={({ agentId, modelId }) => {
            clearError()
            void updateSettings({
              conversationId: conversation.id,
              agentId,
              modelId
            })
          }}
        />
      ) : null}
    </div>
  )
}, areIdeChatMessagePropsEqual)
