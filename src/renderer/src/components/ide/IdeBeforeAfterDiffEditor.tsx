import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { ArrowDown, ArrowUp, Columns2, FoldVertical, Rows2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { usePluginSyntaxLanguage } from '@/components/editor/use-plugin-syntax-language'
import { useEditorTypography } from '@/hooks/use-editor-typography'
import { useMonacoTheme } from '@/hooks/use-monaco-theme'
import { cn } from '@/lib/class-names'
import { monacoTypographyOptions } from '@/lib/editor/appearance/editor-typography'
import {
  applyModelLanguage,
  PLUGIN_SYNTAX_EDITOR_OPTIONS
} from '@/lib/monaco-languages/plugin-syntax-editor-options'
import { useIdeDiffReviewStore } from '@/store/ide-agent/ide-diff-review-store'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import type { IdeFileChangeRecord } from '../../../../shared/ide-agent/ide-agent-types'
import { computeIdeDiffStats } from './ide-diff-calculation'

export function IdeBeforeAfterDiffEditor({
  change,
  onClose
}: {
  change: IdeFileChangeRecord
  onClose: () => void
}): React.JSX.Element {
  const diffLayout = useIdeDiffReviewStore((s) => s.diffLayout)
  const setDiffLayout = useIdeDiffReviewStore((s) => s.setDiffLayout)
  const collapseUnchanged = useIdeDiffReviewStore((s) => s.collapseUnchanged)
  const setCollapseUnchanged = useIdeDiffReviewStore((s) => s.setCollapseUnchanged)

  const monacoTheme = useMonacoTheme()
  const diffTypography = useEditorTypography('diff')
  const coreLanguage = useMemo(() => detectLanguage(change.relativePath), [change.relativePath])
  const language = usePluginSyntaxLanguage(change.relativePath, coreLanguage)

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const [mountedRev, setMountedRev] = useState(0)

  const stats = useMemo(
    () => computeIdeDiffStats(change.beforeContent, change.afterContent),
    [change.afterContent, change.beforeContent]
  )

  useEffect(() => {
    const models = diffEditorRef.current?.getModel()
    applyModelLanguage([models?.original, models?.modified], language)
  }, [language, mountedRev, change.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleMount = useCallback<DiffOnMount>((diffEditor) => {
    diffEditorRef.current = diffEditor
    setMountedRev((v) => v + 1)
    const disposable = diffEditor.onDidUpdateDiff(() => {
      const changes = diffEditor.getLineChanges()
      if (changes && changes.length > 0) {
        const firstLine = Math.max(
          1,
          changes[0].modifiedStartLineNumber || changes[0].originalStartLineNumber || 1
        )
        diffEditor.revealLineInCenter(firstLine)
      }
      disposable.dispose()
    })
  }, [])

  const editorOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      ...monacoTypographyOptions(diffTypography),
      ...PLUGIN_SYNTAX_EDITOR_OPTIONS,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: diffLayout === 'split',
      useInlineViewWhenSpaceIsLimited: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      diffWordWrap: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      glyphMargin: false,
      hideUnchangedRegions: {
        enabled: collapseUnchanged,
        contextLineCount: 3,
        minimumLineCount: 4,
        revealLineCount: 20
      },
      padding: { top: 8, bottom: 12 }
    }),
    [collapseUnchanged, diffLayout, diffTypography]
  )

  const originalLabel =
    change.changeType === 'created' ? 'Empty (new file)' : 'Original (Before AI)'
  const modifiedLabel =
    change.changeType === 'deleted' ? 'Deleted (empty after)' : 'Proposed (After AI)'

  return (
    <div
      dir="ltr"
      data-testid="ide-before-after-diff-editor"
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--editor-surface)] text-left"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-3 py-1 text-2xs">
        <div className="flex min-w-0 items-center gap-2">
          <FileTypeIcon filePath={change.relativePath} className="size-3.5 shrink-0" />
          <span className="truncate font-mono font-medium text-foreground">
            {change.relativePath}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-2xs tabular-nums">
            <span className="font-medium text-chat-diff-added">+{stats.added}</span>
            <span className="font-medium text-chat-diff-removed">-{stats.removed}</span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => diffEditorRef.current?.goToDiff('previous')}
            aria-label="Previous change hunk"
            title="Previous change"
          >
            <ArrowUp className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => diffEditorRef.current?.goToDiff('next')}
            aria-label="Next change hunk"
            title="Next change"
          >
            <ArrowDown className="size-3" />
          </Button>

          <div className="mx-0.5 flex items-center rounded-md border border-border/70 bg-background p-0.5">
            <button
              type="button"
              onClick={() => setDiffLayout('split')}
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs font-medium transition-colors',
                diffLayout === 'split'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Side-by-side Before & After"
            >
              <Columns2 className="size-3" />
              <span>Side-by-Side</span>
            </button>
            <button
              type="button"
              onClick={() => setDiffLayout('inline')}
              className={cn(
                'inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs font-medium transition-colors',
                diffLayout === 'inline'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              title="Unified inline diff"
            >
              <Rows2 className="size-3" />
              <span>Inline</span>
            </button>
          </div>

          <Button
            size="xs"
            variant={collapseUnchanged ? 'secondary' : 'ghost'}
            onClick={() => setCollapseUnchanged(!collapseUnchanged)}
            title="Collapse unchanged code regions"
          >
            <FoldVertical className="size-3" />
            <span>Compact</span>
          </Button>

          <Button size="xs" variant="ghost" onClick={onClose} title="Close diff comparison (Esc)">
            <X className="size-3" />
            <span>Editor</span>
          </Button>
        </div>
      </div>

      {diffLayout === 'split' ? (
        <div className="grid shrink-0 grid-cols-2 border-b border-border/60 bg-card/40 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          <div className="flex items-center gap-1.5 border-r border-border/60 px-3 py-1">
            <span className="size-1.5 rounded-full bg-chat-diff-removed" />
            <span>Before · {originalLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1">
            <span className="size-1.5 rounded-full bg-chat-diff-added" />
            <span>After · {modifiedLabel}</span>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DiffEditor
          original={change.beforeContent ?? ''}
          modified={change.afterContent ?? ''}
          language={language}
          originalModelPath={`inmemory://ide-review-before/${encodeURIComponent(change.id)}/${change.relativePath}`}
          modifiedModelPath={`inmemory://ide-review-after/${encodeURIComponent(change.id)}/${change.relativePath}`}
          theme={monacoTheme}
          options={editorOptions}
          onMount={handleMount}
        />
      </div>
    </div>
  )
}
