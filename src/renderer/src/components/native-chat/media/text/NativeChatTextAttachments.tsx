import { useTranslate } from '@/i18n/use-translate'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import { createContext, useCallback, useContext, useState, useMemo, type ReactNode } from 'react'
import { AlertCircle, FileText } from 'lucide-react'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { formatSmartAttachmentSize } from '../../../../../../shared/smart-paste/smart-paste-config'
import {
  extractNativeChatVisibleAttachments,
  type NativeChatVisibleAttachmentRef
} from '../../../../../../shared/smart-paste/native-chat-attachment-metadata'
import { NativeChatTextAttachmentPreview } from './NativeChatTextAttachmentPreview'
import { NativeChatMarkdownImageOwnerContext } from '../images/native-chat-markdown-image-owner'
import { useNativeChatTextAttachmentStat } from './native-chat-text-attachment-stat'

export const NativeChatTextAttachmentOpener = createContext<
  ((path: string, text?: string) => void) | null
>(null)

export function NativeChatTextAttachmentScope({
  enabled,
  children
}: {
  enabled: boolean
  children: ReactNode
}) {
  return enabled ? (
    <StructuredAttachmentScope>{children}</StructuredAttachmentScope>
  ) : (
    <>{children}</>
  )
}

function StructuredAttachmentScope({ children }: { children: ReactNode }) {
  const imageOwner = useContext(NativeChatMarkdownImageOwnerContext)
  const context = imageOwner?.runtimeContext ?? null
  const visible = imageOwner?.isVisible ?? true
  const owner = JSON.stringify(context)
  const [selection, setSelection] = useState<{
    owner: string
    path: string
    text?: string
  } | null>(null)
  // Only the preview retires when its chat hides or changes owner; the editor stays mounted.
  if (selection && (selection.owner !== owner || !visible)) {
    setSelection(null)
  }
  const selected = visible && selection?.owner === owner ? selection : null
  const open = useCallback(
    (path: string, text?: string) => {
      if (visible) {
        setSelection({ owner, path, text })
      }
    },
    [owner, visible]
  )
  return (
    <NativeChatTextAttachmentOpener.Provider value={open}>
      {children}
      {selected ? (
        <NativeChatTextAttachmentPreview
          key={JSON.stringify([selected.path, context])}
          {...selected}
          target={context?.target ?? null}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </NativeChatTextAttachmentOpener.Provider>
  )
}

function AttachmentButton({
  attachment,
  runtimeContext
}: {
  attachment: NativeChatVisibleAttachmentRef
  runtimeContext?: RuntimeFileOperationArgs | null
}) {
  const t = useTranslate()
  useUiLanguageRevision()
  const [open, setOpen] = useState(false)
  const opener = useContext(NativeChatTextAttachmentOpener)
  const imageOwner = useContext(NativeChatMarkdownImageOwnerContext)
  const visible = imageOwner?.isVisible ?? true
  const target = runtimeContext?.target ?? imageOwner?.runtimeContext?.target ?? null
  const stat = useNativeChatTextAttachmentStat(
    attachment.path,
    target,
    visible && attachment.isPastedText
  )
  if (open && !visible) {
    setOpen(false)
  }
  const missing = stat.status === 'missing'
  const subtitle = missing
    ? t('components.native-chat.composer.unavailableAttachmentLabel', 'Unavailable attachment')
    : stat.sizeBytes !== null
      ? t('components.native-chat.composer.textAttachmentMeta', 'Text attachment · {{size}}', {
          size: formatSmartAttachmentSize(stat.sizeBytes)
        })
      : attachment.isPastedText
        ? t('components.native-chat.composer.textAttachmentLabel', 'Text attachment')
        : t('components.native-chat.composer.fileAttachmentLabel', 'Attachment')
  const Icon = missing ? AlertCircle : FileText
  return (
    <>
      <button
        type="button"
        data-native-chat-text-attachment=""
        onClick={() => visible && (opener ? opener(attachment.path) : setOpen(true))}
        aria-label={`${attachment.displayName} — ${subtitle}`}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Icon
          className={
            missing ? 'size-3.5 shrink-0 text-amber-500' : 'size-3.5 shrink-0 text-muted-foreground'
          }
          aria-hidden="true"
        />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-xs font-medium text-foreground">
            {attachment.displayName}
          </span>
          <span
            className={
              missing
                ? 'block truncate text-[11px] text-amber-500'
                : 'block truncate text-[11px] text-muted-foreground'
            }
          >
            {subtitle}
          </span>
        </span>
      </button>
      {open && visible ? (
        <NativeChatTextAttachmentPreview
          path={attachment.path}
          target={target}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

export function NativeChatTextAttachments({
  content,
  structured,
  runtimeContext,
  renderText
}: {
  content: string
  structured: boolean
  runtimeContext?: RuntimeFileOperationArgs | null
  renderText: (text: string) => ReactNode
}) {
  const t = useTranslate()
  useUiLanguageRevision()
  const pastedLabel = t('components.native-chat.composer.pastedTextLabel', 'Pasted text')
  const { visibleText, attachments } = useMemo(
    () => extractNativeChatVisibleAttachments(content, structured, pastedLabel),
    [content, structured, pastedLabel]
  )
  return (
    <>
      {visibleText ? renderText(visibleText) : null}
      {attachments.length > 0 ? (
        <div className={visibleText ? 'mt-2 flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5'}>
          {attachments.map((attachment) => (
            <AttachmentButton
              key={JSON.stringify([attachment.path, runtimeContext])}
              attachment={attachment}
              runtimeContext={runtimeContext}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
