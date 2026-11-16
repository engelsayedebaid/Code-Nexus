import { useContext, useEffect, useState } from 'react'
import { NativeChatTextAttachmentOpener } from '../../media/text/NativeChatTextAttachments'
import { isCommittedChatAttachmentCandidate } from '../../../../../../shared/native-chat-text-attachment-references'
import {
  useNativeChatPastedTextScope,
  useNativeChatPastedTextState
} from './native-chat-pasted-text-state'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { FileX, Hourglass, X } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { basename } from '@/lib/path'
import { getFileTypeIcon } from '@/lib/file-icons/file-type-icons'
import { NativeChatPromptPill } from './NativeChatPromptPill'
import { isNativeChatPastedTextPath } from '../../../../../../shared/native-chat/native-chat-image-label'
import { isInternalAttachmentDisplayCandidate } from '../../../../../../shared/smart-paste/native-chat-attachment-metadata'
import {
  formatSmartAttachmentSize,
  measureTextUtf8Bytes
} from '../../../../../../shared/smart-paste/smart-paste-config'
import { NativeChatMarkdownImageOwnerContext } from '../../media/images/native-chat-markdown-image-owner'
import { useNativeChatTextAttachmentStat } from '../../media/text/native-chat-text-attachment-stat'
import {
  nativeChatPastedTextOperations,
  nativeChatPasteNotSavedNotice,
  nativeChatPastedTextId,
  nativeChatPastedTextLabel
} from '../../paste/native-chat-pasted-text-reference'

function isPastedReferenceAttrs(attrs: Record<string, unknown> | undefined): boolean {
  const token = String(attrs?.token ?? '')
  const rawPath = String(attrs?.path ?? '')
  return Boolean(
    nativeChatPastedTextId(token) ||
    isNativeChatPastedTextPath(rawPath) ||
    isInternalAttachmentDisplayCandidate(rawPath)
  )
}

function readPastedNodePosition(
  editor: NodeViewProps['editor'] | undefined,
  nodeTypeName: string,
  currentPos: number | null
): { index: number; total: number } {
  if (!editor || currentPos === null) {
    return { index: 1, total: 1 }
  }
  let index = 1
  let total = 0
  editor.state.doc.descendants((child, pos) => {
    if (child.type.name === nodeTypeName && isPastedReferenceAttrs(child.attrs)) {
      total += 1
      if (pos === currentPos) {
        index = total
      }
    }
  })
  return total > 0 ? { index, total } : { index: 1, total: 1 }
}

export function NativeChatFileReferencePill({
  node,
  selected,
  editor,
  getPos,
  deleteNode
}: NodeViewProps): React.JSX.Element {
  const t = useTranslate()
  const state = useNativeChatPastedTextState(String(node.attrs.token))
  const path = state && state !== 'saving' && state !== 'unsaved' ? state : String(node.attrs.path)
  const pasteId = nativeChatPastedTextId(String(node.attrs.token))
  // A paste's pill with no saving behind it was lost to a restart: its text was only in memory.
  const open = useContext(NativeChatTextAttachmentOpener)
  const imageOwner = useContext(NativeChatMarkdownImageOwnerContext)
  const scope = useNativeChatPastedTextScope()
  const live = pasteId ? nativeChatPastedTextOperations.get(pasteId) : undefined
  const isPasted = Boolean(
    pasteId || isNativeChatPastedTextPath(path) || isInternalAttachmentDisplayCandidate(path)
  )
  const canOpen = open && (live?.scopeKey === scope || isCommittedChatAttachmentCandidate(path))
  const unsaved = state === 'unsaved'
  const stat = useNativeChatTextAttachmentStat(
    path,
    imageOwner?.runtimeContext?.target ?? null,
    isPasted && live?.scopeKey !== scope && isInternalAttachmentDisplayCandidate(path)
  )
  const [pastedOrder, setPastedOrder] = useState<{ index: number; total: number }>(() =>
    isPasted
      ? readPastedNodePosition(
          editor,
          node.type.name,
          typeof getPos === 'function' ? (getPos() ?? null) : null
        )
      : { index: 1, total: 1 }
  )
  useEffect(() => {
    if (!isPasted || !editor) {
      return
    }
    const updateOrder = (): void => {
      const pos = typeof getPos === 'function' ? (getPos() ?? null) : null
      setPastedOrder(readPastedNodePosition(editor, node.type.name, pos))
    }
    updateOrder()
    editor.on('update', updateOrder)
    return () => {
      editor.off('update', updateOrder)
    }
  }, [editor, getPos, isPasted, node.type.name])

  const liveBytes =
    live?.scopeKey === scope && typeof live.text === 'string'
      ? measureTextUtf8Bytes(live.text)
      : null
  const sizeBytes = liveBytes ?? stat.sizeBytes
  const basePasteLabel = nativeChatPastedTextLabel(t)
  const numberedPasteLabel =
    pastedOrder.total > 1 ? `${basePasteLabel} ${pastedOrder.index}` : basePasteLabel
  const sizeLabel = sizeBytes !== null ? formatSmartAttachmentSize(sizeBytes) : null
  const pillLabel = unsaved
    ? t('components.native-chat.composer.pasteNotSavedLabel', 'Paste not saved')
    : isPasted
      ? sizeLabel
        ? `${numberedPasteLabel} · ${sizeLabel}`
        : numberedPasteLabel
      : basename(path)
  const pillTitle = unsaved
    ? nativeChatPasteNotSavedNotice(t)
    : isPasted
      ? pillLabel
      : path || undefined

  const pill = (
    <NativeChatPromptPill
      icon={unsaved ? FileX : state === 'saving' ? Hourglass : getFileTypeIcon(path)}
      label={pillLabel}
      selected={selected}
      title={pillTitle}
      data-native-chat-file-reference={path}
    />
  )
  return (
    <NodeViewWrapper
      as="span"
      className="inline-flex items-center gap-0.5 align-middle"
      contentEditable={false}
    >
      {canOpen ? (
        <button
          type="button"
          className="inline max-w-full cursor-pointer text-left"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open(path, live?.scopeKey === scope ? live.text : undefined)}
        >
          {pill}
        </button>
      ) : (
        pill
      )}
      {isPasted && typeof deleteNode === 'function' ? (
        <button
          type="button"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t('components.native-chat.composer.removePastedText', 'Remove pasted text')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => deleteNode()}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </NodeViewWrapper>
  )
}
