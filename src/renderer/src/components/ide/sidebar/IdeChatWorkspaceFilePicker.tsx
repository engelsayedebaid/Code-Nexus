import { useEffect, useMemo, useState } from 'react'
import { Braces, FileCode2, Folder, TextSelect } from 'lucide-react'
import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/class-names'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import { useAppStore } from '@/store'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'

type PickerTab = 'all' | 'files' | 'folders' | 'symbols'

type PickerEntry =
  | { id: string; kind: 'selection'; label: string; detail: string; relativePath: string }
  | {
      id: string
      kind: 'file'
      label: string
      detail?: string
      relativePath: string
      isOpen?: boolean
    }
  | { id: string; kind: 'folder'; label: string; relativePath: string }
  | {
      id: string
      kind: 'symbol'
      label: string
      detail: string
      relativePath: string
      line: number
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
  initialQuery = ''
}: {
  workspacePath: string | null
  worktreeId?: string | null
  onAttach: (attachment: IdeChatAttachment) => void
  onClose: () => void
  onBrowseDisk: () => void
  initialQuery?: string
}) {
  const openFiles = useAppStore((s) => s.openFiles)
  const [tab, setTab] = useState<PickerTab>('all')
  const [editedQuery, setEditedQuery] = useState<{ base: string; value: string } | null>(null)
  const fileSearch =
    editedQuery !== null && editedQuery.base === initialQuery ? editedQuery.value : initialQuery
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [symbolHits, setSymbolHits] = useState<
    { symbol: string; relativePath: string; line: number }[]
  >([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (!workspacePath || !window.api?.fs?.listFiles) {
      return
    }
    let cancelled = false
    const token = `ide-chat-files-${Date.now()}`
    setLoadingFiles(true)
    void window.api.fs
      .listFiles({
        rootPath: workspacePath,
        maxResults: 140,
        searchQuery: fileSearch.trim() || undefined,
        requestToken: token
      })
      .then((files) => {
        if (!cancelled) {
          setWorkspaceFiles(files)
          setLoadingFiles(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceFiles([])
          setLoadingFiles(false)
        }
      })
    return () => {
      cancelled = true
      void window.api?.fs?.cancelListFiles?.({ requestToken: token })
    }
  }, [workspacePath, fileSearch])

  useEffect(() => {
    const q = fileSearch.trim()
    if (
      !workspacePath ||
      !window.api?.fs?.search ||
      q.length < 2 ||
      (tab !== 'all' && tab !== 'symbols')
    ) {
      setSymbolHits([])
      return
    }
    let cancelled = false
    const token = `ide-chat-sym-${Date.now()}`
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    void window.api.fs
      .search({
        rootPath: workspacePath,
        query: `(?:function|class|interface|type|const|def|struct|func)\\s+[A-Za-z0-9_$]*${escaped}`,
        useRegex: true,
        maxResults: 20,
        requestToken: token
      })
      .then((res) => {
        if (cancelled) {
          return
        }
        const parsed: { symbol: string; relativePath: string; line: number }[] = []
        for (const fileRes of res.files ?? []) {
          for (const m of fileRes.matches ?? []) {
            const symMatch = m.lineContent?.match(
              /(?:function|class|interface|type|const|def|struct|func)\s+([A-Za-z0-9_$]+)/
            )
            if (symMatch?.[1]) {
              parsed.push({
                symbol: symMatch[1],
                relativePath: normalizeWorkspaceRelativePath(fileRes.relativePath),
                line: m.line
              })
            }
          }
        }
        setSymbolHits(parsed.slice(0, 12))
      })
      .catch(() => {
        if (!cancelled) {
          setSymbolHits([])
        }
      })
    return () => {
      cancelled = true
      void window.api?.fs?.cancelSearch?.({ requestToken: token })
    }
  }, [workspacePath, fileSearch, tab])

  const entries = useMemo<PickerEntry[]>(() => {
    const items: PickerEntry[] = []
    const q = fileSearch.trim().toLowerCase()
    const selection = getActiveIdeEditorSelection()
    if (selection && (tab === 'all' || tab === 'files') && (!q || 'selection'.includes(q))) {
      items.push({
        id: 'selection:active',
        kind: 'selection',
        label: `Selection in ${selection.relativePath}`,
        detail: `L${selection.startLine}-${selection.endLine}`,
        relativePath: selection.relativePath
      })
    }

    const openRelSet = new Set(
      openFiles
        .filter((f) => (!worktreeId || f.worktreeId === worktreeId) && f.relativePath)
        .map((f) => normalizeWorkspaceRelativePath(f.relativePath))
    )

    if (tab === 'all' || tab === 'folders') {
      const folderSet = new Set<string>()
      for (const f of workspaceFiles) {
        const clean = normalizeWorkspaceRelativePath(f)
        const parts = clean.split('/')
        for (let i = 1; i < parts.length; i += 1) {
          const dir = parts.slice(0, i).join('/')
          if (!q || dir.toLowerCase().includes(q)) {
            folderSet.add(dir)
          }
        }
      }
      for (const dir of Array.from(folderSet).slice(0, tab === 'folders' ? 40 : 6)) {
        items.push({ id: `dir:${dir}`, kind: 'folder', label: `${dir}/`, relativePath: dir })
      }
    }

    if (tab === 'all' || tab === 'symbols') {
      for (const sym of symbolHits) {
        items.push({
          id: `sym:${sym.relativePath}:${sym.line}:${sym.symbol}`,
          kind: 'symbol',
          label: sym.symbol,
          detail: `${sym.relativePath}:${sym.line}`,
          relativePath: sym.relativePath,
          line: sym.line
        })
      }
    }

    if (tab === 'all' || tab === 'files') {
      const openMatches = Array.from(openRelSet).filter((f) => !q || f.toLowerCase().includes(q))
      for (const f of openMatches) {
        items.push({
          id: `open:${f}`,
          kind: 'file',
          label: f,
          detail: 'Open',
          relativePath: f,
          isOpen: true
        })
      }
      for (const f of workspaceFiles) {
        const clean = normalizeWorkspaceRelativePath(f)
        if (!openRelSet.has(clean)) {
          items.push({ id: `file:${clean}`, kind: 'file', label: clean, relativePath: clean })
        }
      }
    }
    return items.slice(0, 80)
  }, [fileSearch, openFiles, symbolHits, tab, worktreeId, workspaceFiles])

  useEffect(() => {
    setSelectedIndex(0)
  }, [entries.length, tab])

  const attachEntry = async (entry: PickerEntry) => {
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
  }

  return (
    <div className="space-y-1.5 border-t border-border/60 bg-muted/20 p-2">
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
          placeholder="Search files, folders, symbols, or selection..."
          className="h-7 flex-1 text-xs"
          autoFocus
        />
        <Button size="xs" variant="outline" className="h-7 px-2 text-2xs" onClick={onBrowseDisk}>
          Disk...
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close context picker">
          <AppIcon name="close" size="xs" />
        </Button>
      </div>

      <div className="flex items-center gap-1 text-3xs">
        {(['all', 'files', 'folders', 'symbols'] as PickerTab[]).map((t) => (
          <button
            key={t}
            type="button"
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
              onClick={() => void attachEntry(entry)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left font-mono text-2xs text-foreground transition-colors',
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
                <span className="truncate">{entry.label}</span>
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
