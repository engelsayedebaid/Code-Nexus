import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { isAbsolute } from 'node:path'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  resolveChatScratchFolderPath,
  resolveChatScratchSelectorFolder
} from '../runtime/files/chat-scratch-file-root'
import { IdeAgentEngine } from './ide-agent-engine'
import { IdeAgentStore } from './ide-agent-persistence'
import { RuntimeIdeAiClient } from './ide-ai-client'
import { LocalIdeWorkspaceGateway, type IdeWorkspaceGateway } from './ide-workspace-gateway'

const enginesByRuntime = new WeakMap<OrcaRuntimeService, IdeAgentEngine>()

async function resolveRuntimeWorkspaceGateway(
  runtime: OrcaRuntimeService,
  selectorOrPath: string
): Promise<IdeWorkspaceGateway> {
  // Workspace-less chats run inside this host's chat-scratch folder; accept both the `path:` selector and its absolute path.
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
    const target = await runtime.resolveRuntimeFileTarget(selectorOrPath)
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
    if (selectorOrPath.startsWith('id:') || error instanceof Error) {
      throw error
    }
    return new LocalIdeWorkspaceGateway({
      worktreeId: selectorOrPath,
      workspacePath: selectorOrPath,
      executionHostId: LOCAL_EXECUTION_HOST_ID
    })
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
