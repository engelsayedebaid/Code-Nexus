import { randomUUID } from 'node:crypto'
import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import type {
  ActiveRunControl,
  EngineHostOps,
  ResolveWorkspaceGateway
} from './ide-agent-runtime-types'
import { sha256Text } from './ide-workspace-write-fs'

export async function applyChangeDecision(params: {
  host: EngineHostOps
  activeRuns?: Map<string, ActiveRunControl>
  resolveGateway: ResolveWorkspaceGateway
  dirtyFilesByConversation: Map<string, Set<string>>
  conversationId: string
  worktreeSelector?: string
  action: 'accept' | 'reject' | 'restore_checkpoint'
  changeId?: string
  checkpointId?: string
}): Promise<IdeConversation> {
  const { host, activeRuns, resolveGateway, dirtyFilesByConversation } = params
  const conv = host.requireConversation(params.conversationId)

  if (params.action === 'accept') {
    const target = conv.fileChanges.find((c) => c.id === params.changeId)
    if (!target) {
      throw new Error('File change record not found.')
    }
    target.acceptedState = 'accepted'
    target.updatedAt = Date.now()
    return host.saveAndPublish(conv)
  }

  if (activeRuns?.has(conv.id)) {
    throw new Error('Stop the active run before reverting file changes.')
  }

  const dirtySet = dirtyFilesByConversation.get(conv.id) ?? new Set<string>()
  const boundSelector = conv.workspaceKey.startsWith('ide-scratch:')
    ? conv.workspacePath
    : `id:${conv.workspaceKey}`
  const gateway = await resolveGateway(boundSelector).catch(() =>
    resolveGateway(conv.workspacePath)
  )

  const targets =
    params.action === 'restore_checkpoint'
      ? conv.fileChanges.filter((c) => c.checkpointId === params.checkpointId)
      : conv.fileChanges.filter((c) => c.id === params.changeId)

  if (targets.length === 0) {
    if (
      params.action === 'restore_checkpoint' &&
      conv.checkpoints.some((c) => c.id === params.checkpointId)
    ) {
      return host.saveAndPublish(conv)
    }
    throw new Error('No matching tracked file changes found to restore.')
  }

  for (const change of targets) {
    if (dirtySet.has(normalizeWorkspaceRelativePath(change.relativePath).toLowerCase())) {
      change.acceptedState = 'conflict'
      change.conflictMessage = `Skipped restore of "${change.relativePath}" because the editor has unsaved changes.`
      continue
    }
    const currentRead = await gateway.readTextFile(change.relativePath, { allowSecretRead: true })
    const currentSha = currentRead.ok ? currentRead.sha256 : null
    const expectedAfterSha = change.afterContent !== null ? sha256Text(change.afterContent) : null

    if (!change.existedBefore || change.beforeContent === null) {
      if (currentSha !== null && expectedAfterSha !== null && currentSha !== expectedAfterSha) {
        change.acceptedState = 'conflict'
        change.conflictMessage = `"${change.relativePath}" was modified after the agent created it.`
        continue
      }
      const delRes = await gateway.deleteWorkspaceFile(change.relativePath, { mode: 'agent' })
      if (!delRes.ok) {
        throw new Error(delRes.message)
      }
      host.emit({
        type: 'file_deleted',
        conversationId: conv.id,
        runId: change.runId,
        relativePath: change.relativePath
      })
    } else {
      const restoreRes = await gateway.writeTextChunk(change.relativePath, change.beforeContent, {
        mode: 'agent',
        expectedBeforeSha: expectedAfterSha,
        dirtyRelativePaths: dirtySet,
        allowSecretWrite: true
      })
      if (!restoreRes.ok) {
        change.acceptedState = 'conflict'
        change.conflictMessage = restoreRes.message
        continue
      }
      host.emit({
        type: 'editor_edit_chunk',
        conversationId: conv.id,
        runId: change.runId,
        relativePath: change.relativePath,
        startLine: 1,
        endLine: Math.max(1, change.beforeContent.split(/\r?\n/).length),
        chunkIndex: 0,
        totalChunks: 1,
        label: 'Restored checkpoint content',
        beforeContent: currentRead.ok ? currentRead.content : null,
        afterContent: change.beforeContent,
        speed: 'instant',
        sourceKind: 'patch_preview'
      })
      host.emit({
        type: 'file_modified',
        conversationId: conv.id,
        runId: change.runId,
        relativePath: change.relativePath
      })
    }
    change.acceptedState = 'reverted'
    change.conflictMessage = undefined
    change.updatedAt = Date.now()
  }

  const cp = conv.checkpoints.find(
    (c) => c.id === (params.checkpointId ?? targets[0]?.checkpointId)
  )
  if (cp) {
    for (const file of cp.files) {
      const matched = targets.find(
        (t) =>
          normalizeWorkspaceRelativePath(t.relativePath).toLowerCase() ===
          normalizeWorkspaceRelativePath(file.relativePath).toLowerCase()
      )
      if (matched) {
        file.status = matched.acceptedState === 'conflict' ? 'conflict' : 'reverted'
      }
    }
  }

  host.appendActivity(conv, {
    runId: targets[0]?.runId ?? randomUUID(),
    role: 'orchestrator',
    type: 'checkpoint.restored',
    summary:
      params.action === 'restore_checkpoint'
        ? `Restored checkpoint (${targets.length} file(s))`
        : `Reverted changes to ${targets[0]?.relativePath ?? 'file'}`,
    status: 'completed'
  })

  return host.saveAndPublish(conv)
}
