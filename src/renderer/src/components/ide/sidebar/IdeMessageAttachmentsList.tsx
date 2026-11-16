import { useState } from 'react'
import { AlertCircle, FileText } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { cn } from '@/lib/class-names'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import { IdePastedAttachmentPreviewDialog } from './IdePastedAttachmentPreviewDialog'
import {
  resolveIdeAttachmentDisplayName,
  resolveIdeAttachmentSubtitle
} from './ide-attachment-display'

export function IdeMessageAttachmentsList({
  conversationId,
  attachments,
  align,
  sensitiveFileLabel
}: {
  conversationId: string
  attachments: readonly IdeChatAttachment[]
  align: 'start' | 'end'
  sensitiveFileLabel: string
}) {
  const [previewAttachment, setPreviewAttachment] = useState<IdeChatAttachment | null>(null)
  if (attachments.length === 0) {
    return null
  }
  const previewTitle = previewAttachment
    ? resolveIdeAttachmentDisplayName(previewAttachment, attachments)
    : undefined

  return (
    <>
      <div
        className={cn('flex flex-wrap gap-1.5', align === 'end' ? 'justify-end' : 'justify-start')}
      >
        {attachments.map((att) => {
          const displayName = resolveIdeAttachmentDisplayName(att, attachments)
          const subtitle = resolveIdeAttachmentSubtitle(att)
          if (att.kind === 'pasted_text') {
            const missing = att.status === 'missing'
            return (
              <button
                key={att.id}
                type="button"
                data-testid="ide-pasted-attachment-card"
                onClick={() => setPreviewAttachment(att)}
                className={cn(
                  'inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70',
                  missing
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-border/70 bg-background/80'
                )}
              >
                {missing ? (
                  <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {displayName}
                  </span>
                  <span
                    className={cn(
                      'block truncate text-[11px]',
                      missing ? 'text-amber-500' : 'text-muted-foreground'
                    )}
                  >
                    {subtitle}
                  </span>
                </span>
              </button>
            )
          }
          return (
            <div
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/70 px-2 py-1 text-2xs"
            >
              {att.kind === 'image' && att.dataUrl ? (
                <img src={att.dataUrl} alt={displayName} className="size-4 rounded object-cover" />
              ) : (
                <AppIcon name="attachFile" className="size-3 text-muted-foreground" />
              )}
              <span dir="ltr" className="max-w-[160px] truncate font-mono text-2xs">
                {displayName}
              </span>
              {att.sensitiveWarning ? (
                <AppIcon
                  name="warning"
                  className="size-3 text-amber-500"
                  label={sensitiveFileLabel}
                />
              ) : null}
            </div>
          )
        })}
      </div>
      <IdePastedAttachmentPreviewDialog
        conversationId={conversationId}
        attachment={previewAttachment}
        displayName={previewTitle}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  )
}
