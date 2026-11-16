import { useCallback, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  SMART_PASTE_CONFIG,
  classifySmartPaste,
  formatSmartAttachmentSize
} from '../../../../../shared/smart-paste/smart-paste-config'

function makeAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useIdeSmartPaste({
  conversationId,
  addAttachment
}: {
  conversationId: string | null
  addAttachment: (conversationId: string, attachment: IdeChatAttachment) => void
}) {
  const [savingPasteCount, setSavingPasteCount] = useState(0)
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const fallbackPreviewMap = useRef(new Map<string, string>())

  const readImageFileAsAttachment = useCallback(
    (file: File) => {
      if (!conversationId || !file.type.startsWith('image/')) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addAttachment(conversationId, {
            id: makeAttachmentId('img'),
            kind: 'image',
            name: file.name || 'pasted-image.png',
            mimeType: file.type,
            dataUrl: reader.result
          })
        }
      }
      reader.readAsDataURL(file)
    },
    [addAttachment, conversationId]
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!conversationId) {
        return
      }
      const items = Array.from(event.clipboardData?.items ?? [])
      let handledImage = false
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            readImageFileAsAttachment(file)
            handledImage = true
          }
        }
      }
      const pastedText = event.clipboardData?.getData('text/plain') ?? ''
      if (!pastedText) {
        if (handledImage) {
          event.preventDefault()
        }
        return
      }
      const classification = classifySmartPaste(pastedText)
      if (classification.kind === 'short') {
        setPasteNotice(null)
        return
      }
      event.preventDefault()
      if (classification.kind === 'too_large') {
        setPasteNotice(
          `Pasted content exceeds the ${formatSmartAttachmentSize(SMART_PASTE_CONFIG.maxAttachmentBytes)} attachment limit.`
        )
        return
      }
      setPasteNotice(null)
      const clientId = makeAttachmentId('paste')
      fallbackPreviewMap.current.set(clientId, pastedText)
      setSavingPasteCount((count) => count + 1)
      void callRuntimeRpc<{ attachment: IdeChatAttachment }>(
        { kind: 'local' },
        'ideAgent.savePastedAttachment',
        {
          conversationId,
          attachmentId: clientId,
          displayName: 'Pasted text',
          content: pastedText
        },
        { timeoutMs: 12_000, skipCompatibilityCheck: true }
      )
        .then((reply) => {
          if (reply?.attachment) {
            addAttachment(conversationId, reply.attachment)
          } else {
            setPasteNotice('Unable to save pasted attachment.')
          }
        })
        .catch((error) => {
          fallbackPreviewMap.current.delete(clientId)
          setPasteNotice(
            error instanceof Error ? error.message : 'Unable to save pasted attachment.'
          )
        })
        .finally(() => {
          setSavingPasteCount((count) => Math.max(0, count - 1))
        })
    },
    [addAttachment, conversationId, readImageFileAsAttachment]
  )

  const getFallbackPreviewText = useCallback(
    (attachmentId: string): string | undefined => fallbackPreviewMap.current.get(attachmentId),
    []
  )

  return {
    savingPasteCount,
    pasteNotice,
    clearPasteNotice: () => setPasteNotice(null),
    readImageFileAsAttachment,
    handlePaste,
    getFallbackPreviewText
  }
}
