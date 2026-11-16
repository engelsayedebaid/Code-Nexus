import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { editor } from 'monaco-editor'
import type { MarkdownDocument } from '../../../../shared/file-listing/file-document'
import {
  clearMarkdownDocCompletionDocuments,
  setMarkdownDocCompletionDocuments
} from './markdown-source-tools/monaco/monaco-markdown-doc-completions'
import type { MarkdownDocLinkDecorationController } from './markdown-source-tools/monaco/monaco-markdown-doc-link-decorations'
import { useAppStore } from '@/store'
import { buildGitConflictDecorations } from './monaco-conflict-decorations'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'

export type MonacoEditorDecorations = {
  markdownDocLinkDecorationsRef: MutableRefObject<MarkdownDocLinkDecorationController | null>
  conflictDecorationsRef: MutableRefObject<editor.IEditorDecorationsCollection | null>
  updateMarkdownCompletionDocuments: () => void
}

// Keep model-owned decorations together so swaps and unmounts release their resources.
export function useMonacoEditorDecorations(params: {
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>
  mountedEditor: editor.IStandaloneCodeEditor | null
  content: string
  language: string
  relativePath?: string
  markdownDocuments: MarkdownDocument[] | undefined
  conflictDecorationsEnabled: boolean
}): MonacoEditorDecorations {
  const {
    editorRef,
    mountedEditor,
    content,
    language,
    relativePath,
    markdownDocuments,
    conflictDecorationsEnabled
  } = params

  const ideActiveEditHighlight = useAppStore((s) => s.ideActiveEditHighlight)
  const ideFollowAgent = useAppStore((s) => s.ideFollowAgent)
  const completionOwnerRef = useRef(Symbol('markdown-completion'))
  const completionModelRef = useRef<editor.ITextModel | null>(null)
  const markdownDocLinkDecorationsRef = useRef<MarkdownDocLinkDecorationController | null>(null)
  const conflictDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const ideEditDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)

  const updateMarkdownCompletionDocuments = useCallback((): void => {
    const model = editorRef.current?.getModel() ?? null
    if (completionModelRef.current && completionModelRef.current !== model) {
      clearMarkdownDocCompletionDocuments(completionModelRef.current, completionOwnerRef.current)
    }
    completionModelRef.current = model
    if (!model) {
      return
    }
    if (language === 'markdown' && markdownDocuments) {
      setMarkdownDocCompletionDocuments(model, markdownDocuments, completionOwnerRef.current)
    } else {
      clearMarkdownDocCompletionDocuments(model, completionOwnerRef.current)
    }
  }, [editorRef, language, markdownDocuments])

  // The controller observes content edits; only language swaps lack that event and need this explicit refresh.
  useEffect(() => {
    markdownDocLinkDecorationsRef.current?.refresh()
  }, [language])

  useEffect(() => {
    const ed = mountedEditor
    if (!ed) {
      return
    }

    if (!conflictDecorationsEnabled) {
      conflictDecorationsRef.current?.clear()
      return
    }

    // Why: conflict markers are ordinary file text, so Monaco needs explicit decorations to keep unresolved blocks visible.
    const decorations = buildGitConflictDecorations(content)
    if (decorations.length === 0) {
      conflictDecorationsRef.current?.clear()
      return
    }
    if (!conflictDecorationsRef.current) {
      conflictDecorationsRef.current = ed.createDecorationsCollection(decorations)
      return
    }
    conflictDecorationsRef.current.set(decorations)
  }, [conflictDecorationsEnabled, content, mountedEditor])

  useEffect(() => {
    updateMarkdownCompletionDocuments()
  }, [updateMarkdownCompletionDocuments])

  useEffect(() => {
    const ed = mountedEditor
    if (!ed) {
      return
    }
    const model = ed.getModel()
    if (
      !model ||
      !relativePath ||
      !ideActiveEditHighlight ||
      normalizeWorkspaceRelativePath(ideActiveEditHighlight.relativePath).toLowerCase() !==
        normalizeWorkspaceRelativePath(relativePath).toLowerCase()
    ) {
      ideEditDecorationsRef.current?.clear()
      return
    }
    const maxLines = Math.max(1, model.getLineCount())
    const startLine = Math.max(1, Math.min(maxLines, ideActiveEditHighlight.startLine))
    const endLine = Math.max(startLine, Math.min(maxLines, ideActiveEditHighlight.endLine))
    const nextDecorations: editor.IModelDeltaDecoration[] = [
      {
        range: {
          startLineNumber: startLine,
          startColumn: 1,
          endLineNumber: endLine,
          endColumn: 1
        },
        options: {
          isWholeLine: true,
          className: 'orca-ide-agent-edit-line',
          linesDecorationsClassName: 'orca-ide-agent-edit-gutter',
          hoverMessage: { value: ideActiveEditHighlight.label }
        }
      }
    ]
    if (
      ideActiveEditHighlight.cursorLine &&
      (ideActiveEditHighlight.status === 'streaming' ||
        ideActiveEditHighlight.status === 'revealing')
    ) {
      const cLine = Math.max(1, Math.min(maxLines, ideActiveEditHighlight.cursorLine))
      const maxCol = model.getLineMaxColumn(cLine)
      const cCol = Math.max(1, Math.min(maxCol, ideActiveEditHighlight.cursorColumn ?? maxCol))
      nextDecorations.push({
        range: {
          startLineNumber: cLine,
          startColumn: cCol,
          endLineNumber: cLine,
          endColumn: cCol
        },
        options: {
          afterContentClassName: 'orca-ide-agent-caret'
        }
      })
    }
    if (!ideEditDecorationsRef.current) {
      ideEditDecorationsRef.current = ed.createDecorationsCollection(nextDecorations)
    } else {
      ideEditDecorationsRef.current.set(nextDecorations)
    }
    if (ideFollowAgent) {
      const targetLine = ideActiveEditHighlight.cursorLine
        ? Math.max(1, Math.min(maxLines, ideActiveEditHighlight.cursorLine))
        : endLine
      ed.revealRangeInCenterIfOutsideViewport({
        startLineNumber: startLine,
        startColumn: 1,
        endLineNumber: targetLine,
        endColumn: 1
      })
    }
  }, [ideActiveEditHighlight, ideFollowAgent, mountedEditor, relativePath])

  useEffect(() => {
    const completionOwner = completionOwnerRef.current
    return () => {
      if (completionModelRef.current) {
        clearMarkdownDocCompletionDocuments(completionModelRef.current, completionOwner)
      }
      markdownDocLinkDecorationsRef.current?.dispose()
      markdownDocLinkDecorationsRef.current = null
      conflictDecorationsRef.current?.clear()
      conflictDecorationsRef.current = null
      ideEditDecorationsRef.current?.clear()
      ideEditDecorationsRef.current = null
    }
  }, [])

  return {
    markdownDocLinkDecorationsRef,
    conflictDecorationsRef,
    updateMarkdownCompletionDocuments
  }
}
