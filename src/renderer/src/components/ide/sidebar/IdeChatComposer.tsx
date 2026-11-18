import { useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ImeTextarea } from '@/lib/text-input/ime/ime-text-field'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useIdePromptEnhancerStore } from '@/store/ide-agent/ide-prompt-enhancer-store'
import { useIdePromptQueueStore } from '@/store/ide-agent/ide-prompt-queue'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'
import {
  IdeChatWorkspaceFilePicker,
  type IdeWorkspaceFilePickerHandle
} from './IdeChatWorkspaceFilePicker'
import { IdeComposerAttachmentsBar } from './IdeComposerAttachmentsBar'
import { IDE_EXECUTION_MODE_ORDER, IdeComposerModeModelPicker } from './IdeComposerModeModelPicker'
import { IdeComposerToolbarActions } from './IdeComposerToolbarActions'
import { IdePromptEnhancerButton } from './IdePromptEnhancerButton'
import { IdePromptEnhancerPreview } from './IdePromptEnhancerPreview'
import { getIdeModePlaceholder } from './ide-chat-copy'
import { useIdeChatMention } from './use-ide-chat-mention'
import { useIdeComposerContext } from './use-ide-composer-context'
import { useIdeSmartPaste } from './use-ide-smart-paste'

const EMPTY_ATTACHMENTS: IdeChatAttachment[] = []

export function IdeChatComposer({
  conversation,
  workspacePath,
  worktreeSelector,
  worktreeId,
  isRunning
}: {
  conversation: IdeConversation | null
  workspacePath: string | null
  worktreeSelector: string | null
  worktreeId: string | null
  isRunning: boolean
}) {
  const convId = conversation?.id ?? 'default'
  const draft = useIdeAgentStore((s) => s.draftsByConversation[convId] ?? '')
  const attachments = useIdeAgentStore(
    (s) => s.attachmentsByConversation[convId] ?? EMPTY_ATTACHMENTS
  )
  const setDraft = useIdeAgentStore((s) => s.setDraft)
  const addAttachment = useIdeAgentStore((s) => s.addAttachment)
  const removeAttachment = useIdeAgentStore((s) => s.removeAttachment)
  const clearAttachments = useIdeAgentStore((s) => s.clearAttachments)
  const sendPrompt = useIdeAgentStore((s) => s.sendPrompt)
  const controlRun = useIdeAgentStore((s) => s.controlRun)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const providers = useIdeAgentStore((s) => s.providers)
  const providersLoading = useIdeAgentStore((s) => s.providersLoading)
  const enqueuePromptItem = useIdePromptQueueStore((s) => s.enqueue)

  const [showFilePicker, setShowFilePicker] = useState(false)
  const [draggingOver, setDraggingOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const externalFileInputRef = useRef<HTMLInputElement | null>(null)
  const pickerRef = useRef<IdeWorkspaceFilePickerHandle | null>(null)

  const {
    savingPasteCount,
    pasteNotice,
    clearPasteNotice,
    readImageFileAsAttachment,
    handlePaste,
    getFallbackPreviewText,
    setPasteNotice
  } = useIdeSmartPaste({
    conversationId: conversation?.id ?? null,
    addAttachment
  })
  const { mention, textareaRef, refreshMention, onDraftChange, handleMentionAttach, closeMention } =
    useIdeChatMention({ conversation, draft, setDraft, addAttachment })
  const { activeEditorHint, handleAttachActiveEditorContext, readExternalTextFile } =
    useIdeComposerContext({
      conversation,
      worktreeId,
      attachments,
      addAttachment,
      readImageFileAsAttachment,
      setPasteNotice,
      onOpenFilePicker: () => setShowFilePicker(true)
    })

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) {
        return
      }
      el.style.height = 'auto'
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 52), 160)}px`
    })
    return () => cancelAnimationFrame(id)
  }, [draft, textareaRef])

  const hasActiveRun =
    isRunning || conversation?.status === 'paused' || conversation?.status === 'awaiting_permission'
  const hasPromptContent = Boolean(draft.trim() || attachments.length > 0)

  const handleSubmitOrQueue = async (): Promise<void> => {
    if (!conversation || !worktreeSelector || submitting || savingPasteCount > 0) {
      return
    }
    const trimmed = draft.trim()
    if (!trimmed && attachments.length === 0) {
      return
    }
    const text = trimmed || 'Please review the attached context.'
    const enhancer = useIdePromptEnhancerStore.getState()
    enhancer.dismissPreview(conversation.id)
    enhancer.clearRestorableDraft(conversation.id)
    if (hasActiveRun) {
      enqueuePromptItem({
        conversationId: conversation.id,
        worktreeSelector,
        text,
        mode: conversation.mode,
        agentId: conversation.agentId,
        modelId: conversation.modelId,
        multiAgentEnabled: conversation.multiAgentEnabled,
        followAgent: conversation.followAgent,
        attachments: [...attachments]
      })
      setDraft(conversation.id, '')
      clearAttachments(conversation.id)
      return
    }
    setSubmitting(true)
    try {
      await sendPrompt({
        conversationId: conversation.id,
        worktreeSelector,
        text,
        mode: conversation.mode,
        agentId: conversation.agentId,
        modelId: conversation.modelId,
        multiAgentEnabled: conversation.multiAgentEnabled,
        followAgent: conversation.followAgent
      })
    } finally {
      setSubmitting(false)
    }
  }

  const placeholder = !conversation
    ? 'Preparing Carver…'
    : hasActiveRun
      ? 'Type next message — press Enter to queue for auto-send…'
      : getIdeModePlaceholder(conversation.mode)

  return (
    <TooltipProvider>
      {(showFilePicker || mention) && conversation ? (
        <IdeChatWorkspaceFilePicker
          pickerRef={pickerRef}
          workspacePath={workspacePath}
          worktreeId={worktreeId}
          initialQuery={mention?.query ?? ''}
          inlineMention={Boolean(mention) && !showFilePicker}
          onAttach={handleMentionAttach}
          onClose={() => {
            setShowFilePicker(false)
            closeMention()
          }}
          onBrowseDisk={() => externalFileInputRef.current?.click()}
        />
      ) : null}

      <div className="bg-background px-2.5 pb-2.5 pt-1.5">
        <div
          onDragOver={(e) => {
            if (!conversation || !e.dataTransfer?.types.includes('Files')) {
              return
            }
            e.preventDefault()
            setDraggingOver(true)
          }}
          onDragLeave={(e) => {
            if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
              setDraggingOver(false)
            }
          }}
          onDrop={(e) => {
            if (!conversation) {
              return
            }
            const files = Array.from(e.dataTransfer?.files ?? [])
            if (files.length === 0) {
              return
            }
            e.preventDefault()
            setDraggingOver(false)
            for (const file of files) {
              readExternalTextFile(file)
            }
          }}
          className={cn(
            'mx-auto w-full max-w-2xl rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow,background-color] focus-within:border-ring/70',
            draggingOver ? 'border-foreground/50 bg-accent/30' : 'border-border'
          )}
        >
          {conversation ? (
            <IdeComposerAttachmentsBar
              conversationId={conversation.id}
              attachments={attachments}
              activeEditorHint={activeEditorHint}
              onPinActiveEditorHint={() => void handleAttachActiveEditorContext()}
              contextBudget={conversation.contextBudget}
              savingPasteCount={savingPasteCount}
              pasteNotice={pasteNotice}
              onDismissPasteNotice={clearPasteNotice}
              getFallbackPreviewText={getFallbackPreviewText}
              onRemove={removeAttachment}
            />
          ) : null}

          {conversation ? (
            <IdePromptEnhancerPreview
              conversation={conversation}
              worktreeSelector={worktreeSelector}
              workspacePath={workspacePath}
              worktreeId={worktreeId}
              onFocusInput={() => textareaRef.current?.focus()}
            />
          ) : null}

          <ImeTextarea
            ref={textareaRef}
            dir={draft ? 'auto' : 'ltr'}
            value={draft}
            disabled={!conversation}
            data-testid="ide-chat-composer-input"
            placeholder={placeholder}
            rows={2}
            className="scrollbar-sleek min-h-[52px] max-h-40 w-full resize-none bg-transparent px-2.5 pb-1 pt-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
            onChange={(e) => {
              onDraftChange(e.target.value, e.target.selectionStart)
              if (conversation) {
                useIdePromptEnhancerStore
                  .getState()
                  .notifyDraftChanged(conversation.id, e.target.value)
              }
            }}
            onSelect={refreshMention}
            onKeyUp={refreshMention}
            onClick={refreshMention}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                return
              }
              if ((e.ctrlKey || e.metaKey) && e.key === '.' && conversation) {
                e.preventDefault()
                const idx = IDE_EXECUTION_MODE_ORDER.indexOf(conversation.mode)
                const nextMode =
                  IDE_EXECUTION_MODE_ORDER[(idx + 1) % IDE_EXECUTION_MODE_ORDER.length]
                void updateSettings({ conversationId: conversation.id, mode: nextMode })
                return
              }
              if (mention && !showFilePicker) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  pickerRef.current?.moveSelection(1)
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  pickerRef.current?.moveSelection(-1)
                  return
                }
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
                  if (pickerRef.current?.selectCurrent()) {
                    e.preventDefault()
                    return
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  closeMention()
                  return
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSubmitOrQueue()
              }
            }}
          />

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                readImageFileAsAttachment(file)
              }
              e.target.value = ''
            }}
          />
          <input
            ref={externalFileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                readExternalTextFile(file)
              }
              e.target.value = ''
            }}
          />

          <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-0.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <IdeComposerModeModelPicker
                conversation={conversation}
                providers={providers}
                providersLoading={providersLoading}
                worktreeSelector={worktreeSelector}
              />
              <IdePromptEnhancerButton
                conversation={conversation}
                worktreeSelector={worktreeSelector}
                workspacePath={workspacePath}
                worktreeId={worktreeId}
                hasDraftText={draft.trim().length > 0}
                onFocusInput={() => textareaRef.current?.focus()}
              />
            </div>

            <IdeComposerToolbarActions
              conversation={conversation}
              worktreeSelector={worktreeSelector}
              hasActiveRun={hasActiveRun}
              hasPromptContent={hasPromptContent}
              submitting={submitting}
              savingPasteCount={savingPasteCount}
              onToggleFilePicker={() => setShowFilePicker((prev) => !prev)}
              onPickImage={() => imageInputRef.current?.click()}
              onPickExternalFile={() => externalFileInputRef.current?.click()}
              onStopRun={() => {
                if (conversation?.activeRunId) {
                  void controlRun({
                    conversationId: conversation.id,
                    runId: conversation.activeRunId,
                    action: 'stop'
                  })
                }
              }}
              onSubmitOrQueue={() => void handleSubmitOrQueue()}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
