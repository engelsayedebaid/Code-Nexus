import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../../shared/ide-agent/ide-plan-policy'

function makeAttachmentId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function IdeChatWorkspaceFilePicker({
  workspacePath,
  onAttach,
  onClose,
  onBrowseDisk,
  initialQuery = ''
}: {
  workspacePath: string | null
  onAttach: (attachment: IdeChatAttachment) => void
  onClose: () => void
  onBrowseDisk: () => void
  initialQuery?: string
}) {
  const [fileSearch, setFileSearch] = useState(initialQuery)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])
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
        maxResults: 120,
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

  const attachWorkspaceRelativeFile = async (rawRel: string) => {
    const cleanRel = normalizeWorkspaceRelativePath(rawRel)
    if (!cleanRel) {
      return
    }
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
          previewText = sensitive
            ? '[Sensitive file — redacted until explicit send permission]'
            : result.content.slice(0, 6000)
        }
      } catch {
        // Backend gateway still reads authorized files when needed
      }
    }
    onAttach({
      id: makeAttachmentId('file'),
      kind: 'file',
      name: cleanRel.split('/').pop() ?? cleanRel,
      relativePath: cleanRel,
      previewText,
      sensitiveWarning: sensitive
    })
    onClose()
  }

  return (
    <div className="border-t border-border/60 bg-muted/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <Input
          value={fileSearch}
          onChange={(e) => setFileSearch(e.target.value)}
          placeholder="Search workspace files to attach..."
          className="h-7 flex-1 text-xs"
          autoFocus
        />
        <Button size="xs" variant="outline" className="h-7 px-2 text-[11px]" onClick={onBrowseDisk}>
          Disk...
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close file picker">
          <AppIcon name="close" size="xs" />
        </Button>
      </div>
      <div className="scrollbar-sleek max-h-36 overflow-y-auto space-y-0.5 rounded-md border border-border/60 bg-background p-1">
        {loadingFiles ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">Scanning files...</div>
        ) : workspaceFiles.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">No files found.</div>
        ) : (
          workspaceFiles.map((filePath) => (
            <button
              key={filePath}
              type="button"
              onClick={() => void attachWorkspaceRelativeFile(filePath)}
              className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-[11px] text-foreground hover:bg-accent/60"
            >
              <span className="truncate">{filePath}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
