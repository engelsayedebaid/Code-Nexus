import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { Braces, FileCode2, Folder, TextSelect } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'
import {
  useIdeWorkspacePickerEntries,
  type PickerEntry,
  type PickerTab
} from './use-ide-workspace-picker-entries'

export type IdeWorkspaceFilePickerHandle = {
  moveSelection: (delta: number) => void
  selectCurrent: () => boolean
}

function makeAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function IdeChatWorkspaceFilePicker({
  workspacePath,
  worktreeId,
  onAttach,
  onClose,
  onBrowseDisk,
  initialQuery = '',
  inlineMention = false,
  pickerRef
}: {
  workspacePath: string | null
  worktreeId?: string | null
  onAttach: (attachment: IdeChatAttachment) => void
  onClose: () => void
  onBrowseDisk: () => void
  initialQuery?: string
  inlineMention?: boolean
  pickerRef?: Ref<IdeWorkspaceFilePickerHandle>
}) {
  const [tab, setTab] = useState<PickerTab>('all')
  const [editedQuery, setEditedQuery] = useState<{ base: string; value: string } | null>(null)
  const fileSearch =
    editedQuery !== null && editedQuery.base === initialQuery ? editedQuery.value : initialQuery
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { entries, loadingFiles } = useIdeWorkspacePickerEntries({
    workspacePath,
    worktreeId,
    fileSearch,
    tab
  })

  useEffect(() => {
    setSelectedIndex(0)
  }, [entries.length, tab])

  const attachEntry = useCallback(
    async (entry: PickerEntry) => {
      if (entry.kind === 'selection') {
        const sel = getActiveIdeEditorSelection()
        if (sel) {
          onAttach({
            id: makeAttachmentId('sel'),
            kind: 'selection',
            name: `${sel.relativePath}:${sel.startLine}-${sel.endLine}`,
            relativePath: sel.relativePath,
            lineRange: { start: sel.startLine, end: sel.endLine },
            previewText: sel.text
          })
        }
        onClose()
        return
      }
      if (entry.kind === 'folder') {
        onAttach({
          id: makeAttachmentId('dir'),
          kind: 'folder',
          name: `${entry.relativePath}/`,
          relativePath: entry.relativePath
        })
        onClose()
        return
      }
      const cleanRel = normalizeWorkspaceRelativePath(entry.relativePath)
      const sensitive = classifySensitiveFilePath(cleanRel, 'read-context') !== null
      let previewText: string | undefined
      if (workspacePath && window.api?.fs?.readFile) {
        try {
          const useBackslash = /^[A-Za-z]:\\/.test(workspacePath) || workspacePath.includes('\\')
          const fullPath = `${workspacePath.replace(/[\\/]+$/, '')}${useBackslash ? '\\' : '/'}${
            useBackslash ? cleanRel.replaceAll('/', '\\') : cleanRel
          }`
          const result = await window.api.fs.readFile({ filePath: fullPath })
          if (!result.isBinary && typeof result.content === 'string') {
            if (sensitive) {
              previewText = '[Sensitive file — redacted until explicit send permission]'
            } else if (entry.kind === 'symbol') {
              const lines = result.content.split(/\r?\n/)
              const from = Math.max(1, entry.line - 5)
              const to = Math.min(lines.length, entry.line + 40)
              previewText = lines.slice(from - 1, to).join('\n')
            } else {
              previewText = result.content.slice(0, 6000)
            }
          }
        } catch {
          // Gateway reads authorized file when needed
        }
      }
      onAttach({
        id: makeAttachmentId(entry.kind === 'symbol' ? 'sym' : 'file'),
        kind: entry.kind === 'symbol' ? 'symbol' : 'file',
        name: entry.kind === 'symbol' ? entry.label : (cleanRel.split('/').pop() ?? cleanRel),
        relativePath: cleanRel,
        ...(entry.kind === 'symbol'
          ? { symbolName: entry.label, lineRange: { start: entry.line, end: entry.line } }
          : {}),
        previewText,
        sensitiveWarning: sensitive
      })
      onClose()
    },
    [onAttach, onClose, workspacePath]
  )

  useImperativeHandle(
    pickerRef,
    () => ({
      moveSelection: (delta: number) => {
        setSelectedIndex((prev) => {
          if (entries.length === 0) {
            return 0
          }
          return Math.max(0, Math.min(entries.length - 1, prev + delta))
        })
      },
      selectCurrent: () => {
        const chosen = entries[selectedIndex]
        if (!chosen) {
          return false
        }
        void attachEntry(chosen)
        return true
      }
    }),
    [attachEntry, entries, selectedIndex]
  )

  return (
    <div className="mx-3 mb-1 space-y-1.5 rounded-lg border border-border bg-popover p-2 shadow-sm">
      {!inlineMention ? (
        <div className="flex items-center justify-between gap-1.5">
          <Input
            value={fileSearch}
            onChange={(e) => setEditedQuery({ base: initialQuery, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex((i) => Math.min(entries.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter' && entries[selectedIndex]) {
                e.preventDefault()
                void attachEntry(entries[selectedIndex])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="Search files, folders, symbols..."
            density="compact"
            className="flex-1"
            autoFocus
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              onBrowseDisk()
              onClose()
            }}
          >
            Disk...
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label="Close context picker"
          >
            <AppIcon name="close" size="xs" />
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-1 text-3xs">
        <div className="flex items-center gap-1">
          {(['all', 'files', 'folders', 'symbols'] as PickerTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-full px-2 py-0.5 capitalize transition-colors',
                tab === t
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {inlineMention ? (
          <span className="font-mono text-3xs text-muted-foreground">↑↓ · Enter</span>
        ) : null}
      </div>

      <div className="scrollbar-sleek max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border/60 bg-background p-1">
        {loadingFiles && entries.length === 0 ? (
          <div className="px-2 py-2 text-2xs text-muted-foreground">Scanning workspace...</div>
        ) : entries.length === 0 ? (
          <div className="px-2 py-2 text-2xs text-muted-foreground">No matching context found.</div>
        ) : (
          entries.map((entry, idx) => (
            <button
              key={entry.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void attachEntry(entry)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-start font-mono text-2xs text-foreground transition-colors',
                idx === selectedIndex ? 'bg-accent' : 'hover:bg-accent/60'
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {entry.kind === 'folder' ? (
                  <Folder className="size-3 shrink-0 text-muted-foreground" />
                ) : entry.kind === 'symbol' ? (
                  <Braces className="size-3 shrink-0 text-muted-foreground" />
                ) : entry.kind === 'selection' ? (
                  <TextSelect className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span dir="ltr" className="truncate">
                  {entry.label}
                </span>
              </span>
              {entry.kind !== 'folder' && entry.detail ? (
                <span className="shrink-0 font-sans text-3xs text-muted-foreground">
                  {entry.detail}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
