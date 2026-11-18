import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type { IdeAgentRole } from '../../shared/ide-agent/ide-agent-types'
import type { CoordinatorCallbacks, FileOperationContext } from './ide-file-edit-coordinator'

export async function applyFolderOrMoveOperation(
  ctx: FileOperationContext,
  cb: CoordinatorCallbacks,
  normalized: string,
  role: IdeAgentRole
): Promise<'handled' | 'not_handled'> {
  const { conv, gateway, op, modifiedFilesSet } = ctx

  if (op.action === 'mkdir') {
    if (!gateway.createDirectory) {
      return 'handled'
    }
    const dirRes = await gateway.createDirectory(normalized, { mode: ctx.mode })
    if (!dirRes.ok) {
      throw new Error(dirRes.message)
    }
    cb.emit({
      type: 'folder_created',
      conversationId: conv.id,
      runId: ctx.runId,
      relativePath: normalized
    })
    cb.appendActivity(conv, {
      runId: ctx.runId,
      role,
      type: 'folder.created',
      summary: dirRes.created ? `Created folder ${normalized}/` : `Verified folder ${normalized}/`,
      relativePath: normalized,
      status: 'completed'
    })
    return 'handled'
  }

  if (op.action === 'rename') {
    if (!gateway.renamePath || !op.fromPath) {
      throw new Error('Rename operation requires fromPath and renamePath support.')
    }
    const fromRel = normalizeWorkspaceRelativePath(op.fromPath)
    const sensitiveFrom = classifySensitiveFilePath(fromRel, 'write')
    const sensitiveTo = classifySensitiveFilePath(normalized, 'write')
    let allowSecretMove = false
    if (sensitiveFrom || sensitiveTo) {
      const approved = await cb.requestExplicitPermission(conv, {
        kind: sensitiveFrom ?? sensitiveTo ?? 'production_config',
        title: `Allow moving "${fromRel}" to "${normalized}"?`,
        detail: op.rationale ?? `Requested renaming "${fromRel}" -> "${normalized}".`,
        targetPath: normalized
      })
      if (!approved) {
        return 'handled'
      }
      allowSecretMove = sensitiveFrom === 'modify_secrets' || sensitiveTo === 'modify_secrets'
    }
    const moveRes = await gateway.renamePath(fromRel, normalized, {
      mode: ctx.mode,
      allowSecretMove
    })
    if (!moveRes.ok) {
      throw new Error(moveRes.message)
    }
    const movedSha = ctx.baselineShaByFile.get(fromRel)
    if (movedSha !== undefined) {
      ctx.baselineShaByFile.set(normalized, movedSha)
      ctx.baselineShaByFile.set(fromRel, null)
    }
    const fromCp = ctx.checkpoint.files.find((f) => f.relativePath === fromRel)
    if (fromCp && !ctx.checkpoint.files.some((f) => f.relativePath === normalized)) {
      ctx.checkpoint.files.push({
        relativePath: normalized,
        existedBefore: false,
        beforeContent: null,
        afterContent: fromCp.afterContent ?? fromCp.beforeContent,
        status: 'pending'
      })
      fromCp.afterContent = null
    }
    modifiedFilesSet.add(normalized)
    cb.emit({
      type: 'file_renamed',
      conversationId: conv.id,
      runId: ctx.runId,
      fromRelativePath: fromRel,
      relativePath: normalized
    })
    cb.appendActivity(conv, {
      runId: ctx.runId,
      role,
      type: 'file.renamed',
      summary: `Moved ${fromRel} -> ${normalized}`,
      relativePath: normalized,
      status: 'completed'
    })
    return 'handled'
  }

  if (op.action === 'delete_folder') {
    if (!gateway.deleteDirectory) {
      throw new Error('Folder deletion is not supported by this workspace gateway.')
    }
    const approvedDel = await cb.requestExplicitPermission(conv, {
      kind: 'delete_important_file',
      title: `Allow deleting folder "${normalized}/"?`,
      detail: op.rationale ?? `Requested recursive deletion of folder "${normalized}/".`,
      targetPath: normalized
    })
    if (!approvedDel) {
      return 'handled'
    }
    const delDirRes = await gateway.deleteDirectory(normalized, { mode: ctx.mode, recursive: true })
    if (!delDirRes.ok) {
      throw new Error(delDirRes.message)
    }
    modifiedFilesSet.add(normalized)
    cb.emit({
      type: 'folder_deleted',
      conversationId: conv.id,
      runId: ctx.runId,
      relativePath: normalized
    })
    cb.appendActivity(conv, {
      runId: ctx.runId,
      role,
      type: 'folder.deleted',
      summary: `Deleted folder ${normalized}/`,
      relativePath: normalized,
      status: 'completed'
    })
    return 'handled'
  }

  return 'not_handled'
}
