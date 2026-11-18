import { randomUUID } from 'node:crypto'
import type {
  IdeProviderAgentOption,
  IdeProviderModelOption
} from '../../shared/ide-agent/ide-agent-types'
import type { TuiAgent } from '../../shared/agent-launch/catalog/tui-agent'
import { isTuiAgent } from '../../shared/agent-launch/catalog/tui-agent-config'
import { resolveExecutableCommand } from '../../shared/node-cli-command-resolution'
import {
  getCommitMessageAgentSpec,
  listCommitMessageAgentCapabilities,
  type CommitMessageModel
} from '../../shared/source-control/ai/generation/commit-message-agent-spec'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { discoverCommitMessageModelsLocal } from '../text-generation/commit-message-text-generation'
import { runGenerationRequest } from '../text-generation/agent-generation-request'
import { spawnSourceControlAgent } from '../text-generation/source-control-agent-launch'
import {
  cancelLocalGeneration,
  clearLocalGenerationStdoutListener,
  localGenerationLaneKey,
  setLocalGenerationStdoutListener
} from '../text-generation/source-control-generation-lanes'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { parsePartialCouncilOutput } from '../runtime/rpc/methods/council/council-stream-parser'
import { wslDistroForCommand } from '../../shared/wsl-paths'
import { parseKimiGenerationOutput } from '../../shared/kimi-generation-output'
import { resolveModelExecutionProfile } from './harness/model-capability-registry'

const BUFFERED_JSON_AGENTS = new Set(['jcode'])

function decodePartialAgentStdout(agentId: string, stdout: string): string | null {
  if (BUFFERED_JSON_AGENTS.has(agentId)) {
    return null
  }
  if (agentId === 'antigravity' || agentId === 'opencode' || agentId === 'opencode2') {
    return parsePartialCouncilOutput(agentId, stdout)
  }
  if (agentId === 'kimi') {
    const lastNewline = stdout.lastIndexOf('\n')
    if (lastNewline === -1) {
      return null
    }
    const parsed = parseKimiGenerationOutput(stdout.slice(0, lastNewline + 1))
    return parsed.ok ? parsed.text : null
  }
  return stdout
}

export type IdeAiCompletionRequest = {
  workspacePath: string
  agentId: string
  modelId: string
  prompt: string
  thinkingLevel?: string
  signal?: AbortSignal
  onDelta?: (deltaText: string) => void
  timeoutMs?: number
}

export type IdeAiCompletionResponse =
  | { ok: true; text: string }
  | { ok: false; error: string; canceled?: boolean }

export type IdeAiClient = {
  listProviders(worktreeSelector?: string): Promise<IdeProviderAgentOption[]>
  complete(request: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse>
}

function mapModels(
  agentId: string,
  models: readonly Pick<
    CommitMessageModel,
    'id' | 'label' | 'contextWindowTokens' | 'thinkingLevels'
  >[],
  defaultId: string
): IdeProviderModelOption[] {
  return models.map((model) => {
    const profile = resolveModelExecutionProfile({
      agentId,
      modelId: model.id,
      taskKind: 'ask',
      discoveredContextWindowTokens: model.contextWindowTokens
    })
    return {
      id: model.id,
      label: model.label,
      isDefault: model.id === defaultId,
      supportsStreaming: profile.supportsStreaming,
      contextWindowTokens: profile.contextWindowTokens,
      family: profile.family,
      preferredEditFormat: profile.preferredEditFormat,
      supportsReasoningEffort: profile.availableThinkingLevels.length > 0,
      promptDelivery: profile.promptDelivery
    }
  })
}

export class RuntimeIdeAiClient implements IdeAiClient {
  constructor(private readonly runtime: OrcaRuntimeService) {}

  async listProviders(worktreeSelector?: string): Promise<IdeProviderAgentOption[]> {
    const settings = this.runtime.requireStore().getSettings()
    const disabled = settings.disabledTuiAgents ?? []
    const capabilities = listCommitMessageAgentCapabilities().filter(
      (cap) => !disabled.includes(cap.id)
    )
    const resolvers = this.runtime.getCommitMessageAgentEnvironmentResolvers()
    const targetWorkspace = worktreeSelector
      ? await this.runtime.resolveRuntimeFileTarget(worktreeSelector).catch(() => null)
      : null
    const cwd = targetWorkspace?.worktree.path
    const wslDistro = cwd ? (wslDistroForCommand(cwd) ?? undefined) : undefined

    const options = await Promise.all(
      capabilities.map(async (capability): Promise<IdeProviderAgentOption | null> => {
        if (!isTuiAgent(capability.id)) {
          return null
        }
        const spec = getCommitMessageAgentSpec(capability.id)
        if (!spec) {
          return null
        }
        const override = settings.agentCmdOverrides?.[capability.id]?.trim()
        const prepared = await prepareLocalCommitMessageAgentEnv(capability.id, resolvers, {
          runtime: wslDistro ? 'wsl' : 'host',
          ...(wslDistro ? { wslDistro } : {})
        }).catch(() => ({ ok: false as const, error: 'env_failed' }))
        const pathEnv = prepared.ok
          ? (prepared.env?.PATH ?? prepared.env?.Path ?? process.env.PATH ?? process.env.Path)
          : null
        const resolvedBinary = prepared.ok
          ? resolveExecutableCommand(override || spec.binary, { pathEnv })
          : null
        const available = Boolean(resolvedBinary)

        let models = mapModels(capability.id, capability.models, capability.defaultModelId)
        if (available && prepared.ok && capability.modelSource === 'dynamic') {
          const discovered = await discoverCommitMessageModelsLocal(
            capability.id,
            prepared.env,
            override,
            { ...(cwd ? { cwd } : {}), ...(wslDistro ? { wslDistro } : {}) }
          ).catch(() => null)
          if (discovered?.success && discovered.models.length > 0) {
            models = mapModels(capability.id, discovered.models, discovered.defaultModelId)
          }
        }

        return {
          id: spec.id,
          label: spec.label,
          binary: spec.binary,
          available,
          defaultModelId: capability.defaultModelId,
          models,
          supportsStreaming: !BUFFERED_JSON_AGENTS.has(spec.id),
          supportsToolLoop: true,
          ...(available
            ? {}
            : { unavailableReason: `${spec.label} CLI (${spec.binary}) not detected on PATH.` })
        }
      })
    )
    return options.filter((opt): opt is IdeProviderAgentOption => opt !== null)
  }

  async complete(request: IdeAiCompletionRequest): Promise<IdeAiCompletionResponse> {
    if (!isTuiAgent(request.agentId)) {
      return { ok: false, error: `Unsupported AI agent "${request.agentId}".` }
    }
    const spec = getCommitMessageAgentSpec(request.agentId as TuiAgent)
    if (!spec) {
      return {
        ok: false,
        error: `Agent "${request.agentId}" does not support text/code generation.`
      }
    }
    const settings = this.runtime.requireStore().getSettings()
    const resolvers = this.runtime.getCommitMessageAgentEnvironmentResolvers()
    const wslDistro = wslDistroForCommand(request.workspacePath) ?? undefined
    const preparedEnv = await prepareLocalCommitMessageAgentEnv(spec.id, resolvers, {
      runtime: wslDistro ? 'wsl' : 'host',
      ...(wslDistro ? { wslDistro } : {})
    })
    if (!preparedEnv.ok) {
      return { ok: false, error: preparedEnv.error }
    }

    const operationId = randomUUID()
    const laneKey = localGenerationLaneKey('council', request.workspacePath, operationId)
    let emittedText = ''
    const onStdout = (stdout: string): void => {
      const decoded = decodePartialAgentStdout(spec.id, stdout)
      if (!decoded || decoded.length <= emittedText.length || !decoded.startsWith(emittedText)) {
        return
      }
      const delta = decoded.slice(emittedText.length)
      emittedText = decoded
      request.onDelta?.(delta)
    }

    const onAbort = (): void => {
      cancelLocalGeneration('council', request.workspacePath, operationId)
    }

    if (request.signal?.aborted) {
      return { ok: false, error: 'Canceled by user.', canceled: true }
    }

    request.signal?.addEventListener('abort', onAbort, { once: true })
    if (request.onDelta) {
      setLocalGenerationStdoutListener(laneKey, onStdout)
    }

    try {
      const override = settings.agentCmdOverrides?.[spec.id]
      const result = await runGenerationRequest({
        params: {
          agentId: spec.id,
          model: request.modelId || spec.defaultModelId,
          ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
          ...(override ? { agentCommandOverride: override } : {})
        },
        prompt: request.prompt,
        target: {
          kind: 'local',
          cwd: request.workspacePath,
          ...(wslDistro ? { wslDistro } : {}),
          ...(preparedEnv.env ? { env: preparedEnv.env } : {})
        },
        operation: 'council',
        spawnAgent: spawnSourceControlAgent,
        shouldExecute: () => !request.signal?.aborted,
        laneId: operationId,
        timeoutMs: request.timeoutMs ?? 180_000
      })

      if (!result.success) {
        return {
          ok: false,
          error: result.error || 'Generation failed.',
          canceled: 'canceled' in result && Boolean(result.canceled)
        }
      }
      const finalText = result.rawOutput.trim()
      if (!finalText) {
        return { ok: false, error: 'The model returned an empty response.' }
      }
      if (finalText.length > emittedText.length && finalText.startsWith(emittedText)) {
        request.onDelta?.(finalText.slice(emittedText.length))
      }
      return { ok: true, text: finalText }
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
      clearLocalGenerationStdoutListener(laneKey, onStdout)
    }
  }
}
