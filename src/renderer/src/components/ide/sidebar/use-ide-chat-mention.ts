import { useRef, useState } from 'react'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'

type MentionState = { start: number; end: number; query: string }

function detectMention(value: string, cursor: number): MentionState | null {
  const at = value.lastIndexOf('@', Math.max(0, cursor - 1))
  if (at === -1) {
    return null
  }
  const query = value.slice(at + 1, cursor)
  if (/\s/.test(query)) {
    return null
  }
  if (at > 0 && !/[\s([{"']/.test(value[at - 1])) {
    return null
  }
  return { start: at, end: cursor, query }
}

export function useIdeChatMention(params: {
  conversation: IdeConversation | null
  draft: string
  setDraft: (conversationId: string, text: string) => void
  addAttachment: (conversationId: string, attachment: IdeChatAttachment) => void
}) {
  const { conversation, draft, setDraft, addAttachment } = params
  const [mention, setMention] = useState<MentionState | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const refreshMention = () => {
    const el = textareaRef.current
    if (!el || !conversation) {
      setMention(null)
      return
    }
    setMention(detectMention(el.value, el.selectionStart ?? el.value.length))
  }

  const onDraftChange = (value: string, cursor: number) => {
    if (!conversation) {
      return
    }
    setDraft(conversation.id, value)
    setMention(detectMention(value, cursor))
  }

  const handleMentionAttach = (attachment: IdeChatAttachment) => {
    if (!conversation) {
      return
    }
    const rel = attachment.relativePath ?? attachment.name
    if (mention) {
      const next = `${draft.slice(0, mention.start)}@${rel} ${draft.slice(mention.end)}`
      setDraft(conversation.id, next)
      const caret = mention.start + rel.length + 2
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(caret, caret)
        }
      })
      setMention(null)
    }
    addAttachment(conversation.id, attachment)
  }

  const closeMention = () => setMention(null)

  return {
    mention,
    textareaRef,
    refreshMention,
    onDraftChange,
    handleMentionAttach,
    closeMention,
    setMention
  }
}
