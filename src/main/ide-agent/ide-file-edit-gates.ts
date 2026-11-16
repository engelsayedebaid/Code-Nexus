import { randomUUID } from 'node:crypto'
import {
  classifySensitiveFilePath,
  computeIdePlanHash,
  isPlanApprovedForExecution
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeConversation, IdeFileChangeRecord } from '../../shared/ide-agent/ide-agent-types'
import type { CoordinatorCallbacks, FileOperationContext } from './ide-file-edit-coordinator'

export function upsertFileChangeRecord(
  conv: IdeConversation,
  saveAndPublish: (conv: IdeConversation) => void,
  input: Omit<IdeFileChangeRecord, 'id' | 'conversationId' | 'updatedAt'>
): void {
  const existing = conv.fileChanges.find(
    (item) => item.runId === input.runId && item.relativePath === input.relativePath
  )
  if (existing) {
    Object.assign(existing, { ...input, updatedAt: Date.now() })
  } else {
    conv.fileChanges.push({
      id: randomUUID(),
      conversationId: conv.id,
      ...input,
      updatedAt: Date.now()
    })
  }
  saveAndPublish(conv)
}

export async function ensurePlanScope(
  ctx: FileOperationContext,
  cb: CoordinatorCallbacks,
  normalized: string
): Promise<boolean> {
  const requested = ctx.op.fromPath ? [normalized, ctx.op.fromPath] : [normalized]
  const scopeCheck = isPlanApprovedForExecution(ctx.plan, requested)
  if (scopeCheck.ok) {
    return true
  }
  if (!scopeCheck.outOfScopePath) {
    throw new Error(scopeCheck.reason)
  }
  const approvedExtra = await cb.requestExplicitPermission(ctx.conv, {
    kind: 'out_of_scope_file',
    title: `Allow editing unapproved path "${scopeCheck.outOfScopePath}"?`,
    detail: scopeCheck.reason,
    targetPath: scopeCheck.outOfScopePath
  })
  if (!approvedExtra) {
    cb.appendActivity(ctx.conv, {
      runId: ctx.runId,
      role: 'orchestrator',
      type: 'file.conflict',
      summary: `Skipped out-of-scope path ${scopeCheck.outOfScopePath}`,
      relativePath: scopeCheck.outOfScopePath,
      status: 'warning'
    })
    return false
  }
  const planAction = ctx.op.action === 'patch' ? 'modify' : ctx.op.action
  ctx.plan.affectedFiles.push({
    path: normalized,
    ...(ctx.op.fromPath ? { fromPath: ctx.op.fromPath } : {}),
    action: planAction,
    summary: ctx.op.rationale ?? 'Approved expansion'
  })
  ctx.plan.planHash = computeIdePlanHash(ctx.plan)
  if (ctx.plan.approvalRecord) {
    ctx.plan.approvalRecord.planHash = ctx.plan.planHash
  }
  return true
}

export async function checkSensitiveFileWriteGate(
  ctx: FileOperationContext,
  cb: CoordinatorCallbacks,
  normalized: string
): Promise<{ allowed: boolean; allowSecretWrite: boolean }> {
  const sensitiveOp = ctx.op.action === 'delete' ? 'delete' : 'write'
  const sensitiveKind = classifySensitiveFilePath(normalized, sensitiveOp)
  if (!sensitiveKind) {
    return { allowed: true, allowSecretWrite: false }
  }
  const approvedSensitive = await cb.requestExplicitPermission(ctx.conv, {
    kind: sensitiveKind,
    title:
      sensitiveKind === 'delete_important_file'
        ? `Allow deleting "${normalized}"?`
        : sensitiveKind === 'modify_secrets'
          ? `Allow modifying secrets file "${normalized}"?`
          : `Allow modifying production config "${normalized}"?`,
    detail: ctx.op.rationale ?? `Requested ${ctx.op.action} on "${normalized}".`,
    targetPath: normalized
  })
  if (!approvedSensitive) {
    cb.appendActivity(ctx.conv, {
      runId: ctx.runId,
      role: 'orchestrator',
      type: 'permission.resolved',
      summary: `Denied sensitive ${ctx.op.action} on ${normalized}`,
      relativePath: normalized,
      status: 'warning'
    })
    return { allowed: false, allowSecretWrite: false }
  }
  return { allowed: true, allowSecretWrite: sensitiveKind === 'modify_secrets' }
}
