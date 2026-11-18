import { useEffect, useMemo, useState } from 'react'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import { useAppStore } from '@/store'
import { normalizeWorkspaceRelativePath } from '../../../../../shared/ide-agent/ide-plan-policy'

export type PickerTab = 'all' | 'files' | 'folders' | 'symbols'

export type PickerEntry =
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

export function useIdeWorkspacePickerEntries({
  workspacePath,
  worktreeId,
  fileSearch,
  tab
}: {
  workspacePath: string | null
  worktreeId?: string | null
  fileSearch: string
  tab: PickerTab
}): { entries: PickerEntry[]; loadingFiles: boolean } {
  const openFiles = useAppStore((s) => s.openFiles)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
  const [symbolHits, setSymbolHits] = useState<
    { symbol: string; relativePath: string; line: number }[]
  >([])
  const [loadingFiles, setLoadingFiles] = useState(false)

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

  return { entries, loadingFiles }
}
