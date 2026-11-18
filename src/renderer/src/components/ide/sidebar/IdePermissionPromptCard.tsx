import { useState } from 'react'
import { AppIcon } from '@/components/icons/app-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdePermissionRequest } from '../../../../../shared/ide-agent/ide-agent-types'

export function IdePermissionPromptCard({
  permission,
  conversationId
}: {
  permission: IdePermissionRequest
  conversationId: string
}) {
  const decidePermission = useIdeAgentStore((s) => s.decidePermission)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleDecision = async (decision: 'approve' | 'deny') => {
    setBusy(true)
    try {
      await decidePermission({
        conversationId,
        permissionId: permission.id,
        decision,
        ...(note.trim() ? { note: note.trim() } : {})
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="ide-permission-card"
      className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs shadow-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <AppIcon name="security" size="xs" className="text-muted-foreground" />
          <span dir="auto">{permission.title}</span>
        </div>
        <Badge variant="referenceLabel">{permission.kind}</Badge>
      </div>
      <p dir="auto" className="leading-relaxed text-muted-foreground">
        {permission.detail}
      </p>
      {permission.targetPath ? (
        <div
          dir="ltr"
          className="break-all rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-2xs text-foreground"
        >
          {permission.targetPath}
        </div>
      ) : null}
      {permission.command ? (
        <pre
          dir="ltr"
          className="scrollbar-sleek overflow-x-auto rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-2xs text-foreground"
        >
          {permission.command}
        </pre>
      ) : null}
      {permission.status === 'pending' ? (
        <div className="space-y-2 pt-1">
          <Textarea
            dir="auto"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note or guidance..."
            className="min-h-12 text-xs"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={busy}
              onClick={() => void handleDecision('approve')}
            >
              <AppIcon name="confirm" className="size-3" />
              Approve once
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={busy}
              onClick={() => void handleDecision('deny')}
            >
              <AppIcon name="close" className="size-3" />
              Deny
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-2xs font-medium text-muted-foreground">
          Permission {permission.status}
          {permission.note ? ` · ${permission.note}` : ''}
        </div>
      )}
    </div>
  )
}
