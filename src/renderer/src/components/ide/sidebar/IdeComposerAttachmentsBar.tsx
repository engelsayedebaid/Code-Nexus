import { useState } from 'react'
import {
  AlertCircle,
  Braces,
  FileCode2,
  FileText,
  Folder,
  Loader2,
  Plus,
  TextSelect,
  X
} from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { getIntlLocale } from '@/i18n/i18n'
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

export type ActiveEditorContextHint = {
  label: string
  relativePath: string
  selectionRange?: { start: number; end: number }
}

export function IdeComposerAttachmentsBar({
  conversationId,
  attachments,
  activeEditorHint = null,
  onPinActiveEditorHint,
  contextBudget,
  savingPasteCount = 0,
  pasteNotice = null,
  onDismissPasteNotice,
  getFallbackPreviewText,
  onRemove
}: {
  conversationId: string
  attachments: IdeChatAttachment[]
  activeEditorHint?: ActiveEditorContextHint | null
  onPinActiveEditorHint?: () => void
  contextBudget?: IdeContextBudgetSummary
  savingPasteCount?: number
  pasteNotice?: string | null
  onDismissPasteNotice?: () => void
  getFallbackPreviewText?: (attachmentId: string) => string | undefined
  onRemove: (conversationId: string, attachmentId: string) => void
}) {
  const [previewAttachment, setPreviewAttachment] = useState<IdeChatAttachment | null>(null)
  const usageRatio =
    contextBudget && contextBudget.budgetTokens > 0
      ? contextBudget.estimatedTokens / contextBudget.budgetTokens
      : 0
  const showHighUsageIndicator = usageRatio >= 0.65
  const hasTopPills =
    Boolean(activeEditorHint) ||
    attachments.length > 0 ||
    savingPasteCount > 0 ||
    showHighUsageIndicator

  if (!hasTopPills && !pasteNotice) {
    return null
  }

  const previewTitle = previewAttachment
    ? resolveIdeAttachmentDisplayName(previewAttachment, attachments)
    : undefined

  return (
    <div className="space-y-1.5 px-2.5 pt-2">
      {hasTopPills ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeEditorHint ? (
            <button
              type="button"
              onClick={onPinActiveEditorHint}
              title={`Include ${activeEditorHint.relativePath} in context`}
              className="group/ctx inline-flex h-5 max-w-[200px] items-center gap-1 rounded-md border border-dashed border-border/80 bg-muted/25 px-1.5 text-2xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground"
            >
              {activeEditorHint.selectionRange ? (
                <TextSelect className="size-3 shrink-0" />
              ) : (
                <FileCode2 className="size-3 shrink-0" />
              )}
              <span dir="ltr" className="truncate font-mono">
                {activeEditorHint.label}
              </span>
              {activeEditorHint.selectionRange ? (
                <span className="shrink-0 font-mono text-3xs text-muted-foreground/80">
                  L{activeEditorHint.selectionRange.start}
                  {activeEditorHint.selectionRange.end > activeEditorHint.selectionRange.start
                    ? `-${activeEditorHint.selectionRange.end}`
                    : ''}
                </span>
              ) : null}
              <Plus className="size-2.5 shrink-0 opacity-60 group-hover/ctx:opacity-100" />
            </button>
          ) : null}

          {attachments.map((att) => {
            const displayName = resolveIdeAttachmentDisplayName(att, attachments)
            const subtitle = resolveIdeAttachmentSubtitle(att)
            if (att.kind === 'pasted_text') {
              return (
                <div
                  key={att.id}
                  data-testid="ide-composer-pasted-card"
                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border/80 bg-background/80 pr-1 text-start transition-colors hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewAttachment(att)}
                    className="inline-flex min-w-0 items-center gap-2 px-2 py-1 text-start"
                    aria-label={`Preview ${displayName}`}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {displayName}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">
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
                  'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-2xs',
                  att.sensitiveWarning
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-border bg-muted/45 text-foreground'
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
            <span className="inline-flex h-5 items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 text-2xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              <span>Preparing pasted text…</span>
            </span>
          ) : null}

          {showHighUsageIndicator && contextBudget ? (
            <span
              className="ms-auto shrink-0 font-mono text-3xs tabular-nums text-muted-foreground"
              title={`Context usage: ~${contextBudget.estimatedTokens.toLocaleString(getIntlLocale())} / ${contextBudget.budgetTokens.toLocaleString(getIntlLocale())} tokens`}
            >
              {Math.min(100, Math.round(usageRatio * 100))}% ctx
            </span>
          ) : null}
        </div>
      ) : null}

      {pasteNotice ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-2.5 py-1.5 text-2xs text-foreground"
        >
          <span className="flex min-w-0 items-start gap-1.5 leading-relaxed">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 break-words">{pasteNotice}</span>
          </span>
          {onDismissPasteNotice ? (
            <button
              type="button"
              onClick={onDismissPasteNotice}
              aria-label="Dismiss paste error"
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
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
