import { useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/class-names'
import type {
  IdePlanFileAction,
  IdePlanStep,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'
import { getIdeChatCopy, getIdeFileActionLabel } from './ide-chat-copy'
import { fileActionIcon, stepStatusIcon } from './ide-plan-proposal-presentation'
import { openWorkspaceFileInEditor } from './ide-workspace-navigation'

function looksLikeShellCommand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 140 || trimmed.includes('\n')) {
    return false
  }
  return /^(?:pnpm|npm|yarn|bun|npx|node|vitest|jest|tsc|oxlint|oxfmt|pytest|python|cargo|go|make)\b/i.test(
    trimmed
  )
}

export function IdePlanFilesSection({
  files,
  arabic,
  showAllFiles,
  onShowAll
}: {
  files: readonly IdePlanFileAction[]
  arabic: boolean
  showAllFiles: boolean
  onShowAll: () => void
}) {
  if (files.length === 0) {
    return null
  }
  const copy = getIdeChatCopy(arabic)
  const visibleFiles = showAllFiles ? files : files.slice(0, 4)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-2xs font-medium text-muted-foreground">
        <span>
          {copy.filesTitle} ({files.length})
        </span>
        {files.length > 4 && !showAllFiles ? (
          <button
            type="button"
            className="text-2xs text-foreground underline underline-offset-2 hover:opacity-80"
            onClick={onShowAll}
          >
            {copy.showAllFiles(files.length)}
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        {visibleFiles.map((file) => (
          <button
            key={`${file.action}:${file.path}`}
            type="button"
            onClick={() => openWorkspaceFileInEditor(file.path)}
            className="flex w-full items-center justify-between gap-2.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-start transition-colors hover:bg-accent/60"
            title={file.summary || file.path}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {fileActionIcon(file.action)}
              <span dir="ltr" className="truncate font-mono text-2xs font-medium text-foreground">
                {file.path}
              </span>
              {file.summary ? (
                <span
                  dir="auto"
                  className="hidden truncate text-2xs text-muted-foreground sm:inline"
                >
                  — {file.summary}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-3xs font-medium text-muted-foreground">
              {getIdeFileActionLabel(file.action, arabic)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function IdePlanStepsSection({
  steps,
  arabic
}: {
  steps: readonly IdePlanStep[]
  arabic: boolean
}) {
  const [showStepDetails, setShowStepDetails] = useState(false)
  if (steps.length === 0) {
    return null
  }
  const copy = getIdeChatCopy(arabic)
  const completedSteps = steps.filter((s) => s.status === 'completed').length
  const hasStepDetails = steps.some((step) => step.detail && step.detail !== step.title)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-2xs font-medium text-muted-foreground">
        <span className="tabular-nums">
          {copy.stepsTitle} ({completedSteps}/{steps.length})
        </span>
        {hasStepDetails ? (
          <button
            type="button"
            className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setShowStepDetails((prev) => !prev)}
          >
            {showStepDetails ? copy.hideStepDetails : copy.showStepDetails}
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        {steps.map((step) => {
          const detailVisible =
            step.detail &&
            step.detail !== step.title &&
            (showStepDetails || step.status === 'in_progress')
          return (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-2 rounded-lg px-2 py-1 transition-colors',
                step.status === 'in_progress' && 'bg-accent/50'
              )}
            >
              <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div dir="auto" className="text-xs font-medium leading-snug text-foreground">
                  <span className="tabular-nums text-muted-foreground">{step.index + 1}. </span>
                  {step.title}
                </div>
                {detailVisible ? (
                  <div dir="auto" className="text-2xs leading-relaxed text-muted-foreground">
                    {step.detail}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function toKeyedItems(items: readonly string[]): { key: string; value: string }[] {
  const seen = new Map<string, number>()
  return items.map((value) => {
    const count = (seen.get(value) ?? 0) + 1
    seen.set(value, count)
    return { key: count === 1 ? value : `${value}#${count}`, value }
  })
}

export function IdePlanNotesDisclosure({
  plan,
  arabic
}: {
  plan: Pick<IdeTaskPlan, 'risks' | 'testsAndVerification' | 'status'>
  arabic: boolean
}) {
  const [expanded, setExpanded] = useState(plan.status === 'failed')
  const notesCount = plan.risks.length + plan.testsAndVerification.length
  if (notesCount === 0) {
    return null
  }
  const copy = getIdeChatCopy(arabic)
  const keyedRisks = toKeyedItems(plan.risks)
  const keyedChecks = toKeyedItems(plan.testsAndVerification)

  return (
    <div className="border-t border-border/50 pt-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          {plan.risks.length > 0 ? <AlertTriangle className="size-3 text-amber-500" /> : null}
          <span>{copy.notesAndVerification(notesCount)}</span>
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-150',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2.5 rounded-lg bg-muted/30 p-2.5">
          {keyedRisks.length > 0 ? (
            <div className="space-y-1">
              <div className="text-2xs font-medium text-foreground">{copy.risksLabel}</div>
              <ul className="list-disc space-y-1 ps-4 text-2xs leading-relaxed text-muted-foreground">
                {keyedRisks.map((risk) => (
                  <li key={risk.key} dir="auto">
                    {risk.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {keyedChecks.length > 0 ? (
            <div className="space-y-1">
              <div className="text-2xs font-medium text-foreground">{copy.verificationLabel}</div>
              <ul className="list-disc space-y-1 ps-4 text-2xs leading-relaxed text-muted-foreground">
                {keyedChecks.map((check) => (
                  <li key={check.key} dir="auto">
                    {looksLikeShellCommand(check.value) ? (
                      <code
                        dir="ltr"
                        className="rounded border border-border/60 bg-background px-1.5 py-0.5 font-mono text-2xs text-foreground"
                      >
                        {check.value}
                      </code>
                    ) : (
                      check.value
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
