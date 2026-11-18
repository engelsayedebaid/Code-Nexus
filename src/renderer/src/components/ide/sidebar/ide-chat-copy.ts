import type {
  IdeExecutionMode,
  IdePlanFileAction,
  IdeRunStatus,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'

export function formatIdeFileCount(count: number, _arabic?: boolean): string {
  return count === 1 ? '1 file' : `${count} files`
}

export function formatIdeStepCount(count: number, _arabic?: boolean): string {
  return count === 1 ? '1 step' : `${count} steps`
}

export function getIdeModeLabel(mode: IdeExecutionMode, _arabic?: boolean): string {
  switch (mode) {
    case 'ask':
      return 'Ask'
    case 'plan':
      return 'Plan'
    case 'review':
      return 'Review'
    default:
      return 'Agent'
  }
}

export function getIdeModeDescription(mode: IdeExecutionMode, _arabic?: boolean): string {
  switch (mode) {
    case 'ask':
      return 'Read-only Q&A and explanations without file edits'
    case 'plan':
      return 'Inspect workspace and propose an approval plan'
    case 'review':
      return 'Audit diffs, code quality, bugs, and security'
    default:
      return 'Plan, edit files, and verify changes end-to-end'
  }
}

export function getIdeModePlaceholder(mode: IdeExecutionMode, _arabic?: boolean): string {
  switch (mode) {
    case 'ask':
      return 'Ask about the codebase, @ to reference files...'
    case 'plan':
      return 'Describe what to plan, @ to reference files...'
    case 'review':
      return 'Review changes, bugs, or architecture, @ for files...'
    default:
      return 'Plan, build, fix anything — @ to add context...'
  }
}

export function getIdeFileActionLabel(
  action: IdePlanFileAction['action'],
  _arabic?: boolean
): string {
  switch (action) {
    case 'create':
      return 'Create'
    case 'delete':
      return 'Delete'
    case 'mkdir':
      return 'New folder'
    case 'rename':
      return 'Move'
    case 'delete_folder':
      return 'Del folder'
    default:
      return 'Edit'
  }
}

export function getIdeComplexityLabel(
  complexity: IdeTaskPlan['estimatedComplexity'],
  _arabic?: boolean
): string {
  return complexity === 'low' ? 'Low' : complexity === 'medium' ? 'Medium' : 'High'
}

export type IdeFineGrainedRunStage =
  | 'investigating_files'
  | 'searching_repo'
  | 'editing_files'
  | 'running_tests'
  | 'recovering_errors'

export function getIdeRunStageLabel(
  status: IdeRunStatus,
  _arabic = false,
  isAnswering = false,
  hasReadActivity = false,
  fineStage?: IdeFineGrainedRunStage | null
): string {
  if (fineStage === 'recovering_errors') {
    return 'Recovering from error…'
  }
  if (fineStage === 'running_tests') {
    return 'Running tests & checks…'
  }
  if (fineStage === 'searching_repo' && (status === 'analyzing' || status === 'planning')) {
    return 'Searching repository…'
  }
  if (fineStage === 'investigating_files' && status === 'analyzing') {
    return 'Investigating files…'
  }
  if (fineStage === 'editing_files' && status === 'executing') {
    return 'Editing files…'
  }
  if (status === 'executing' && isAnswering) {
    return 'Thinking…'
  }
  if (status === 'analyzing') {
    return hasReadActivity ? 'Investigating files…' : 'Thinking…'
  }
  const labels: Record<IdeRunStatus, string> = {
    idle: 'Ready',
    analyzing: 'Thinking…',
    planning: 'Planning changes…',
    awaiting_approval: 'Awaiting approval',
    awaiting_permission: 'Waiting for permission',
    executing: 'Applying changes…',
    paused: 'Paused',
    verifying: 'Verifying changes…',
    completed: 'Completed',
    failed: 'Failed',
    canceled: 'Stopped'
  }
  return labels[status]
}

export function getIdeChatCopy(_arabic?: boolean) {
  return {
    thinking: 'Thinking…',
    answeringDetail: 'Preparing response…',
    analyzingDetail: 'Inspecting workspace context…',
    planningDetail: 'Mapping affected files and implementation steps…',
    executingFallbackDetail: 'Applying planned operations…',
    modifiedFilesTitle: 'Modified files',
    commandsTitle: 'Checks & commands',
    passed: 'Passed',
    failed: 'Failed',
    running: 'Running',
    canceled: 'Canceled',
    denied: 'Denied',
    copyMessage: 'Copy response',
    copied: 'Copied',
    sensitiveFile: 'Sensitive file',
    planTitle: 'Implementation Plan',
    filesTitle: 'Target files',
    stepsTitle: 'Steps',
    showAllFiles: (count: number) => `Show all (${count})`,
    showStepDetails: 'Show details',
    hideStepDetails: 'Hide details',
    notesAndVerification: (count: number) => `Notes & checks (${count})`,
    risksLabel: 'Notes & risks',
    verificationLabel: 'Verification',
    decisionApproved: 'Approved',
    decisionRejected: 'Rejected',
    decisionRevision: 'Revision requested',
    revisionPlaceholder: 'Describe what to change, add requirements, or adjust the approach...',
    submitRevision: 'Submit Revision',
    cancel: 'Cancel',
    approveAndExecute: 'Approve & Execute',
    reject: 'Reject',
    revisePlan: 'Revise',
    viewChanges: 'View Changes',
    changeModel: 'Change model',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    retry: 'Retry',
    resumeHint: 'Resume to continue',
    autoContinueHint: 'Running steps automatically'
  }
}
