import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'
import { AppIcon } from '@/components/icons/app-icon'
import { IdeChatWorkspaceFilePicker } from './IdeChatWorkspaceFilePicker'
import { IdeComposerAttachmentsBar } from './IdeComposerAttachmentsBar'
import { IdeComposerModeModelPicker } from './IdeComposerModeModelPicker'
import { useIdeChatMention } from './use-ide-chat-mention'
import { useIdeSmartPaste } from './use-ide-smart-paste'

function makeAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

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
  const activeFileId = useAppStore((s) => s.activeFileId)
  const openFiles = useAppStore((s) => s.openFiles)
  const draftsByConversation = useIdeAgentStore((s) => s.draftsByConversation)
  const attachmentsByConversation = useIdeAgentStore((s) => s.attachmentsByConversation)
  const setDraft = useIdeAgentStore((s) => s.setDraft)
  const addAttachment = useIdeAgentStore((s) => s.addAttachment)
  const removeAttachment = useIdeAgentStore((s) => s.removeAttachment)
  const sendPrompt = useIdeAgentStore((s) => s.sendPrompt)
  const controlRun = useIdeAgentStore((s) => s.controlRun)
  const providers = useIdeAgentStore((s) => s.providers)
  const providersLoading = useIdeAgentStore((s) => s.providersLoading)

  const convId = conversation?.id ?? 'default'
  const draft = draftsByConversation[convId] ?? ''
  const attachments = attachmentsByConversation[convId] ?? []

  const [showFilePicker, setShowFilePicker] = useState(false)
  const [draggingOver, setDraggingOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const externalFileInputRef = useRef<HTMLInputElement | null>(null)
  const {
    savingPasteCount,
    pasteNotice,
    clearPasteNotice,
    readImageFileAsAttachment,
    handlePaste,
    getFallbackPreviewText
  } = useIdeSmartPaste({
    conversationId: conversation?.id ?? null,
    addAttachment
  })
  const { mention, textareaRef, refreshMention, onDraftChange, handleMentionAttach, closeMention } =
    useIdeChatMention({ conversation, draft, setDraft, addAttachment })

  useEffect(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 160)}px`
  }, [draft, textareaRef])

  const handleAttachActiveEditorContext = async () => {
    if (!conversation) {
      return
    }
    const active = openFiles.find((f) => f.id === activeFileId)
    if (!active || (worktreeId && active.worktreeId !== worktreeId)) {
      setShowFilePicker(true)
      return
    }
    const cleanRel = normalizeWorkspaceRelativePath(active.relativePath || active.filePath)
    const sensitive = classifySensitiveFilePath(cleanRel, 'read-context') !== null
    const activeSelection = !sensitive ? getActiveIdeEditorSelection(cleanRel) : null
    if (activeSelection && activeSelection.text.trim().length > 0) {
      addAttachment(conversation.id, {
        id: makeAttachmentId('sel'),
        kind: 'selection',
        name: cleanRel,
        relativePath: cleanRel,
        lineRange: { start: activeSelection.startLine, end: activeSelection.endLine },
        previewText: activeSelection.text.slice(0, 6000),
        sensitiveWarning: false
      })
      return
    }
    let previewText: string | undefined
    if (window.api?.fs?.readFile && !sensitive) {
      try {
        const res = await window.api.fs.readFile({ filePath: active.filePath })
        if (!res.isBinary) {
          previewText = res.content.slice(0, 6000)
        }
      } catch {
        // Fallback to path-only context
      }
    }
    const attachment: IdeChatAttachment = {
      id: makeAttachmentId('ctx'),
      kind: 'workspace-context',
      name: `Active: ${cleanRel}`,
      relativePath: cleanRel,
      previewText,
      sensitiveWarning: sensitive
    }
    addAttachment(conversation.id, attachment)
  }

  const readExternalTextFile = (file: File) => {
    if (!conversation) {
      return
    }
    if (file.type.startsWith('image/')) {
      readImageFileAsAttachment(file)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const sensitive = classifySensitiveFilePath(file.name, 'read-context') !== null
      addAttachment(conversation.id, {
        id: makeAttachmentId('ext'),
        kind: 'file',
        name: file.name,
        mimeType: file.type || 'text/plain',
        previewText:
          typeof reader.result === 'string'
            ? sensitive
              ? '[Sensitive file — explicit permission required]'
              : reader.result.slice(0, 8000)
            : undefined,
        sensitiveWarning: sensitive
      })
    }
    reader.readAsText(file)
  }

  const handleSend = async () => {
    if (!conversation || !worktreeSelector || submitting || isRunning || savingPasteCount > 0) {
      return
    }
    const trimmed = draft.trim()
    if (!trimmed && attachments.length === 0) {
      return
    }
    setSubmitting(true)
    try {
      await sendPrompt({
        conversationId: conversation.id,
        worktreeSelector,
        text: trimmed || 'Please review the attached context.',
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

  return (
    <TooltipProvider>
      {(showFilePicker || mention) && conversation ? (
        <IdeChatWorkspaceFilePicker
          workspacePath={workspacePath}
          worktreeId={worktreeId}
          initialQuery={mention?.query ?? ''}
          onAttach={handleMentionAttach}
          onClose={() => {
            setShowFilePicker(false)
            closeMention()
          }}
          onBrowseDisk={() => externalFileInputRef.current?.click()}
        />
      ) : null}

      <div className="bg-background px-3 pb-3 pt-2">
        <div
          onDragOver={(e) => {
            if (!conversation || !e.dataTransfer?.types.includes('Files')) {
              return
            }
            e.preventDefault()
            setDraggingOver(true)
          }}
          onDragLeave={() => setDraggingOver(false)}
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
            'mx-auto w-full max-w-2xl rounded-xl border bg-card/70 shadow-xs transition-[border-color,box-shadow,background-color] focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/20',
            draggingOver ? 'border-primary bg-primary/5' : 'border-border'
          )}
        >
          {conversation ? (
            <IdeComposerAttachmentsBar
              conversationId={conversation.id}
              attachments={attachments}
              contextBudget={conversation.contextBudget}
              savingPasteCount={savingPasteCount}
              pasteNotice={pasteNotice}
              onDismissPasteNotice={clearPasteNotice}
              getFallbackPreviewText={getFallbackPreviewText}
              onRemove={removeAttachment}
            />
          ) : null}

          <Textarea
            ref={textareaRef}
            dir="auto"
            value={draft}
            disabled={!conversation}
            data-testid="ide-chat-composer-input"
            placeholder={
              conversation ? 'Plan, build, / for skills, @ for context' : 'Preparing Carver…'
            }
            rows={2}
            className="min-h-14 max-h-40 resize-none border-0 bg-transparent px-3 pb-1 pt-2.5 text-sm leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0"
            onChange={(e) => {
              onDraftChange(e.target.value, e.target.selectionStart)
            }}
            onSelect={refreshMention}
            onKeyUp={refreshMention}
            onClick={refreshMention}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && mention) {
                closeMention()
                return
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
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

          <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!conversation}
                    onClick={() => setShowFilePicker((prev) => !prev)}
                    aria-label="Attach file"
                  >
                    <AppIcon name="attachFile" size="xs" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Attach file</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!conversation}
                    onClick={() => imageInputRef.current?.click()}
                    aria-label="Attach image"
                  >
                    <AppIcon name="attachImage" size="xs" />
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
                    onClick={() => void handleAttachActiveEditorContext()}
                    aria-label="Add workspace context"
                  >
                    <AppIcon name="addContext" size="xs" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Add active file / workspace context</TooltipContent>
              </Tooltip>

              <div className="mx-0.5 h-3.5 w-px shrink-0 bg-border/70" />

              <IdeComposerModeModelPicker
                conversation={conversation}
                providers={providers}
                providersLoading={providersLoading}
              />
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  {isRunning && conversation?.activeRunId ? (
                    <Button
                      size="icon-sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() =>
                        void controlRun({
                          conversationId: conversation.id,
                          runId: conversation.activeRunId!,
                          action: 'stop'
                        })
                      }
                      data-testid="ide-chat-stop-btn"
                      aria-label="Stop agent"
                    >
                      <AppIcon name="stop" className="size-3" />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm"
                      className="rounded-full"
                      disabled={
                        !conversation ||
                        !worktreeSelector ||
                        submitting ||
                        savingPasteCount > 0 ||
                        (!draft.trim() && attachments.length === 0)
                      }
                      onClick={() => void handleSend()}
                      data-testid="ide-chat-send-btn"
                      aria-label="Send message"
                    >
                      {submitting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <AppIcon name="send" className="size-3.5" />
                      )}
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isRunning && conversation?.activeRunId ? 'Stop agent' : 'Send message'}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
