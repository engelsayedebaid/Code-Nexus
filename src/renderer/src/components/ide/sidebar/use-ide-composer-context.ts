import { useCallback, useMemo } from 'react'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import { useAppStore } from '@/store'
import type {
  IdeChatAttachment,
  IdeConversation
} from '../../../../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'
import type { ActiveEditorContextHint } from './IdeComposerAttachmentsBar'

const MAX_EXTERNAL_TEXT_FILE_BYTES = 2 * 1024 * 1024

function makeAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function useIdeComposerContext({
  conversation,
  worktreeId,
  attachments,
  addAttachment,
  readImageFileAsAttachment,
  setPasteNotice,
  onOpenFilePicker
}: {
  conversation: IdeConversation | null
  worktreeId: string | null
  attachments: readonly IdeChatAttachment[]
  addAttachment: (conversationId: string, attachment: IdeChatAttachment) => void
  readImageFileAsAttachment: (file: File) => void
  setPasteNotice: (message: string | null) => void
  onOpenFilePicker: () => void
}) {
  const activeFileId = useAppStore((s) => s.activeFileId)
  const openFiles = useAppStore((s) => s.openFiles)

  const activeOpenFile = useMemo(() => {
    const candidate = openFiles.find((f) => f.id === activeFileId)
    if (!candidate || (worktreeId && candidate.worktreeId !== worktreeId)) {
      return null
    }
    return candidate
  }, [activeFileId, openFiles, worktreeId])

  const activeEditorHint = useMemo<ActiveEditorContextHint | null>(() => {
    if (!activeOpenFile) {
      return null
    }
    const cleanRel = normalizeWorkspaceRelativePath(
      activeOpenFile.relativePath || activeOpenFile.filePath
    )
    if (!cleanRel || attachments.some((att) => att.relativePath === cleanRel)) {
      return null
    }
    const selection = getActiveIdeEditorSelection(cleanRel)
    return {
      label: cleanRel.split('/').pop() ?? cleanRel,
      relativePath: cleanRel,
      selectionRange: selection ? { start: selection.startLine, end: selection.endLine } : undefined
    }
  }, [activeOpenFile, attachments])

  const handleAttachActiveEditorContext = useCallback(async () => {
    if (!conversation) {
      return
    }
    if (!activeOpenFile) {
      onOpenFilePicker()
      return
    }
    const cleanRel = normalizeWorkspaceRelativePath(
      activeOpenFile.relativePath || activeOpenFile.filePath
    )
    const baseName = cleanRel.split('/').pop() ?? cleanRel
    const sensitive = classifySensitiveFilePath(cleanRel, 'read-context') !== null
    const activeSelection = !sensitive ? getActiveIdeEditorSelection(cleanRel) : null
    if (activeSelection && activeSelection.text.trim().length > 0) {
      addAttachment(conversation.id, {
        id: makeAttachmentId('sel'),
        kind: 'selection',
        name: baseName,
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
        const res = await window.api.fs.readFile({ filePath: activeOpenFile.filePath })
        if (!res.isBinary) {
          previewText = res.content.slice(0, 6000)
        }
      } catch {
        // Fallback to path-only context
      }
    }
    addAttachment(conversation.id, {
      id: makeAttachmentId('ctx'),
      kind: 'workspace-context',
      name: baseName,
      relativePath: cleanRel,
      previewText,
      sensitiveWarning: sensitive
    })
  }, [activeOpenFile, addAttachment, conversation, onOpenFilePicker])

  const readExternalTextFile = useCallback(
    (file: File) => {
      if (!conversation) {
        return
      }
      if (file.type.startsWith('image/')) {
        readImageFileAsAttachment(file)
        return
      }
      if (file.size > MAX_EXTERNAL_TEXT_FILE_BYTES) {
        setPasteNotice(`${file.name} exceeds the 2 MB text file limit.`)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          return
        }
        if (reader.result.includes('\0')) {
          setPasteNotice(`${file.name} appears to be a binary file and cannot be attached as text.`)
          return
        }
        setPasteNotice(null)
        const sensitive = classifySensitiveFilePath(file.name, 'read-context') !== null
        addAttachment(conversation.id, {
          id: makeAttachmentId('ext'),
          kind: 'file',
          name: file.name,
          mimeType: file.type || 'text/plain',
          previewText: sensitive
            ? '[Sensitive file — explicit permission required]'
            : reader.result.slice(0, 8000),
          sensitiveWarning: sensitive
        })
      }
      reader.readAsText(file)
    },
    [addAttachment, conversation, readImageFileAsAttachment, setPasteNotice]
  )

  return {
    activeEditorHint,
    handleAttachActiveEditorContext,
    readExternalTextFile
  }
}
