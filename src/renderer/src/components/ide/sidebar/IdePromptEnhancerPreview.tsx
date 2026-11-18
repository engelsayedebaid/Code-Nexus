import { useEffect } from 'react'
import { AlertCircle, Check, RotateCcw, Undo2, WandSparkles, X } from 'lucide-react'
import { markdownMessageDirection } from '@/components/sidebar/comment-markdown-direction'
import { Button } from '@/components/ui/button'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import {
  DEFAULT_CONVERSATION_ENHANCER_SLICE,
  useIdePromptEnhancerStore
} from '@/store/ide-agent/ide-prompt-enhancer-store'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'

export function IdePromptEnhancerPreview({
  conversation,
  worktreeSelector,
  workspacePath,
  worktreeId,
  onFocusInput
}: {
  conversation: IdeConversation
  worktreeSelector: string | null
  workspacePath: string | null
  worktreeId: string | null
  onFocusInput?: () => void
}): React.JSX.Element | null {
  const prefersReducedMotion = usePrefersReducedMotion()
  const slice = useIdePromptEnhancerStore(
    (s) => s.byConversation[conversation.id] ?? DEFAULT_CONVERSATION_ENHANCER_SLICE
  )
  const applyEnhancedPrompt = useIdePromptEnhancerStore((s) => s.applyEnhancedPrompt)
  const regenerate = useIdePromptEnhancerStore((s) => s.regenerate)
  const dismissPreview = useIdePromptEnhancerStore((s) => s.dismissPreview)
  const cancelEnhancement = useIdePromptEnhancerStore((s) => s.cancelEnhancement)
  const restoreOriginalDraft = useIdePromptEnhancerStore((s) => s.restoreOriginalDraft)
  const clearRestorableDraft = useIdePromptEnhancerStore((s) => s.clearRestorableDraft)

  useEffect(() => {
    const convId = conversation.id
    return () => {
      const current = useIdePromptEnhancerStore.getState().byConversation[convId]
      if (current?.status === 'enhancing') {
        useIdePromptEnhancerStore.getState().cancelEnhancement(convId)
      }
    }
  }, [conversation.id])

  const handleRegenerate = (): void => {
    onFocusInput?.()
    void regenerate({
      conversationId: conversation.id,
      worktreeSelector,
      workspacePath,
      worktreeId,
      mode: conversation.mode,
      agentId: conversation.agentId,
      modelId: conversation.modelId
    })
  }

  if (slice.status === 'enhancing') {
    return (
      <div
        dir="ltr"
        data-testid="ide-enhance-enhancing-banner"
        className="mx-2 mt-2 overflow-hidden rounded-lg border border-ring/35 bg-muted/35 text-left text-xs shadow-2xs animate-in fade-in slide-in-from-top-1 duration-200"
      >
        <div className="relative h-0.5 w-full overflow-hidden bg-border/40">
          {!prefersReducedMotion ? (
            <div
              aria-hidden="true"
              className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-foreground/80 to-transparent"
              style={{ animation: 'skill-update-slide 1.3s ease-in-out infinite' }}
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full border border-foreground/20 border-t-foreground animate-spin motion-reduce:animate-none"
              />
              <WandSparkles className="size-2.5" />
            </span>
            <span className="shimmer shimmer-duration-1500 truncate font-medium text-foreground">
              AI Enhanced Prompt — refining clarity & structure…
            </span>
            <span className="hidden rounded bg-background/80 px-1.5 py-0.5 text-3xs text-muted-foreground sm:inline">
              {slice.draftChangedSinceRequest
                ? 'Typing active — edits preserved'
                : 'Keep typing freely below'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {slice.draftChangedSinceRequest ? (
              <Button
                size="xs"
                variant="outline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleRegenerate}
              >
                <RotateCcw className="size-3" />
                <span>Enhance latest</span>
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              data-testid="ide-enhance-cancel-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => cancelEnhancement(conversation.id)}
            >
              <X className="size-3" />
              <span>Cancel</span>
            </Button>
          </div>
        </div>

        <div aria-hidden="true" className="space-y-1.5 px-2.5 pb-2 pt-0.5">
          <div className="h-2 w-4/5 rounded-full bg-foreground/10 animate-pulse motion-reduce:animate-none" />
          <div className="h-2 w-3/5 rounded-full bg-foreground/7 animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    )
  }

  if (slice.status === 'error') {
    return (
      <div
        dir="ltr"
        role="alert"
        data-testid="ide-enhance-error-banner"
        className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-left text-xs animate-in fade-in duration-150"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="truncate">{slice.errorMessage || 'Prompt enhancement failed.'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            data-testid="ide-enhance-regenerate-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleRegenerate}
          >
            <RotateCcw className="size-3" />
            <span>Regenerate</span>
          </Button>
          <Button
            size="xs"
            variant="ghost"
            data-testid="ide-enhance-dismiss-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => dismissPreview(conversation.id)}
          >
            <span>Dismiss</span>
          </Button>
        </div>
      </div>
    )
  }

  if (slice.status === 'preview' && slice.enhancedPrompt) {
    const textDir = markdownMessageDirection(slice.enhancedPrompt)
    return (
      <div
        dir="ltr"
        data-testid="ide-enhance-preview-card"
        className="mx-2 mt-2 overflow-hidden rounded-lg border border-border/80 bg-muted/30 text-left shadow-2xs animate-in fade-in slide-in-from-top-1 duration-200"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <WandSparkles className="size-3.5 shrink-0 text-foreground" />
            <span className="text-xs font-medium text-foreground">AI Enhanced Prompt</span>
            {slice.draftChangedSinceRequest ? (
              <span className="rounded bg-accent px-1.5 py-0.5 text-3xs text-muted-foreground">
                Draft edited since request
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="xs"
              data-testid="ide-enhance-apply-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (applyEnhancedPrompt(conversation.id)) {
                  onFocusInput?.()
                }
              }}
            >
              <Check className="size-3" />
              <span>Apply</span>
            </Button>
            <Button
              size="xs"
              variant="outline"
              data-testid="ide-enhance-regenerate-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleRegenerate}
            >
              <RotateCcw className="size-3" />
              <span>Regenerate</span>
            </Button>
            <Button
              size="xs"
              variant="ghost"
              data-testid="ide-enhance-dismiss-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => dismissPreview(conversation.id)}
            >
              <X className="size-3" />
              <span>Dismiss</span>
            </Button>
          </div>
        </div>

        <div
          dir={textDir}
          data-testid="ide-enhance-preview-text"
          className="scrollbar-sleek max-h-44 overflow-y-auto px-2.5 py-2 text-start text-xs leading-relaxed whitespace-pre-wrap text-foreground select-text"
        >
          {slice.enhancedPrompt}
        </div>
      </div>
    )
  }

  if (slice.status === 'idle' && slice.restorableDraft !== null) {
    return (
      <div
        dir="ltr"
        data-testid="ide-enhance-restorable-bar"
        className="mx-2 mt-1.5 flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/25 px-2 py-1 text-left text-2xs text-muted-foreground animate-in fade-in duration-150"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <WandSparkles className="size-3 shrink-0 text-foreground/80" />
          <span className="truncate">Enhanced prompt applied — edit freely before sending</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="ide-enhance-restore-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (restoreOriginalDraft(conversation.id)) {
                onFocusInput?.()
              }
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Undo2 className="size-2.5" />
            <span>Restore original</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss restore notice"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => clearRestorableDraft(conversation.id)}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-2.5" />
          </button>
        </div>
      </div>
    )
  }

  return null
}
