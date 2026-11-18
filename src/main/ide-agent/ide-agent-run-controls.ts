import { randomUUID } from 'node:crypto'
import {
  classifySensitiveCommand,
  isModeWriteAllowed
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeCommandCategory,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdePermissionRequest,
  IdeSensitiveActionKind
} from '../../shared/ide-agent/ide-agent-types'
import { executeVerifiedCommand } from './ide-agent-command-runner'
import type {
  ActiveRunControl,
  EngineHostOps,
  ResolveWorkspaceGateway
} from './ide-agent-runtime-types'

export async function requestExplicitRunPermission(
  host: EngineHostOps,
  conversation: IdeConversation,
  run: ActiveRunControl,
  params: {
    kind: IdeSensitiveActionKind
    title: string
    detail: string
    targetPath?: string
    command?: string
  }
): Promise<boolean> {
  const existingApproved = conversation.pendingPermissions.find(
    (p) =>
      p.runId === run.runId &&
      p.status === 'approved' &&
      p.kind === params.kind &&
      p.targetPath === params.targetPath &&
      p.command === params.command
  )
  if (existingApproved) {
    return true
  }
  const permission: IdePermissionRequest = {
    id: randomUUID(),
    conversationId: conversation.id,
    runId: run.runId,
    kind: params.kind,
    title: params.title,
    detail: params.detail,
    ...(params.targetPath ? { targetPath: params.targetPath } : {}),
    ...(params.command ? { command: params.command } : {}),
    status: 'pending',
    createdAt: Date.now()
  }
  conversation.pendingPermissions.push(permission)
  host.appendActivity(conversation, {
    runId: run.runId,
    role: 'orchestrator',
    type: 'permission.requested',
    summary: params.title,
    detail: params.detail,
    relativePath: params.targetPath,
    command: params.command,
    status: 'warning'
  })
  if (conversation.status !== 'awaiting_permission') {
    run.statusBeforePermission = conversation.status
  }
  host.setRunStatus(conversation, run.runId, 'awaiting_permission', params.title)
  host.emit({ type: 'permission_requested', conversationId: conversation.id, permission })

  return await new Promise<boolean>((resolveDecision) => {
    const onAbort = (): void => {
      run.permissionWaiters.delete(permission.id)
      resolveDecision(false)
    }
    if (run.abortController.signal.aborted) {
      onAbort()
      return
    }
    run.abortController.signal.addEventListener('abort', onAbort, { once: true })
    run.permissionWaiters.set(permission.id, (approved) => {
      run.abortController.signal.removeEventListener('abort', onAbort)
      resolveDecision(approved)
    })
  })
}

export function resolvePermissionDecision(
  host: EngineHostOps,
  activeRuns: Map<string, ActiveRunControl>,
  params: {
    conversationId: string
    permissionId: string
    decision: 'approve' | 'deny'
    note?: string
  }
): IdeConversation {
  const conv = host.requireConversation(params.conversationId)
  const perm = conv.pendingPermissions.find((p) => p.id === params.permissionId)
  if (!perm) {
    throw new Error(`Permission request "${params.permissionId}" not found.`)
  }
  const approved = params.decision === 'approve'
  perm.status = approved ? 'approved' : 'denied'
  perm.resolvedAt = Date.now()
  if (params.note) {
    perm.note = params.note
  }
  host.appendActivity(conv, {
    runId: perm.runId,
    role: 'orchestrator',
    type: 'permission.resolved',
    summary: `${approved ? 'Approved' : 'Denied'}: ${perm.title}`,
    relativePath: perm.targetPath,
    command: perm.command,
    status: approved ? 'completed' : 'warning'
  })
  const run = activeRuns.get(conv.id)
  const waiter = run?.permissionWaiters.get(perm.id)
  if (waiter) {
    run?.permissionWaiters.delete(perm.id)
    const stillWaiting = conv.pendingPermissions.some((p) => p.status === 'pending')
    if (!stillWaiting && run) {
      host.setRunStatus(conv, run.runId, run.statusBeforePermission ?? 'executing')
    } else {
      host.saveAndPublish(conv)
    }
    waiter(approved)
  } else if (conv.status === 'awaiting_permission') {
    const stillWaiting = conv.pendingPermissions.some((p) => p.status === 'pending')
    if (!stillWaiting) {
      host.setRunStatus(conv, null, 'idle')
    } else {
      host.saveAndPublish(conv)
    }
  } else {
    host.saveAndPublish(conv)
  }
  return conv
}

export async function executeManualWorkspaceCommand(params: {
  host: EngineHostOps
  resolveGateway: ResolveWorkspaceGateway
  dirtyFilesByConversation: Map<string, Set<string>>
  conversationId: string
  worktreeSelector: string
  command: string
  category?: IdeCommandCategory
  permissionApproved?: boolean
}): Promise<{
  needsPermission?: IdePermissionRequest
  execution?: IdeCommandExecutionRecord
  conversation: IdeConversation
}> {
  const { host, resolveGateway, dirtyFilesByConversation } = params
  const conv = host.requireConversation(params.conversationId)
  if (!isModeWriteAllowed(conv.mode)) {
    throw new Error(
      `Command execution is disabled in ${conv.mode} mode. Switch to Agent mode first.`
    )
  }
  const runId = conv.activeRunId ?? randomUUID()
  const sensitive = classifySensitiveCommand(params.command)
  const alreadyApproved =
    params.permissionApproved ||
    conv.pendingPermissions.some((p) => p.status === 'approved' && p.command === params.command)
  if (sensitive && !alreadyApproved) {
    const perm: IdePermissionRequest = {
      id: randomUUID(),
      conversationId: conv.id,
      runId,
      kind: sensitive.kind,
      title: `Allow sensitive command: ${params.command}`,
      detail: sensitive.reason,
      command: params.command,
      status: 'pending',
      createdAt: Date.now()
    }
    conv.pendingPermissions.push(perm)
    host.saveAndPublish(conv)
    host.emit({ type: 'permission_requested', conversationId: conv.id, permission: perm })
    return { needsPermission: perm, conversation: conv }
  }
  const gateway = await resolveGateway(params.worktreeSelector)
  const manualRun: ActiveRunControl = {
    runId,
    conversationId: conv.id,
    abortController: new AbortController(),
    paused: false,
    resumeResolvers: [],
    permissionWaiters: new Map(),
    worktreeSelector: params.worktreeSelector,
    dirtyPaths: dirtyFilesByConversation.get(conv.id) ?? new Set(),
    config: {
      mode: conv.mode,
      agentId: conv.agentId,
      modelId: conv.modelId,
      multiAgentEnabled: conv.multiAgentEnabled,
      liveEditSpeed: conv.liveEditSpeed
    }
  }
  const execution = await executeVerifiedCommand({
    host,
    conv,
    run: manualRun,
    gateway,
    command: params.command,
    category: params.category
  })
  return { ...(execution ? { execution } : {}), conversation: conv }
}

export function processRunControlAction(params: {
  host: EngineHostOps
  activeRuns: Map<string, ActiveRunControl>
  conversationId: string
  action: 'pause' | 'resume' | 'stop' | 'retry'
  worktreeSelector?: string
  dirtyRelativePaths?: string[]
  onApproveRetry: (planId: string) => Promise<IdeConversation>
  onResendPrompt: (
    text: string,
    mode: IdeConversation['mode'],
    attachments: IdeConversation['messages'][number]['attachments']
  ) => Promise<IdeConversation>
}): Promise<IdeConversation> | IdeConversation {
  const { host, activeRuns, conversationId, action } = params
  const conv = host.requireConversation(conversationId)
  const run = activeRuns.get(conv.id)
  if (action === 'pause' && run) {
    run.paused = true
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.paused',
      summary: 'Execution paused by user',
      status: 'warning'
    })
    host.setRunStatus(conv, run.runId, 'paused')
    return conv
  }
  if (action === 'resume' && run) {
    run.paused = false
    for (const resolve of run.resumeResolvers.splice(0)) {
      resolve()
    }
    host.appendActivity(conv, {
      runId: run.runId,
      role: 'orchestrator',
      type: 'run.resumed',
      summary: 'Execution resumed',
      status: 'running'
    })
    host.setRunStatus(conv, run.runId, 'executing')
    return conv
  }
  if (action === 'stop') {
    if (run) {
      run.abortController.abort()
      for (const resolve of run.resumeResolvers.splice(0)) {
        resolve()
      }
      for (const [, resolvePerm] of run.permissionWaiters) {
        resolvePerm(false)
      }
      run.permissionWaiters.clear()
    }
    host.setRunStatus(conv, null, 'canceled', 'Stopped by user')
    return conv
  }
  if (action !== 'retry') {
    return conv
  }
  const activePlan = conv.plans.find((p) => p.id === conv.activePlanId)
  if (
    activePlan &&
    activePlan.status === 'failed' &&
    activePlan.approvalRecord?.decision === 'approved'
  ) {
    activePlan.status = 'awaiting_approval'
    for (const step of activePlan.steps) {
      if (step.status === 'failed' || step.status === 'in_progress') {
        step.status = 'pending'
      }
    }
    host.saveAndPublish(conv)
    return params.onApproveRetry(activePlan.id)
  }
  const lastUserMessage = [...conv.messages].toReversed().find((m) => m.role === 'user')
  if (!lastUserMessage) {
    throw new Error('Nothing to retry in this conversation.')
  }
  return params.onResendPrompt(lastUserMessage.text, conv.mode, lastUserMessage.attachments)
}
