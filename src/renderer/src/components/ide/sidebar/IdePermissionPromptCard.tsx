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
      className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium text-amber-500">
          <AppIcon name="warning" size="xs" />
          <span>{permission.title}</span>
        </div>
        <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-500">
          {permission.kind}
        </Badge>
      </div>
      <p className="text-muted-foreground leading-relaxed">{permission.detail}</p>
      {permission.targetPath ? (
        <div className="rounded bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground break-all">
          {permission.targetPath}
        </div>
      ) : null}
      {permission.command ? (
        <pre className="scrollbar-sleek overflow-x-auto rounded bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground">
          {permission.command}
        </pre>
      ) : null}
      {permission.status === 'pending' ? (
        <div className="space-y-2 pt-1">
          <Textarea
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
              <AppIcon name="confirm" className="mr-1 size-3" />
              Approve once
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={busy}
              onClick={() => void handleDecision('deny')}
            >
              <AppIcon name="close" className="mr-1 size-3" />
              Deny
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-[11px] font-medium text-muted-foreground">
          Permission {permission.status}
          {permission.note ? ` · ${permission.note}` : ''}
        </div>
      )}
    </div>
  )
}
