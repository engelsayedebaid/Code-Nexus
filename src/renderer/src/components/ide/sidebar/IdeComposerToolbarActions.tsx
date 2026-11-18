import { AtSign, Clock, ImagePlus, Loader2, Paperclip } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'

export function IdeComposerToolbarActions({
  conversation,
  worktreeSelector,
  hasActiveRun,
  hasPromptContent,
  submitting,
  savingPasteCount,
  onToggleFilePicker,
  onPickImage,
  onPickExternalFile,
  onStopRun,
  onSubmitOrQueue
}: {
  conversation: IdeConversation | null
  worktreeSelector: string | null
  hasActiveRun: boolean
  hasPromptContent: boolean
  submitting: boolean
  savingPasteCount: number
  onToggleFilePicker: () => void
  onPickImage: () => void
  onPickExternalFile: () => void
  onStopRun: () => void
  onSubmitOrQueue: () => void
}): React.JSX.Element {
  const canSubmitOrQueue =
    Boolean(conversation && worktreeSelector) &&
    !submitting &&
    savingPasteCount === 0 &&
    hasPromptContent

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!conversation}
            onClick={onToggleFilePicker}
            aria-label="Mention file or symbol"
          >
            <AtSign className="size-3.5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Add file, folder, or symbol (@)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!conversation}
            onClick={onPickImage}
            aria-label="Attach image"
          >
            <ImagePlus className="size-3.5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Attach image</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={!conversation}
            onClick={onPickExternalFile}
            aria-label="Attach external file"
          >
            <Paperclip className="size-3.5 text-muted-foreground" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Attach file from disk</TooltipContent>
      </Tooltip>

      {hasActiveRun && conversation?.activeRunId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs-round"
              variant="outline"
              className="ms-0.5"
              onClick={onStopRun}
              data-testid="ide-chat-stop-btn"
              aria-label="Stop agent"
            >
              <AppIcon name="stop" className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Stop agent</TooltipContent>
        </Tooltip>
      ) : null}

      {hasActiveRun ? (
        hasPromptContent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs-round"
                className="ms-0.5"
                disabled={!canSubmitOrQueue}
                onClick={onSubmitOrQueue}
                data-testid="ide-chat-queue-btn"
                aria-label="Queue message"
              >
                <Clock className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Queue message (Enter) — sends automatically after current turn
            </TooltipContent>
          </Tooltip>
        ) : null
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs-round"
              className="ms-0.5"
              disabled={!canSubmitOrQueue}
              onClick={onSubmitOrQueue}
              data-testid="ide-chat-send-btn"
              aria-label="Send message"
            >
              {submitting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <AppIcon name="send" className="size-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Send message</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
