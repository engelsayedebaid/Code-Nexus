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
  arabic = false
): {
  label: string
  className: string
} {
  switch (status) {
    case 'awaiting_approval':
      return {
        label: arabic ? 'بانتظار الموافقة' : 'Awaiting Approval',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-500'
      }
    case 'approved':
      return {
        label: arabic ? 'معتمدة' : 'Approved',
        className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
      }
    case 'executing':
      return {
        label: arabic ? 'قيد التنفيذ' : 'Executing',
        className: 'border-sky-500/40 bg-sky-500/10 text-sky-500'
      }
    case 'completed':
      return {
        label: arabic ? 'مكتملة' : 'Completed',
        className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
      }
    case 'rejected':
      return {
        label: arabic ? 'مرفوضة' : 'Rejected',
        className: 'border-destructive/40 bg-destructive/10 text-destructive'
      }
    case 'failed':
      return {
        label: arabic ? 'فشل التنفيذ' : 'Failed',
        className: 'border-destructive/40 bg-destructive/10 text-destructive'
      }
    case 'superseded':
      return {
        label: arabic ? 'مُحدّثة' : 'Superseded',
        className: 'border-border bg-muted/50 text-muted-foreground'
      }
    default:
      return {
        label: arabic ? 'مسودة' : 'Draft',
        className: 'border-border bg-muted/40 text-muted-foreground'
      }
  }
}

export function stepStatusIcon(status: IdePlanStep['status']): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
    case 'in_progress':
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-500" />
    case 'failed':
      return <XCircle className="size-3.5 shrink-0 text-destructive" />
    case 'blocked':
      return <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
    case 'skipped':
      return <Clock className="size-3.5 shrink-0 text-muted-foreground" />
    default:
      return <Circle className="size-3.5 shrink-0 text-muted-foreground/70" />
  }
}

export function fileActionIcon(action: IdePlanFileAction['action']): React.JSX.Element {
  if (action === 'create') {
    return <FilePlus2 className="size-3 shrink-0 text-emerald-500" />
  }
  if (action === 'delete') {
    return <FileMinus2 className="size-3 shrink-0 text-destructive" />
  }
  if (action === 'mkdir') {
    return <FolderPlus className="size-3 shrink-0 text-emerald-500" />
  }
  if (action === 'delete_folder') {
    return <FolderMinus className="size-3 shrink-0 text-destructive" />
  }
  if (action === 'rename') {
    return <FileInput className="size-3 shrink-0 text-amber-500" />
  }
  return <FileCode2 className="size-3 shrink-0 text-sky-500" />
}
