import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  resolveChatScratchFolderPath,
  resolveChatScratchSelectorFolder
} from '../runtime/files/chat-scratch-file-root'
import { resolveCouncilTargetWorktree } from '../runtime/rpc/methods/council/council-target-worktree'
import { IdeAgentEngine } from './ide-agent-engine'
import { IdeAgentStore } from './ide-agent-persistence'
import { RuntimeIdeAiClient } from './ide-ai-client'
import { LocalIdeWorkspaceGateway, type IdeWorkspaceGateway } from './ide-workspace-gateway'

const enginesByRuntime = new WeakMap<OrcaRuntimeService, IdeAgentEngine>()

async function isExistingDirectory(candidatePath: string): Promise<boolean> {
  try {
    const info = await stat(candidatePath)
    return info.isDirectory()
  } catch {
    return false
  }
}

async function resolveRuntimeWorkspaceGateway(
  runtime: OrcaRuntimeService,
  selectorOrPath: string
): Promise<IdeWorkspaceGateway> {
  const scratchFolder =
    (await resolveChatScratchSelectorFolder(selectorOrPath)) ??
    (isAbsolute(selectorOrPath) ? await resolveChatScratchFolderPath(selectorOrPath) : null)
  if (scratchFolder) {
    return new LocalIdeWorkspaceGateway({
      worktreeId: selectorOrPath,
      workspacePath: scratchFolder,
      executionHostId: LOCAL_EXECUTION_HOST_ID
    })
  }
  try {
    const target = await resolveCouncilTargetWorktree(runtime, selectorOrPath)
    return new LocalIdeWorkspaceGateway({
      worktreeId: target.worktree.id,
      workspacePath: target.worktree.path,
      executionHostId: target.executionHostId
    })
  } catch (error) {
    const listed = await runtime.listManagedWorktrees().catch(() => null)
    const matched = listed?.worktrees.find(
      (w) =>
        w.id === selectorOrPath ||
        w.path === selectorOrPath ||
        w.path.toLowerCase() === selectorOrPath.toLowerCase()
    )
    if (matched) {
      const target = await runtime.resolveRuntimeFileTarget(`id:${matched.id}`)
      return new LocalIdeWorkspaceGateway({
        worktreeId: target.worktree.id,
        workspacePath: target.worktree.path,
        executionHostId: target.executionHostId
      })
    }
    if (
      !selectorOrPath.startsWith('id:') &&
      isAbsolute(selectorOrPath) &&
      (await isExistingDirectory(selectorOrPath))
    ) {
      return new LocalIdeWorkspaceGateway({
        worktreeId: selectorOrPath,
        workspacePath: selectorOrPath,
        executionHostId: LOCAL_EXECUTION_HOST_ID
      })
    }
    throw error
  }
}

export function getIdeAgentEngine(runtime: OrcaRuntimeService): IdeAgentEngine {
  let engine = enginesByRuntime.get(runtime)
  if (engine) {
    return engine
  }
  const settings = runtime.requireStore().getSettings()
  const store = new IdeAgentStore()
  const aiClient = new RuntimeIdeAiClient(runtime)
  engine = new IdeAgentEngine({
    store,
    aiClient,
    defaultAgentId: settings.defaultTuiAgent ?? 'claude',
    resolveGateway: (selectorOrPath) => resolveRuntimeWorkspaceGateway(runtime, selectorOrPath)
  })
  enginesByRuntime.set(runtime, engine)
  return engine
}
