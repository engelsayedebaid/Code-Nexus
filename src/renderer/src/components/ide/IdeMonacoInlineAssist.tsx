import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { editor } from 'monaco-editor'
import { CornerDownLeft, MessageSquarePlus, Sparkles, Wand2, X } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { resolveActiveIdeWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'
import { ImeInput } from '@/lib/text-input/ime/ime-text-field'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdeChatAttachment } from '../../../../shared/ide-agent/ide-agent-types'
import {
  computeIdeMonacoAnchorCoords,
  readIdeMonacoSelectionSnapshot,
  type IdeMonacoSelectionSnapshot
} from './ide-monaco-selection-anchor'

export const IDE_OPEN_INLINE_EDIT_EVENT = 'orca:ide-open-inline-edit'

const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
const MOD_LABEL = isMacPlatform ? '⌘' : 'Ctrl+'

export function IdeMonacoInlineAssist({
  editor: editorInstance,
  containerRef,
  relativePath,
  worktreeId,
  readOnly
}: {
  editor: editor.IStandaloneCodeEditor | null
  containerRef: RefObject<HTMLDivElement | null>
  relativePath: string
  worktreeId?: string
  readOnly: boolean
}): React.JSX.Element | null {
  const appMode = useAppStore((s) => s.appMode)
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen)
  const setIdeSidebarView = useAppStore((s) => s.setIdeSidebarView)

  const activeConversation = useIdeAgentStore((s) => s.activeConversation)
  const ensureWorkspaceInitialized = useIdeAgentStore((s) => s.ensureWorkspaceInitialized)
  const addAttachment = useIdeAgentStore((s) => s.addAttachment)
  const sendPrompt = useIdeAgentStore((s) => s.sendPrompt)

  const [selectionSnap, setSelectionSnap] = useState<IdeMonacoSelectionSnapshot | null>(null)
  const [inlinePromptOpen, setInlinePromptOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const inlineOpenRef = useRef(false)
  inlineOpenRef.current = inlinePromptOpen

  const isEnabled = appMode === 'ide' && !readOnly && Boolean(editorInstance)

  const buildSelectionAttachment = useCallback(
    (snap: IdeMonacoSelectionSnapshot): IdeChatAttachment => {
      const basename = relativePath.split(/[\\/]/).pop() ?? relativePath
      return {
        id: `inline-sel-${Date.now()}`,
        kind: 'selection',
        name: `${basename} (${snap.startLine === snap.endLine ? `L${snap.startLine}` : `L${snap.startLine}-${snap.endLine}`})`,
        relativePath,
        lineRange: { start: snap.startLine, end: snap.endLine },
        previewText: snap.text
      }
    },
    [relativePath]
  )

  const ensureReadyConversation = useCallback(async () => {
    const ws = resolveActiveIdeWorkspace()
    if (!ws) {
      return null
    }
    let conv = useIdeAgentStore.getState().activeConversation
    if (!conv || conv.workspaceKey !== ws.workspaceKey) {
      await ensureWorkspaceInitialized(ws.workspaceKey, ws.workspacePath, ws.worktreeSelector)
      conv = useIdeAgentStore.getState().activeConversation
    }
    return conv ? { conv, ws } : null
  }, [ensureWorkspaceInitialized])

  const handleAddToChat = useCallback(
    async (snap: IdeMonacoSelectionSnapshot) => {
      setRightSidebarOpen(true)
      setIdeSidebarView('ai-chat')
      const target = await ensureReadyConversation()
      if (!target) {
        return
      }
      addAttachment(target.conv.id, buildSelectionAttachment(snap))
      setInlinePromptOpen(false)
      window.requestAnimationFrame(() => {
        const composer = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="ide-chat-composer-input"]'
        )
        composer?.focus()
      })
    },
    [
      addAttachment,
      buildSelectionAttachment,
      ensureReadyConversation,
      setIdeSidebarView,
      setRightSidebarOpen
    ]
  )

  const handleQuickExplain = useCallback(
    async (snap: IdeMonacoSelectionSnapshot) => {
      setRightSidebarOpen(true)
      setIdeSidebarView('ai-chat')
      const target = await ensureReadyConversation()
      if (!target) {
        return
      }
      addAttachment(target.conv.id, buildSelectionAttachment(snap))
      setInlinePromptOpen(false)
      setSelectionSnap(null)
      const rangeText =
        snap.startLine === snap.endLine
          ? `line ${snap.startLine}`
          : `lines ${snap.startLine}–${snap.endLine}`
      await sendPrompt({
        conversationId: target.conv.id,
        worktreeSelector: target.ws.worktreeSelector,
        text: `Explain how ${relativePath} (${rangeText}) works, its responsibilities, and any potential edge cases.`,
        mode: 'ask'
      })
    },
    [
      addAttachment,
      buildSelectionAttachment,
      ensureReadyConversation,
      relativePath,
      sendPrompt,
      setIdeSidebarView,
      setRightSidebarOpen
    ]
  )

  const openInlinePrompt = useCallback(() => {
    if (!editorInstance) {
      return
    }
    const snap = readIdeMonacoSelectionSnapshot(editorInstance, containerRef.current, true)
    if (!snap) {
      return
    }
    setSelectionSnap(snap)
    setInlinePromptOpen(true)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [containerRef, editorInstance])

  useEffect(() => {
    if (!isEnabled || !editorInstance) {
      setSelectionSnap(null)
      setInlinePromptOpen(false)
      return
    }

    const syncSelection = () => {
      if (inlineOpenRef.current) {
        return
      }
      setSelectionSnap(readIdeMonacoSelectionSnapshot(editorInstance, containerRef.current, false))
    }

    const selSub = editorInstance.onDidChangeCursorSelection(syncSelection)
    const scrollSub = editorInstance.onDidScrollChange(() => {
      if (inlineOpenRef.current) {
        setSelectionSnap((prev) =>
          prev
            ? {
                ...prev,
                ...computeIdeMonacoAnchorCoords(
                  editorInstance,
                  containerRef.current,
                  prev.startLine,
                  1
                )
              }
            : null
        )
        return
      }
      syncSelection()
    })
    const keySub = editorInstance.onKeyDown((event) => {
      const mod = isMacPlatform ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey) {
        return
      }
      const key = event.browserEvent.key.toLowerCase()
      if (key === 'k' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        openInlinePrompt()
        return
      }
      if (key === 'l' && !event.shiftKey) {
        const snap = readIdeMonacoSelectionSnapshot(editorInstance, containerRef.current, true)
        if (snap) {
          event.preventDefault()
          event.stopPropagation()
          void handleAddToChat(snap)
        }
      }
    })

    const onExternalTrigger = () => {
      if (worktreeId && useAppStore.getState().activeWorktreeId !== worktreeId) {
        return
      }
      openInlinePrompt()
    }
    window.addEventListener(IDE_OPEN_INLINE_EDIT_EVENT, onExternalTrigger)

    return () => {
      selSub.dispose()
      scrollSub.dispose()
      keySub.dispose()
      window.removeEventListener(IDE_OPEN_INLINE_EDIT_EVENT, onExternalTrigger)
    }
  }, [containerRef, editorInstance, handleAddToChat, isEnabled, openInlinePrompt, worktreeId])

  const closeInlinePrompt = useCallback(() => {
    setInlinePromptOpen(false)
    setInstruction('')
    editorInstance?.focus()
  }, [editorInstance])

  const handleSubmitInlineEdit = async () => {
    const trimmed = instruction.trim()
    if (!trimmed || !selectionSnap || submitting) {
      return
    }
    setSubmitting(true)
    try {
      setRightSidebarOpen(true)
      setIdeSidebarView('ai-chat')
      const target = await ensureReadyConversation()
      if (!target) {
        return
      }
      addAttachment(target.conv.id, buildSelectionAttachment(selectionSnap))
      const scopeLabel = selectionSnap.hasRangeSelection
        ? `lines ${selectionSnap.startLine}-${selectionSnap.endLine}`
        : `around line ${selectionSnap.startLine}`
      setInlinePromptOpen(false)
      setInstruction('')
      await sendPrompt({
        conversationId: target.conv.id,
        worktreeSelector: target.ws.worktreeSelector,
        text: `Edit \`${relativePath}\` (${scopeLabel}): ${trimmed}`,
        mode: 'agent'
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!isEnabled || !selectionSnap) {
    return null
  }

  const rangeBadge =
    selectionSnap.startLine === selectionSnap.endLine
      ? `Ln ${selectionSnap.startLine}`
      : `L${selectionSnap.startLine}–${selectionSnap.endLine}`

  const isBusy =
    submitting ||
    activeConversation?.status === 'analyzing' ||
    activeConversation?.status === 'planning' ||
    activeConversation?.status === 'executing'

  if (inlinePromptOpen) {
    return (
      <div
        dir="ltr"
        data-testid="ide-inline-edit-box"
        style={{ top: `${selectionSnap.top}px`, left: `${selectionSnap.left}px` }}
        className="absolute z-30 w-[min(420px,calc(100%-32px))] rounded-xl border border-ring/50 bg-popover/95 p-2 text-left shadow-lg backdrop-blur-md"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            <Sparkles className="size-3 shrink-0 text-foreground/85" />
            <span className="font-medium text-foreground">Inline Edit</span>
            <span className="truncate font-mono text-3xs text-muted-foreground">
              {relativePath.split(/[\\/]/).pop()} · {rangeBadge}
            </span>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={closeInlinePrompt}
            aria-label="Close inline edit"
          >
            <X className="size-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <ImeInput
            ref={inputRef}
            value={instruction}
            disabled={isBusy}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeInlinePrompt()
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.stopPropagation()
                void handleSubmitInlineEdit()
              }
            }}
            placeholder="Describe how to edit or refactor this code…"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-ring"
          />
          <Button
            size="xs"
            disabled={isBusy || !instruction.trim()}
            onClick={() => void handleSubmitInlineEdit()}
          >
            {isBusy ? <LoadingSpinner className="size-3" /> : <CornerDownLeft className="size-3" />}
            Apply
          </Button>
        </div>
      </div>
    )
  }

  if (!selectionSnap.hasRangeSelection) {
    return null
  }

  return (
    <div
      dir="ltr"
      data-testid="ide-selection-toolbar"
      style={{ top: `${selectionSnap.top}px`, left: `${selectionSnap.left}px` }}
      className="absolute z-20 inline-flex items-center gap-0.5 rounded-lg border border-border/90 bg-popover/95 p-0.5 text-left shadow-md backdrop-blur-md"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={openInlinePrompt}
        className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <Wand2 className="size-3 text-muted-foreground" />
        <span>Edit</span>
        <kbd className="rounded bg-muted px-1 font-mono text-3xs text-muted-foreground">
          {MOD_LABEL}K
        </kbd>
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void handleAddToChat(selectionSnap)}
        className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <MessageSquarePlus className="size-3 text-muted-foreground" />
        <span>Chat</span>
        <kbd className="rounded bg-muted px-1 font-mono text-3xs text-muted-foreground">
          {MOD_LABEL}L
        </kbd>
      </button>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void handleQuickExplain(selectionSnap)}
        className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Sparkles className="size-3" />
        <span>Explain</span>
      </button>
    </div>
  )
}
