import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import { resolveExecutableCommand } from '../../../../../shared/node-cli-command-resolution'
import {
  getCommitMessageAgentCapability,
  getCommitMessageAgentSpec,
  listCommitMessageAgentCapabilities
} from '../../../../../shared/source-control/ai/generation/commit-message-agent-spec'
import {
  CouncilAgentParams,
  CouncilCancelParams,
  CouncilEmptyParams,
  CouncilGenerateParams,
  type CouncilAgentCatalog,
  type CouncilGenerationResult,
  type CouncilModelsResult
} from '../../../../../shared/council/council-contract'
import { defineMethod, defineStreamingMethod } from '../../core'
import { prepareLocalCommitMessageAgentEnv } from '../../../../text-generation/commit-message-agent-environment'
import { discoverCommitMessageModelsLocal } from '../../../../text-generation/commit-message-text-generation'
import { runGenerationRequest } from '../../../../text-generation/agent-generation-request'
import { spawnSourceControlAgent } from '../../../../text-generation/source-control-agent-launch'
import {
  cancelLocalGeneration,
  clearLocalGenerationStdoutListener,
  localGenerationLaneKey,
  setLocalGenerationStdoutListener
} from '../../../../text-generation/source-control-generation-lanes'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import {
  clearCouncilAuthCache,
  resolveCouncilAgentAuthInfo,
  withExtraAgentDirectoriesOnPath
} from './council-auth-status'
import { parsePartialCouncilOutput, supportsCouncilStreaming } from './council-stream-parser'
import { resolveCouncilTargetWorktree } from './council-target-worktree'

const activeTurns = new Map<string, { cwd: string; active: boolean }>()

function agentSupportsMultipleModels(agentId: string): boolean {
  if (!isTuiAgent(agentId)) {
    return false
  }
  const spec = getCommitMessageAgentSpec(agentId)
  const capability = getCommitMessageAgentCapability(agentId)
  if (!spec || !capability || spec.modelFlag.length === 0) {
    return false
  }
  return capability.modelSource === 'dynamic' || capability.models.length > 1
}

async function localTarget(runtime: OrcaRuntimeService, worktree: string, agent: string) {
  if (!isTuiAgent(agent) || !getCommitMessageAgentCapability(agent)) {
    throw new Error(`${agent} does not expose a read-only Council text task.`)
  }
  const target = await resolveCouncilTargetWorktree(runtime, worktree)
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    throw new Error('Council text tasks on remote hosts require a newer Carver runtime.')
  }
  const prepared = await prepareLocalCommitMessageAgentEnv(
    agent,
    runtime.getCommitMessageAgentEnvironmentResolvers(),
    { runtime: 'host' }
  )
  if (!prepared.ok) {
    throw new Error(prepared.error)
  }
  return {
    cwd: target.worktree.path,
    env: withExtraAgentDirectoriesOnPath(agent, prepared.env ?? {})
  }
}

async function runCouncilTurn(
  params: ReturnType<typeof CouncilGenerateParams.parse>,
  runtime: OrcaRuntimeService,
  onDelta?: (text: string) => void
): Promise<CouncilGenerationResult> {
  if (!isTuiAgent(params.agent)) {
    return { success: false, error: 'Unsupported Council agent.' }
  }
  let laneKey: string | null = null
  let listener: ((stdout: string) => void) | null = null
  try {
    const target = await localTarget(runtime, params.worktree, params.agent)
    const turn = { cwd: target.cwd, active: true }
    activeTurns.set(params.operationId, turn)
    if (onDelta && supportsCouncilStreaming(params.agent)) {
      let lastEmitted = ''
      laneKey = localGenerationLaneKey('council', target.cwd, params.operationId)
      listener = (stdout: string) => {
        if (!turn.active) {
          return
        }
        const partial = parsePartialCouncilOutput(params.agent, stdout)
        if (partial && partial !== lastEmitted) {
          lastEmitted = partial
          onDelta(partial)
        }
      }
      setLocalGenerationStdoutListener(laneKey, listener)
    }
    const settings = runtime.requireStore().getSettings()
    const result = await runGenerationRequest({
      params: {
        agentId: params.agent,
        model: params.model,
        ...(params.thinkingLevel ? { thinkingLevel: params.thinkingLevel } : {}),
        commandInputTemplate: '{basePrompt}',
        ...(settings.agentCmdOverrides?.[params.agent]
          ? { agentCommandOverride: settings.agentCmdOverrides[params.agent] }
          : {})
      },
      prompt: params.prompt,
      target: { kind: 'local', cwd: target.cwd, env: target.env },
      operation: 'council',
      spawnAgent: spawnSourceControlAgent,
      shouldExecute: () => turn.active,
      laneId: params.operationId
    })
    return result.success
      ? { success: true, content: result.rawOutput, agentLabel: result.agentLabel }
      : { success: false, error: result.error, ...(result.canceled ? { cancelled: true } : {}) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (laneKey && listener) {
      clearLocalGenerationStdoutListener(laneKey, listener)
    }
    activeTurns.delete(params.operationId)
  }
}

async function assembleCatalogWithAuth(args: {
  capability: CouncilAgentCatalog
  env: NodeJS.ProcessEnv
  override?: string
  refreshAuth: boolean
}): Promise<CouncilAgentCatalog> {
  const { capability, env, override, refreshAuth } = args
  const supportsStreaming = supportsCouncilStreaming(capability.id)
  const supportsMultipleModels = agentSupportsMultipleModels(capability.id)
  const spec = isTuiAgent(capability.id) ? getCommitMessageAgentSpec(capability.id) : null
  const resolved = resolveExecutableCommand(override?.trim() || spec?.binary || capability.id, {
    pathEnv: env.PATH ?? env.Path ?? null
  })
  if (!resolved) {
    return {
      ...capability,
      available: false,
      availabilityNote: `${capability.label} CLI was not found on PATH.`,
      authStatus: 'unavailable',
      supportsStreaming,
      supportsMultipleModels
    }
  }
  const authInfo = await resolveCouncilAgentAuthInfo(capability.id, resolved, env, refreshAuth)
  const isUnauthenticated = authInfo.authStatus === 'unauthenticated'
  return {
    ...capability,
    available: !isUnauthenticated,
    ...(isUnauthenticated && authInfo.authNote ? { availabilityNote: authInfo.authNote } : {}),
    authStatus: authInfo.authStatus,
    ...(authInfo.authNote ? { authNote: authInfo.authNote } : {}),
    supportsStreaming,
    supportsMultipleModels
  }
}

export const COUNCIL_METHODS = [
  defineMethod({
    name: 'council.agents',
    permission: 'workspace',
    params: CouncilEmptyParams,
    handler: async (_params, ctx): Promise<{ agents: CouncilAgentCatalog[] }> => {
      const capabilities = listCommitMessageAgentCapabilities()
      const settings = ctx.runtime.requireStore().getSettings()
      const resolvers = ctx.runtime.getCommitMessageAgentEnvironmentResolvers()
      const agents = await Promise.all(
        capabilities.map(async (capability): Promise<CouncilAgentCatalog> => {
          const supportsStreaming = supportsCouncilStreaming(capability.id)
          const supportsMultipleModels = agentSupportsMultipleModels(capability.id)
          const override = settings.agentCmdOverrides?.[capability.id]?.trim()
          const prepared = await prepareLocalCommitMessageAgentEnv(capability.id, resolvers, {
            runtime: 'host'
          }).catch((error: unknown) => ({
            ok: false as const,
            error: error instanceof Error ? error.message : String(error)
          }))
          if (!prepared.ok) {
            return {
              ...capability,
              available: false,
              availabilityNote: prepared.error,
              authStatus: 'unavailable',
              supportsStreaming,
              supportsMultipleModels
            }
          }
          const env = withExtraAgentDirectoriesOnPath(capability.id, prepared.env ?? {})
          return await assembleCatalogWithAuth({
            capability,
            env,
            override,
            refreshAuth: false
          })
        })
      )
      return { agents }
    }
  }),
  defineMethod({
    name: 'council.models',
    permission: 'workspace',
    params: CouncilAgentParams,
    handler: async (params, ctx): Promise<CouncilModelsResult> => {
      if (!isTuiAgent(params.agent)) {
        return { success: false, error: 'Unsupported Council agent.' }
      }
      clearCouncilAuthCache(params.agent)
      try {
        const target = await localTarget(ctx.runtime, params.worktree, params.agent)
        const settings = ctx.runtime.requireStore().getSettings()
        const override = settings.agentCmdOverrides?.[params.agent]
        const result = await discoverCommitMessageModelsLocal(params.agent, target.env, override, {
          cwd: target.cwd
        })
        if (!result.success) {
          return { success: false, error: result.error }
        }
        const catalog = await assembleCatalogWithAuth({
          capability: { ...result.capability, models: result.models },
          env: target.env,
          override,
          refreshAuth: true
        })
        return {
          success: true,
          catalogOrigin: result.catalogOrigin,
          agent: catalog
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  }),
  defineMethod({
    name: 'council.generate',
    permission: 'workspace',
    params: CouncilGenerateParams,
    handler: async (params, ctx): Promise<CouncilGenerationResult> =>
      runCouncilTurn(params, ctx.runtime)
  }),
  defineStreamingMethod({
    name: 'council.generateStream',
    permission: 'workspace',
    params: CouncilGenerateParams,
    handler: async (params, ctx, emit): Promise<void> => {
      const result = await runCouncilTurn(params, ctx.runtime, (text) => {
        emit({ type: 'delta', text })
      })
      emit({ type: 'done', result })
    }
  }),
  defineMethod({
    name: 'council.cancel',
    permission: 'workspace',
    params: CouncilCancelParams,
    handler: async ({ operationId }): Promise<{ cancelled: boolean }> => {
      const turn = activeTurns.get(operationId)
      if (!turn) {
        return { cancelled: false }
      }
      turn.active = false
      cancelLocalGeneration('council', turn.cwd, operationId)
      return { cancelled: true }
    }
  })
]
