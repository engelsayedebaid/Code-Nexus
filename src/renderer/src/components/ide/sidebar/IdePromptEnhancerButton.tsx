import { WandSparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import {
  DEFAULT_CONVERSATION_ENHANCER_SLICE,
  useIdePromptEnhancerStore
} from '@/store/ide-agent/ide-prompt-enhancer-store'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'

export function IdePromptEnhancerButton({
  conversation,
  worktreeSelector,
  workspacePath,
  worktreeId,
  hasDraftText,
  onFocusInput
}: {
  conversation: IdeConversation | null
  worktreeSelector?: string | null
  workspacePath?: string | null
  worktreeId?: string | null
  hasDraftText: boolean
  onFocusInput?: () => void
}): React.JSX.Element {
  const convId = conversation?.id ?? 'default'
  const slice = useIdePromptEnhancerStore(
    (s) => s.byConversation[convId] ?? DEFAULT_CONVERSATION_ENHANCER_SLICE
  )
  const triggerEnhance = useIdePromptEnhancerStore((s) => s.triggerEnhance)

  const isEnhancing = slice.status === 'enhancing'
  const isPreviewOpen = slice.status === 'preview'
  const canReEnhanceEditedDraft = isEnhancing && slice.draftChangedSinceRequest && hasDraftText
  const disabled = !conversation || !hasDraftText || (isEnhancing && !canReEnhanceEditedDraft)

  const handleClick = (): void => {
    if (!conversation || disabled) {
      return
    }
    onFocusInput?.()
    void triggerEnhance({
      conversationId: conversation.id,
      worktreeSelector,
      workspacePath,
      worktreeId,
      mode: conversation.mode,
      agentId: conversation.agentId,
      modelId: conversation.modelId
    })
  }

  const tooltipLabel = canReEnhanceEditedDraft
    ? 'Enhance updated draft'
    : isEnhancing
      ? 'Enhancing prompt… (you can keep typing)'
      : 'Enhance Prompt'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-busy={isEnhancing || undefined}
          aria-label="Enhance Prompt"
          data-testid="ide-enhance-prompt-btn"
          onMouseDown={(e) => {
            // Preserve textarea focus & caret so the user can keep typing seamlessly while enhancing.
            e.preventDefault()
          }}
          onClick={handleClick}
          className={cn(
            'group relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:pointer-events-none',
            isEnhancing
              ? 'border-ring/60 bg-accent text-foreground shadow-xs disabled:opacity-95'
              : isPreviewOpen
                ? 'border-ring/50 bg-accent text-foreground shadow-2xs disabled:opacity-40'
                : 'border-border/70 bg-muted/40 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground disabled:opacity-40'
          )}
        >
          {isEnhancing ? (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-foreground/15 border-t-foreground animate-spin motion-reduce:animate-none"
              />
              <WandSparkles className="size-2.5 animate-pulse motion-reduce:animate-none" />
            </>
          ) : (
            <WandSparkles className="size-3 transition-transform duration-200 group-hover:-rotate-12 group-hover:scale-110 motion-reduce:transform-none" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  )
}
