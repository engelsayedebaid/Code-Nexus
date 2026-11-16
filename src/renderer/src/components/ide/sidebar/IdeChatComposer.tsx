import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/class-names'
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
import { IdeComposerModeModelPicker } from './IdeComposerModeModelPicker'
import { useIdeChatMention } from './use-ide-chat-mention'

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
  const [submitting, setSubmitting] = useState(false)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const externalFileInputRef = useRef<HTMLInputElement | null>(null)
  const { mention, textareaRef, refreshMention, onDraftChange, handleMentionAttach, closeMention } =
    useIdeChatMention({ conversation, draft, setDraft, addAttachment })

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

  const readImageFileAsAttachment = (file: File) => {
    if (!conversation || !file.type.startsWith('image/')) {
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addAttachment(conversation.id, {
          id: makeAttachmentId('img'),
          kind: 'image',
          name: file.name || 'pasted-image.png',
          mimeType: file.type,
          dataUrl: reader.result
        })
      }
    }
    reader.readAsDataURL(file)
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
    if (!conversation || !worktreeSelector || submitting || isRunning) {
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
          initialQuery={mention?.query ?? ''}
          onAttach={handleMentionAttach}
          onClose={() => {
            setShowFilePicker(false)
            closeMention()
          }}
          onBrowseDisk={() => externalFileInputRef.current?.click()}
        />
      ) : null}

      <div className="border-t border-border/60 bg-background px-4 pb-3 pt-2">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-border/70 bg-card/60 shadow-xs transition-colors focus-within:border-ring/40">
          {attachments.length > 0 && conversation ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10.5px]',
                    att.sensitiveWarning
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                      : 'border-border bg-muted/40 text-foreground'
                  )}
                >
                  {att.kind === 'image' && att.dataUrl ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="size-3.5 rounded object-cover"
                    />
                  ) : null}
                  <span className="max-w-[140px] truncate font-mono">{att.name}</span>
                  {att.sensitiveWarning ? <AppIcon name="warning" className="size-3" /> : null}
                  <button
                    type="button"
                    aria-label={`Remove ${att.name}`}
                    onClick={() => removeAttachment(conversation.id, att.id)}
                    className="hover:text-destructive"
                  >
                    <AppIcon name="close" className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            dir="auto"
            value={draft}
            disabled={!conversation}
            data-testid="ide-chat-composer-input"
            placeholder={
              conversation
                ? `Ask Code Nexus anything — @ to mention files, Enter to send`
                : 'Message Code Nexus — it can create files in a private scratch folder'
            }
            rows={2}
            className="min-h-[42px] max-h-36 resize-none border-0 bg-transparent px-3 pb-1 pt-2 text-xs shadow-none focus-visible:border-0 focus-visible:ring-0"
            onChange={(e) => {
              onDraftChange(e.target.value, e.target.selectionStart)
            }}
            onSelect={refreshMention}
            onKeyUp={refreshMention}
            onClick={refreshMention}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items ?? [])
              for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                  const file = item.getAsFile()
                  if (file) {
                    readImageFileAsAttachment(file)
                  }
                }
              }
            }}
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
              {isRunning && conversation?.activeRunId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs"
                  onClick={() =>
                    void controlRun({
                      conversationId: conversation.id,
                      runId: conversation.activeRunId!,
                      action: 'stop'
                    })
                  }
                  data-testid="ide-chat-stop-btn"
                >
                  <AppIcon name="stop" className="mr-1 size-3" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={
                    !conversation ||
                    !worktreeSelector ||
                    submitting ||
                    (!draft.trim() && attachments.length === 0)
                  }
                  onClick={() => void handleSend()}
                  data-testid="ide-chat-send-btn"
                >
                  {submitting ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <AppIcon name="send" className="mr-1 size-3" />
                  )}
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
