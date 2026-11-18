import { useState } from 'react'
import { Check, FileCode2, ListChecks, Loader2, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/class-names'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { useAppStore } from '@/store'
import type {
  IdeProviderAgentOption,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'
import {
  formatIdeFileCount,
  formatIdeStepCount,
  getIdeChatCopy,
  getIdeComplexityLabel
} from './ide-chat-copy'
import {
  IdePlanFilesSection,
  IdePlanNotesDisclosure,
  IdePlanStepsSection
} from './IdePlanCardSections'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'
import { planStatusMeta } from './ide-plan-proposal-presentation'

export function IdePlanProposalCard({
  plan,
  conversationId,
  agentId,
  modelId,
  providers,
  compact = false,
  arabic: arabicOverride
}: {
  plan: IdeTaskPlan
  conversationId: string
  agentId: string
  modelId: string
  providers: IdeProviderAgentOption[]
  compact?: boolean
  arabic?: boolean
}) {
  const decidePlan = useIdeAgentStore((s) => s.decidePlan)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const conversation = useIdeAgentStore((s) =>
    s.activeConversation?.id === conversationId ? s.activeConversation : null
  )
  const setIdeSidebarView = useAppStore((s) => s.setIdeSidebarView)

  const [showRevision, setShowRevision] = useState(false)
  const [revisionNote, setRevisionNote] = useState('')
  const [busyDecision, setBusyDecision] = useState<string | null>(null)
  const [showAllFiles, setShowAllFiles] = useState(!compact)

  const arabic = Boolean(arabicOverride)
  const copy = getIdeChatCopy()
  const statusMeta = planStatusMeta(plan.status)
  const canDecide = plan.status === 'awaiting_approval' || plan.status === 'draft'
  const scratchWorkspace = conversation?.workspaceKey.startsWith('ide-scratch:') === true

  const modelChoices = providers.flatMap((provider) => {
    const models =
      provider.models.length > 0
        ? provider.models
        : [{ id: provider.defaultModelId, label: provider.defaultModelId }]
    return models.map((model) => ({
      value: `${provider.id}::${model.id}`,
      label: `${provider.label} · ${model.label}`
    }))
  })

  const handleDecision = async (decision: 'approve' | 'reject') => {
    setBusyDecision(decision)
    try {
      await decidePlan({
        conversationId,
        planId: plan.id,
        decision,
        ...(decision === 'approve' ? { agentId, modelId } : {})
      })
    } finally {
      setBusyDecision(null)
    }
  }

  const handleReviseSubmit = async () => {
    const trimmed = revisionNote.trim()
    if (!trimmed) {
      return
    }
    setBusyDecision('revise')
    try {
      const ok = await decidePlan({
        conversationId,
        planId: plan.id,
        decision: 'revise',
        revisionNote: trimmed,
        agentId,
        modelId
      })
      if (ok) {
        setShowRevision(false)
        setRevisionNote('')
      }
    } finally {
      setBusyDecision(null)
    }
  }

  const hasTrackedChanges = Boolean(
    conversation?.fileChanges.some((change) =>
      plan.affectedFiles.some((file) => file.path === change.relativePath)
    )
  )
  const canViewChanges =
    hasTrackedChanges || plan.status === 'executing' || plan.status === 'completed'

  const handleViewAffectedFiles = () => {
    setShowAllFiles(true)
    setIdeSidebarView('code-changes')
    const firstChange = conversation?.fileChanges.find((change) =>
      plan.affectedFiles.some((file) => file.path === change.relativePath)
    )
    if (firstChange) {
      openWorkspaceFileInEditor(firstChange.relativePath, undefined, scratchWorkspace)
    }
  }

  const summaryMeta = [
    plan.affectedFiles.length > 0 ? formatIdeFileCount(plan.affectedFiles.length, arabic) : '',
    plan.steps.length > 0 ? formatIdeStepCount(plan.steps.length, arabic) : '',
    getIdeComplexityLabel(plan.estimatedComplexity, arabic)
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      dir="ltr"
      data-testid="ide-plan-card"
      className="overflow-hidden rounded-xl border border-border bg-card text-left text-xs shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="font-semibold text-foreground"
            title={`Plan v${plan.version} (${plan.planHash.slice(0, 8)})`}
          >
            {copy.planTitle}
          </span>
          <span className="text-2xs tabular-nums text-muted-foreground">v{plan.version}</span>
          <Badge
            variant="outline"
            className={cn('rounded-full px-2 py-0 text-3xs font-medium', statusMeta.className)}
          >
            {statusMeta.label}
          </Badge>
        </div>

        {summaryMeta ? (
          <span className="text-2xs tabular-nums text-muted-foreground">{summaryMeta}</span>
        ) : null}
      </div>

      <div className="space-y-3 p-3.5">
        <p dir="auto" className="text-xs font-medium leading-relaxed text-foreground">
          {plan.objective}
        </p>

        <IdePlanFilesSection
          files={plan.affectedFiles}
          arabic={arabic}
          showAllFiles={showAllFiles}
          scratchWorkspace={scratchWorkspace}
          onShowAll={() => setShowAllFiles(true)}
        />

        <IdePlanStepsSection steps={plan.steps} arabic={arabic} />

        <IdePlanNotesDisclosure plan={plan} arabic={arabic} />

        {plan.approvalRecord ? (
          <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-2xs text-muted-foreground">
            {plan.approvalRecord.decision === 'approved' ? (
              <Check className="size-3 text-foreground" />
            ) : plan.approvalRecord.decision === 'rejected' ? (
              <X className="size-3 text-destructive" />
            ) : (
              <Pencil className="size-3 text-muted-foreground" />
            )}
            <span>
              {plan.approvalRecord.decision === 'approved'
                ? copy.decisionApproved
                : plan.approvalRecord.decision === 'rejected'
                  ? copy.decisionRejected
                  : copy.decisionRevision}{' '}
              ·{' '}
              <span className="tabular-nums">
                {new Date(plan.approvalRecord.decidedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </span>
          </div>
        ) : null}

        {showRevision ? (
          <div className="space-y-2 border-t border-border/50 pt-2.5">
            <Textarea
              dir="auto"
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder={copy.revisionPlaceholder}
              rows={3}
              className="min-h-16 text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={busyDecision !== null || !revisionNote.trim()}
                onClick={() => void handleReviseSubmit()}
              >
                {busyDecision === 'revise' ? <Loader2 className="size-3 animate-spin" /> : null}
                {copy.submitRevision}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2.5 text-xs text-muted-foreground"
                disabled={busyDecision !== null}
                onClick={() => setShowRevision(false)}
              >
                {copy.cancel}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {canDecide || canViewChanges ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {canDecide ? (
              <Button
                size="sm"
                className="h-7 px-3 text-xs"
                disabled={busyDecision !== null}
                onClick={() => void handleDecision('approve')}
                data-testid="ide-plan-approve-btn"
              >
                {busyDecision === 'approve' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
                {copy.approveAndExecute}
              </Button>
            ) : null}
            {canDecide ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs"
                disabled={busyDecision !== null}
                onClick={() => setShowRevision((prev) => !prev)}
                data-testid="ide-plan-revise-btn"
              >
                <Pencil className="size-3" />
                {copy.revisePlan}
              </Button>
            ) : null}
            {canDecide ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={busyDecision !== null}
                onClick={() => void handleDecision('reject')}
                data-testid="ide-plan-reject-btn"
              >
                <X className="size-3" />
                {copy.reject}
              </Button>
            ) : null}
            {canViewChanges ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleViewAffectedFiles}
              >
                <FileCode2 className="size-3" />
                {copy.viewChanges}
              </Button>
            ) : null}
          </div>

          {!compact && canDecide && modelChoices.length > 0 ? (
            <Select
              value={`${agentId}::${modelId}`}
              onValueChange={(value) => {
                const [nextAgentId, nextModelId] = value.split('::')
                if (nextAgentId && nextModelId) {
                  void updateSettings({
                    conversationId,
                    agentId: nextAgentId,
                    modelId: nextModelId
                  })
                }
              }}
            >
              <SelectTrigger size="sm" density="compact" className="h-7 max-w-[175px] text-2xs">
                <SelectValue placeholder={copy.changeModel} />
              </SelectTrigger>
              <SelectContent>
                {modelChoices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value} className="text-xs">
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
