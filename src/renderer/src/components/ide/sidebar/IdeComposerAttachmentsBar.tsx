import { useState } from 'react'
import { AlertCircle, Braces, FileText, Folder, Loader2, TextSelect, X } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { cn } from '@/lib/class-names'
import type { IdeContextBudgetSummary } from '../../../../../shared/ide-agent/ide-agent-events'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import { IdePastedAttachmentPreviewDialog } from './IdePastedAttachmentPreviewDialog'
import {
  resolveIdeAttachmentDisplayName,
  resolveIdeAttachmentSubtitle
} from './ide-attachment-display'

function AttachmentKindIcon({ kind }: { kind: IdeChatAttachment['kind'] }) {
  switch (kind) {
    case 'folder':
      return <Folder className="size-3 shrink-0 text-muted-foreground" />
    case 'symbol':
      return <Braces className="size-3 shrink-0 text-muted-foreground" />
    case 'selection':
      return <TextSelect className="size-3 shrink-0 text-muted-foreground" />
    default:
      return <FileText className="size-3 shrink-0 text-muted-foreground" />
  }
}

export function IdeComposerAttachmentsBar({
  conversationId,
  attachments,
  contextBudget,
  savingPasteCount = 0,
  pasteNotice = null,
  onDismissPasteNotice,
  getFallbackPreviewText,
  onRemove
}: {
  conversationId: string
  attachments: IdeChatAttachment[]
  contextBudget?: IdeContextBudgetSummary
  savingPasteCount?: number
  pasteNotice?: string | null
  onDismissPasteNotice?: () => void
  getFallbackPreviewText?: (attachmentId: string) => string | undefined
  onRemove: (conversationId: string, attachmentId: string) => void
}) {
  const [previewAttachment, setPreviewAttachment] = useState<IdeChatAttachment | null>(null)
  const showBudget =
    Boolean(contextBudget) &&
    ((contextBudget?.estimatedTokens ?? 0) > 0 || (contextBudget?.stackLabels?.length ?? 0) > 0)

  if (attachments.length === 0 && !showBudget && savingPasteCount === 0 && !pasteNotice) {
    return null
  }

  const previewTitle = previewAttachment
    ? resolveIdeAttachmentDisplayName(previewAttachment, attachments)
    : undefined

  return (
    <div className="space-y-1.5 px-3 pt-2.5">
      {attachments.length > 0 || savingPasteCount > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => {
            const displayName = resolveIdeAttachmentDisplayName(att, attachments)
            const subtitle = resolveIdeAttachmentSubtitle(att)
            if (att.kind === 'pasted_text') {
              return (
                <div
                  key={att.id}
                  data-testid="ide-composer-pasted-card"
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border/80 bg-background/80 pr-1 text-left transition-colors hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewAttachment(att)}
                    className="inline-flex min-w-0 items-center gap-2 px-2 py-1 text-left"
                    aria-label={`Preview ${displayName}`}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {displayName}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {subtitle}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${displayName}`}
                    onClick={() => onRemove(conversationId, att.id)}
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            }
            return (
              <span
                key={att.id}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-3xs',
                  att.sensitiveWarning
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                    : 'border-border bg-muted/40 text-foreground'
                )}
              >
                {att.kind === 'image' && att.dataUrl ? (
                  <img src={att.dataUrl} alt={att.name} className="size-3.5 rounded object-cover" />
                ) : (
                  <AttachmentKindIcon kind={att.kind} />
                )}
                <span dir="ltr" className="max-w-[140px] truncate font-mono">
                  {displayName}
                </span>
                {att.lineRange ? (
                  <span className="shrink-0 font-mono text-3xs text-muted-foreground">
                    L{att.lineRange.start}
                    {att.lineRange.end > att.lineRange.start ? `-${att.lineRange.end}` : ''}
                  </span>
                ) : null}
                {att.sensitiveWarning ? <AppIcon name="warning" className="size-3" /> : null}
                <button
                  type="button"
                  aria-label={`Remove ${displayName}`}
                  onClick={() => onRemove(conversationId, att.id)}
                  className="hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </span>
            )
          })}
          {savingPasteCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-2 py-1 text-2xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>Preparing pasted text…</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {pasteNotice ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-2xs text-destructive"
        >
          <span className="flex items-center gap-1.5">
            <AlertCircle className="size-3.5 shrink-0" />
            <span>{pasteNotice}</span>
          </span>
          {onDismissPasteNotice ? (
            <button
              type="button"
              onClick={onDismissPasteNotice}
              aria-label="Dismiss paste error"
              className="shrink-0 hover:opacity-80"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      {showBudget && contextBudget ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-3xs text-muted-foreground">
          <span className="truncate font-mono">
            {contextBudget.stackLabels && contextBudget.stackLabels.length > 0
              ? contextBudget.stackLabels.slice(0, 3).join(' · ')
              : 'Workspace context'}
          </span>
          <span className="shrink-0 font-mono">
            {contextBudget.isEstimate ? '~' : ''}
            {contextBudget.estimatedTokens.toLocaleString()} /{' '}
            {Math.max(1, Math.round(contextBudget.budgetTokens / 1000))}k tok
            {contextBudget.isEstimate ? ' est.' : ''}
            {contextBudget.deduplicatedReads > 0
              ? ` · ${contextBudget.deduplicatedReads} cached`
              : ''}
          </span>
        </div>
      ) : null}

      <IdePastedAttachmentPreviewDialog
        conversationId={conversationId}
        attachment={previewAttachment}
        displayName={previewTitle}
        fallbackText={
          previewAttachment && getFallbackPreviewText
            ? getFallbackPreviewText(previewAttachment.id)
            : undefined
        }
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  )
}
