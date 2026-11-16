import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import {
  applySearchReplacePatches,
  buildProgressiveEditChunks
} from '../../shared/ide-agent/ide-patch-chunker'
import type {
  IdeActivityEventType,
  IdeAgentRole,
  IdeAgentStreamEvent,
  IdeCheckpoint,
  IdeConversation,
  IdeExecutionMode,
  IdeLiveEditSpeed,
  IdeSensitiveActionKind,
  IdeTaskPlan
} from '../../shared/ide-agent/ide-agent-types'
import type { RawStepExecutionOperation } from './ide-agent-prompt-parsers'
import {
  checkSensitiveFileWriteGate,
  ensurePlanScope,
  upsertFileChangeRecord
} from './ide-file-edit-gates'
import { applyFolderOrMoveOperation } from './ide-folder-path-ops'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

export type CoordinatorCallbacks = {
  emit: (event: IdeAgentStreamEvent) => void
  appendActivity: (
    conv: IdeConversation,
    params: {
      runId: string
      role: IdeAgentRole
      type: IdeActivityEventType
      summary: string
      detail?: string
      relativePath?: string
      command?: string
      status?: 'info' | 'running' | 'completed' | 'warning' | 'error'
      expandablePayload?: Record<string, unknown>
    }
  ) => void
  saveAndPublish: (conv: IdeConversation) => void
  requestExplicitPermission: (
    conv: IdeConversation,
    params: {
      kind: IdeSensitiveActionKind
      title: string
      detail: string
      targetPath?: string
      command?: string
    }
  ) => Promise<boolean>
  waitIfPausedOrAborted: (conv: IdeConversation) => Promise<boolean>
  chunkDelayMs?: number
}

export type FileOperationContext = {
  conv: IdeConversation
  plan: IdeTaskPlan
  checkpoint: IdeCheckpoint
  baselineShaByFile: Map<string, string | null>
  runId: string
  mode: IdeExecutionMode
  multiAgentEnabled: boolean
  liveEditSpeed?: IdeLiveEditSpeed
  dirtyPaths: ReadonlySet<string>
  gateway: IdeWorkspaceGateway
  op: RawStepExecutionOperation
  modifiedFilesSet: Set<string>
  alreadyStreamedPaths?: ReadonlySet<string>
}

export async function applyCoordinatedFileOperation(
  ctx: FileOperationContext,
  cb: CoordinatorCallbacks
): Promise<void> {
  const { conv, checkpoint, baselineShaByFile, gateway, op, modifiedFilesSet } = ctx
  const normalized = normalizeWorkspaceRelativePath(op.path)
  const role: IdeAgentRole = ctx.multiAgentEnabled ? 'coder' : 'orchestrator'

  if (!(await ensurePlanScope(ctx, cb, normalized))) {
    return
  }
  if ((await applyFolderOrMoveOperation(ctx, cb, normalized, role)) === 'handled') {
    return
  }
  const gate = await checkSensitiveFileWriteGate(ctx, cb, normalized)
  if (!gate.allowed) {
    return
  }
  const allowSecretWrite = gate.allowSecretWrite

  if (!baselineShaByFile.has(normalized)) {
    const readRes = await gateway.readTextFile(normalized, { allowSecretRead: allowSecretWrite })
    const content = readRes.ok ? readRes.content : null
    baselineShaByFile.set(normalized, readRes.ok ? readRes.sha256 : null)
    checkpoint.files.push({
      relativePath: normalized,
      existedBefore: content !== null,
      beforeContent: content,
      afterContent: content,
      status: 'pending'
    })
  }

  const cpEntry = checkpoint.files.find((f) => f.relativePath === normalized)!
  const beforeContent = cpEntry.beforeContent

  if (op.action === 'delete') {
    const delRes = await gateway.deleteWorkspaceFile(normalized, { mode: ctx.mode })
    if (!delRes.ok) {
      throw new Error(delRes.message)
    }
    cpEntry.afterContent = null
    upsertFileChangeRecord(conv, cb.saveAndPublish, {
      runId: ctx.runId,
      checkpointId: checkpoint.id,
      relativePath: normalized,
      changeType: 'deleted',
      existedBefore: cpEntry.existedBefore,
      beforeContent,
      afterContent: null,
      chunksApplied: 1,
      totalChunks: 1,
      acceptedState: 'pending'
    })
    modifiedFilesSet.add(normalized)
    cb.emit({
      type: 'file_deleted',
      conversationId: conv.id,
      runId: ctx.runId,
      relativePath: normalized
    })
    cb.appendActivity(conv, {
      runId: ctx.runId,
      role,
      type: 'file.deleted',
      summary: `Deleted ${normalized}`,
      relativePath: normalized,
      status: 'completed'
    })
    return
  }

  let targetContent = op.content ?? ''
  if (op.action === 'patch' && op.patches) {
    const baseText = cpEntry.afterContent ?? beforeContent ?? ''
    const patched = applySearchReplacePatches(baseText, op.patches)
    if (!patched.ok) {
      throw new Error(`Patch failed for "${normalized}": ${patched.reason}`)
    }
    targetContent = patched.content
  }

  const currentDiskState = cpEntry.afterContent ?? beforeContent
  const chunks = buildProgressiveEditChunks({
    beforeContent: currentDiskState,
    afterContent: targetContent
  })
  if (chunks.length === 0) {
    return
  }

  const wasStreamed = ctx.alreadyStreamedPaths?.has(normalized.toLowerCase()) ?? false
  if (!wasStreamed) {
    cb.emit({
      type: 'editor_file_opened',
      conversationId: conv.id,
      runId: ctx.runId,
      relativePath: normalized,
      reason: op.action === 'create' ? `Creating ${normalized}` : `Editing ${normalized}`
    })
  }
  cb.appendActivity(conv, {
    runId: ctx.runId,
    role,
    type: 'editor.file_opened',
    summary: `Opened ${normalized} in editor`,
    relativePath: normalized,
    status: 'running'
  })

  const speed = ctx.liveEditSpeed ?? 'natural'
  if (!wasStreamed) {
    for (const chunk of chunks) {
      if (!(await cb.waitIfPausedOrAborted(conv))) {
        return
      }
      cb.emit({
        type: 'editor_edit_chunk',
        conversationId: conv.id,
        runId: ctx.runId,
        relativePath: normalized,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        label: chunk.label,
        beforeContent: chunk.beforeContent,
        afterContent: chunk.content,
        speed,
        sourceKind: 'patch_preview'
      })
      const delay = cb.chunkDelayMs ?? (speed === 'instant' ? 0 : speed === 'fast' ? 60 : 140)
      if (delay > 0 && chunk.chunkIndex < chunk.totalChunks - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  if (!(await cb.waitIfPausedOrAborted(conv))) {
    return
  }

  const expectedSha = baselineShaByFile.get(normalized) ?? null
  const writeRes = await gateway.writeTextChunk(normalized, targetContent, {
    mode: ctx.mode,
    expectedBeforeSha: expectedSha,
    dirtyRelativePaths: ctx.dirtyPaths,
    allowSecretWrite
  })
  if (!writeRes.ok) {
    if (writeRes.reason === 'dirty_conflict' || writeRes.reason === 'disk_conflict') {
      cpEntry.status = 'conflict'
      upsertFileChangeRecord(conv, cb.saveAndPublish, {
        runId: ctx.runId,
        checkpointId: checkpoint.id,
        relativePath: normalized,
        changeType: beforeContent === null ? 'created' : 'modified',
        existedBefore: cpEntry.existedBefore,
        beforeContent,
        afterContent: cpEntry.afterContent,
        chunksApplied: 0,
        totalChunks: chunks.length,
        acceptedState: 'conflict',
        conflictMessage: writeRes.message
      })
      cb.appendActivity(conv, {
        runId: ctx.runId,
        role: 'orchestrator',
        type: 'file.conflict',
        summary: `Conflict protecting ${normalized}`,
        detail: writeRes.message,
        relativePath: normalized,
        status: 'warning'
      })
      return
    }
    throw new Error(writeRes.message)
  }

  if (wasStreamed) {
    const last = chunks.at(-1)!
    cb.emit({
      type: 'editor_edit_chunk',
      conversationId: conv.id,
      runId: ctx.runId,
      relativePath: normalized,
      startLine: last.startLine,
      endLine: last.endLine,
      chunkIndex: chunks.length - 1,
      totalChunks: chunks.length,
      label: `Committed ${normalized}`,
      beforeContent: currentDiskState,
      afterContent: targetContent,
      speed: 'instant',
      sourceKind: 'streamed'
    })
  }

  baselineShaByFile.set(normalized, writeRes.sha256)
  cpEntry.afterContent = targetContent

  upsertFileChangeRecord(conv, cb.saveAndPublish, {
    runId: ctx.runId,
    checkpointId: checkpoint.id,
    relativePath: normalized,
    changeType: cpEntry.existedBefore ? 'modified' : 'created',
    existedBefore: cpEntry.existedBefore,
    beforeContent,
    afterContent: targetContent,
    chunksApplied: chunks.length,
    totalChunks: chunks.length,
    acceptedState: 'pending'
  })

  cb.appendActivity(conv, {
    runId: ctx.runId,
    role,
    type: cpEntry.existedBefore ? 'file.modified' : 'file.created',
    summary: `${cpEntry.existedBefore ? 'Updated' : 'Created'} ${normalized}`,
    relativePath: normalized,
    status: 'completed'
  })

  modifiedFilesSet.add(normalized)
  cb.emit({
    type: cpEntry.existedBefore ? 'file_modified' : 'file_created',
    conversationId: conv.id,
    runId: ctx.runId,
    relativePath: normalized
  })
}
