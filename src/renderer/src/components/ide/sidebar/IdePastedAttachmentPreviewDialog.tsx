import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Copy, ListOrdered } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import type { IdeChatAttachment } from '../../../../../shared/ide-agent/ide-agent-types'
import { formatSmartAttachmentSize } from '../../../../../shared/smart-paste/smart-paste-config'

type ReadAttachmentPageReply = {
  exists: boolean
  attachmentId: string
  content: string
  startLine: number
  endLine: number
  totalLines: number
  sizeBytes: number
  charCount: number
  hasMore: boolean
}

const PAGE_LINE_SIZE = 1000

export function IdePastedAttachmentPreviewDialog({
  conversationId,
  attachment,
  displayName,
  fallbackText,
  onClose
}: {
  conversationId: string
  attachment: IdeChatAttachment | null
  displayName?: string
  fallbackText?: string
  onClose: () => void
}) {
  const [content, setContent] = useState('')
  const [totalLines, setTotalLines] = useState(0)
  const [loadedEndLine, setLoadedEndLine] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [missing, setMissing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showLineNumbers, setShowLineNumbers] = useState(true)
  const [dirMode, setDirMode] = useState<'auto' | 'ltr' | 'rtl'>('auto')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!attachment) {
      return
    }
    let cancelled = false
    setContent('')
    setLoadedEndLine(0)
    setTotalLines(attachment.lineCount ?? 0)
    setHasMore(false)
    setSizeBytes(attachment.sizeBytes ?? null)
    setMissing(attachment.status === 'missing')
    setErrorMessage(null)
    setCopied(false)

    if (attachment.status === 'missing') {
      return
    }
    setLoading(true)
    void callRuntimeRpc<ReadAttachmentPageReply>(
      { kind: 'local' },
      'ideAgent.readAttachmentContent',
      {
        conversationId,
        attachmentId: attachment.id,
        startLine: 1,
        endLine: PAGE_LINE_SIZE
      },
      { timeoutMs: 12_000, skipCompatibilityCheck: true }
    )
      .then((reply) => {
        if (cancelled) {
          return
        }
        if (!reply || !reply.exists) {
          if (fallbackText !== undefined) {
            setContent(fallbackText)
            setTotalLines(attachment.lineCount ?? fallbackText.split(/\r?\n/).length)
            setHasMore(false)
            setMissing(false)
          } else {
            setMissing(true)
          }
          return
        }
        setContent(reply.content)
        setTotalLines(reply.totalLines)
        setLoadedEndLine(reply.endLine)
        setHasMore(reply.hasMore)
        setSizeBytes(reply.sizeBytes)
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        if (fallbackText !== undefined) {
          setContent(fallbackText)
          setTotalLines(attachment.lineCount ?? fallbackText.split(/\r?\n/).length)
          setHasMore(false)
          return
        }
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to read attachment content.'
        )
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [attachment, conversationId, fallbackText])

  const loadNextPage = useCallback(async () => {
    if (!attachment || loadingMore || !hasMore) {
      return
    }
    setLoadingMore(true)
    try {
      const nextStart = loadedEndLine + 1
      const reply = await callRuntimeRpc<ReadAttachmentPageReply>(
        { kind: 'local' },
        'ideAgent.readAttachmentContent',
        {
          conversationId,
          attachmentId: attachment.id,
          startLine: nextStart,
          endLine: nextStart + PAGE_LINE_SIZE - 1
        },
        { timeoutMs: 12_000, skipCompatibilityCheck: true }
      )
      if (!reply || !reply.exists) {
        setMissing(true)
        return
      }
      setContent((prev) => (prev ? `${prev}\n${reply.content}` : reply.content))
      setLoadedEndLine(reply.endLine)
      setTotalLines(reply.totalLines)
      setHasMore(reply.hasMore)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed loading remaining attachment lines.'
      )
    } finally {
      setLoadingMore(false)
    }
  }, [attachment, conversationId, hasMore, loadedEndLine, loadingMore])

  const handleCopy = useCallback(async () => {
    if (!content) {
      return
    }
    try {
      if (window.api?.ui?.writeClipboardText) {
        await window.api.ui.writeClipboardText(content)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Ignore clipboard unavailability
    }
  }, [content])

  const lines = useMemo(() => (content ? content.split(/\r\n|\n|\r/) : []), [content])

  if (!attachment) {
    return null
  }

  const title = displayName ?? (attachment.name || 'Pasted text')
  const metaParts = [
    attachment.format ? attachment.format.toUpperCase() : 'Text',
    sizeBytes !== null ? formatSmartAttachmentSize(sizeBytes) : null,
    totalLines > 0 ? `${totalLines.toLocaleString()} lines` : null
  ].filter(Boolean)

  return (
    <Dialog open={Boolean(attachment)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[82vh] max-h-[calc(100vh-2rem)] min-h-0 w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader className="mr-8 min-w-0 shrink-0 text-left">
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription>
            {metaParts.join(' · ') || 'Text attachment'}
            {attachment.truncatedInPrompt ? ' · Partial context sent in initial prompt' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!content || loading}
            onClick={() => void handleCopy()}
          >
            {copied ? <Check className="mr-1.5 size-3.5" /> : <Copy className="mr-1.5 size-3.5" />}
            {copied ? 'Copied' : 'Copy contents'}
          </Button>
          <Button
            type="button"
            variant={showLineNumbers ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowLineNumbers((prev) => !prev)}
          >
            <ListOrdered className="mr-1.5 size-3.5" />
            Line numbers
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDirMode((prev) => (prev === 'auto' ? 'ltr' : prev === 'ltr' ? 'rtl' : 'auto'))
            }
          >
            Dir: {dirMode.toUpperCase()}
          </Button>
        </div>

        {missing ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            <AlertCircle className="size-4 shrink-0" />
            <span>This pasted attachment is no longer available on disk.</span>
          </div>
        ) : errorMessage ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            Loading attachment content…
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed">
            <div className="min-w-fit space-y-0.5">
              {lines.map((line, index) => (
                <div key={index} className="flex items-start gap-3">
                  {showLineNumbers ? (
                    <span className="w-10 shrink-0 select-none text-right tabular-nums text-muted-foreground/60">
                      {index + 1}
                    </span>
                  ) : null}
                  <span dir={dirMode} className="whitespace-pre break-normal text-foreground">
                    {line || '\u00a0'}
                  </span>
                </div>
              ))}
            </div>
            {hasMore ? (
              <div className="pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadNextPage()}
                >
                  {loadingMore
                    ? 'Loading more…'
                    : `Load next lines (${loadedEndLine.toLocaleString()} of ${totalLines.toLocaleString()} shown)`}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
