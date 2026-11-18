import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  FileCode2,
  FileInput,
  FileMinus2,
  FilePlus2,
  FolderMinus,
  FolderPlus,
  Loader2,
  XCircle
} from 'lucide-react'
import type {
  IdePlanFileAction,
  IdePlanStep,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'

export function planStatusMeta(
  status: IdeTaskPlan['status'],
  _arabic = false
): {
  label: string
  className: string
} {
  switch (status) {
    case 'awaiting_approval':
      return {
        label: 'Awaiting Approval',
        className: 'border-border bg-secondary text-secondary-foreground'
      }
    case 'approved':
      return {
        label: 'Approved',
        className: 'border-border bg-muted/60 text-foreground'
      }
    case 'executing':
      return {
        label: 'Executing',
        className: 'border-border bg-accent text-foreground'
      }
    case 'completed':
      return {
        label: 'Completed',
        className: 'border-border bg-muted/60 text-foreground'
      }
    case 'rejected':
      return {
        label: 'Rejected',
        className: 'border-destructive/40 bg-destructive/10 text-destructive'
      }
    case 'failed':
      return {
        label: 'Failed',
        className: 'border-destructive/40 bg-destructive/10 text-destructive'
      }
    case 'superseded':
      return {
        label: 'Superseded',
        className: 'border-border bg-muted/50 text-muted-foreground'
      }
    default:
      return {
        label: 'Draft',
        className: 'border-border bg-muted/40 text-muted-foreground'
      }
  }
}

export function stepStatusIcon(status: IdePlanStep['status']): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-3.5 shrink-0 text-foreground" />
    case 'in_progress':
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground" />
    case 'failed':
      return <XCircle className="size-3.5 shrink-0 text-destructive" />
    case 'blocked':
      return <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" />
    case 'skipped':
      return <Clock className="size-3.5 shrink-0 text-muted-foreground" />
    default:
      return <Circle className="size-3.5 shrink-0 text-muted-foreground/70" />
  }
}

export function fileActionIcon(action: IdePlanFileAction['action']): React.JSX.Element {
  if (action === 'create') {
    return (
      <FilePlus2
        className="size-3 shrink-0"
        style={{ color: 'var(--git-decoration-added, currentColor)' }}
      />
    )
  }
  if (action === 'delete') {
    return <FileMinus2 className="size-3 shrink-0 text-destructive" />
  }
  if (action === 'mkdir') {
    return (
      <FolderPlus
        className="size-3 shrink-0"
        style={{ color: 'var(--git-decoration-added, currentColor)' }}
      />
    )
  }
  if (action === 'delete_folder') {
    return <FolderMinus className="size-3 shrink-0 text-destructive" />
  }
  if (action === 'rename') {
    return (
      <FileInput
        className="size-3 shrink-0"
        style={{ color: 'var(--git-decoration-renamed, currentColor)' }}
      />
    )
  }
  return (
    <FileCode2
      className="size-3 shrink-0"
      style={{ color: 'var(--git-decoration-modified, currentColor)' }}
    />
  )
}
