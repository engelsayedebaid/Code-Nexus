import { ArrowUp, Clock, Paperclip, Pencil, Play, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import {
  useIdePromptQueueStore,
  type IdeQueuedPromptItem
} from '@/store/ide-agent/ide-prompt-queue'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'
import { getIdeModeLabel } from './ide-chat-copy'

const EMPTY_QUEUE: readonly IdeQueuedPromptItem[] = []

export function IdeQueuedMessagesBar({
  conversation,
  isRunning,
  onFocusComposer
}: {
  conversation: IdeConversation
  isRunning: boolean
  onFocusComposer?: () => void
}): React.JSX.Element | null {
  const items = useIdePromptQueueStore((s) => s.byConversation[conversation.id] ?? EMPTY_QUEUE)
  const remove = useIdePromptQueueStore((s) => s.remove)
  const moveUp = useIdePromptQueueStore((s) => s.moveUp)
  const clear = useIdePromptQueueStore((s) => s.clear)

  const setDraft = useIdeAgentStore((s) => s.setDraft)
  const clearAttachments = useIdeAgentStore((s) => s.clearAttachments)
  const addAttachment = useIdeAgentStore((s) => s.addAttachment)
  const sendPrompt = useIdeAgentStore((s) => s.sendPrompt)
  const controlRun = useIdeAgentStore((s) => s.controlRun)

  if (items.length === 0) {
    return null
  }

  const handleEdit = (item: IdeQueuedPromptItem): void => {
    const popped = remove(conversation.id, item.id)
    if (!popped) {
      return
    }
    setDraft(conversation.id, popped.text)
    clearAttachments(conversation.id)
    for (const att of popped.attachments) {
      addAttachment(conversation.id, att)
    }
    onFocusComposer?.()
  }

  const handleSendNow = async (item: IdeQueuedPromptItem): Promise<void> => {
    const popped = remove(conversation.id, item.id)
    if (!popped) {
      return
    }
    if (isRunning && conversation.activeRunId) {
      await controlRun({
        conversationId: conversation.id,
        runId: conversation.activeRunId,
        action: 'stop'
      })
    }
    await sendPrompt({
      conversationId: popped.conversationId,
      worktreeSelector: popped.worktreeSelector,
      text: popped.text,
      mode: popped.mode,
      agentId: popped.agentId,
      modelId: popped.modelId,
      multiAgentEnabled: popped.multiAgentEnabled,
      followAgent: popped.followAgent,
      fromQueue: { attachments: popped.attachments }
    })
  }

  return (
    <div
      dir="ltr"
      data-testid="ide-queued-messages-bar"
      className="border-t border-border/70 bg-muted/25 px-2.5 pt-2 text-left"
    >
      <div className="mx-auto w-full max-w-2xl rounded-xl border border-border/70 bg-card/85 p-2 shadow-xs">
        <div className="flex items-center justify-between gap-2 pb-1.5 text-2xs">
          <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3 shrink-0 text-foreground/80" />
            <span className="font-medium text-foreground">Queued ({items.length})</span>
            <span className="truncate text-3xs">
              {isRunning ? '· Auto-sends after current turn' : '· Ready to send'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!isRunning && items[0] ? (
              <Button size="xs" onClick={() => void handleSendNow(items[0])}>
                <Play className="size-2.5" />
                <span>Send Next</span>
              </Button>
            ) : null}
            {items.length > 1 ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => clear(conversation.id)}
                title="Clear all queued messages"
              >
                <Trash2 className="size-2.5" />
                <span>Clear</span>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="scrollbar-sleek max-h-36 space-y-1 overflow-y-auto">
          {items.map((item, idx) => (
            <div
              key={item.id}
              data-testid="ide-queued-message-item"
              className="group flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/80 px-2 py-1 text-xs"
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="shrink-0 font-mono text-3xs font-medium tabular-nums text-muted-foreground">
                  #{idx + 1}
                </span>
                <Badge variant="referenceLabel">{getIdeModeLabel(item.mode)}</Badge>
                {item.attachments.length > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-3xs text-muted-foreground">
                    <Paperclip className="size-2.5" />
                    {item.attachments.length}
                  </span>
                ) : null}
                <span dir="auto" className="min-w-0 flex-1 truncate text-2xs text-foreground">
                  {item.text}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {idx > 0 ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => moveUp(conversation.id, item.id)}
                    aria-label="Move up in queue"
                    title="Move up"
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                ) : null}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleEdit(item)}
                  aria-label="Edit queued message"
                  title="Move back to input to edit"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void handleSendNow(item)}
                  aria-label="Send immediately"
                  title={isRunning ? 'Stop current turn and send now' : 'Send now'}
                >
                  <Play className="size-3" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => remove(conversation.id, item.id)}
                  aria-label="Remove queued message"
                  title="Remove from queue"
                >
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
