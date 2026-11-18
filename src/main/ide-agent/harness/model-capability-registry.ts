import { isTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-config'
import {
  getCommitMessageAgentSpec,
  getCommitMessageModel
} from '../../../shared/source-control/ai/generation/commit-message-agent-spec'

export type IdeModelFamily = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'moonshot' | 'generic'

export type IdePreferredEditFormat = 'search_replace' | 'unified_diff' | 'whole_file'
export type IdePromptDeliveryKind = 'stdin' | 'argv' | 'file'
export type IdeHarnessTaskKind = 'ask' | 'plan' | 'step' | 'repair' | 'review'

export type IdePromptTokenAllocation = {
  totalContextTokens: number
  maxPromptChars: number
  systemTokens: number
  projectRulesTokens: number
  retrievedContextTokens: number
  conversationHistoryTokens: number
  toolResultsTokens: number
  responseHeadroomTokens: number
}

export type ResolvedModelExecutionProfile = {
  agentId: string
  modelId: string
  family: IdeModelFamily
  promptDelivery: IdePromptDeliveryKind
  contextWindowTokens: number
  maxOutputTokens: number
  supportsStreaming: boolean
  supportsStructuredJson: boolean
  supportsPromptCaching: boolean
  maxParallelTools: number
  preferredEditFormat: IdePreferredEditFormat
  availableThinkingLevels: readonly string[]
  selectedThinkingLevel?: string
  allocation: IdePromptTokenAllocation
}

const ARGV_SAFE_MAX_PROMPT_CHARS = 24_000
const STDIN_MAX_PROMPT_CHARS = 340_000

function inferModelFamily(agentId: string, modelId: string): IdeModelFamily {
  const combined = `${agentId}/${modelId}`.toLowerCase()
  if (agentId === 'claude' || /\b(claude|sonnet|opus|haiku|anthropic)\b/.test(combined)) {
    return 'anthropic'
  }
  if (agentId === 'codex' || /\b(gpt-4|gpt-5|codex|o1|o3|o4|openai)\b/.test(combined)) {
    return 'openai'
  }
  if (agentId === 'antigravity' || /\b(gemini|carbon|flash|google)\b/.test(combined)) {
    return 'gemini'
  }
  if (agentId === 'dsh' || /\bdeepseek\b/.test(combined)) {
    return 'deepseek'
  }
  if (agentId === 'kimi' || /\b(kimi|moonshot)\b/.test(combined)) {
    return 'moonshot'
  }
  return 'generic'
}

function defaultContextWindowForFamily(family: IdeModelFamily, modelId: string): number {
  const lower = modelId.toLowerCase()
  if (family === 'gemini') {
    return 500_000
  }
  if (family === 'anthropic') {
    return 200_000
  }
  if (family === 'openai') {
    return lower.includes('gpt-4.1') ? 256_000 : 200_000
  }
  if (family === 'moonshot' || family === 'deepseek') {
    return 128_000
  }
  return 64_000
}

function selectPreferredEditFormat(family: IdeModelFamily): IdePreferredEditFormat {
  if (family === 'openai') {
    return 'unified_diff'
  }
  if (family === 'anthropic' || family === 'gemini' || family === 'moonshot') {
    return 'search_replace'
  }
  return 'search_replace'
}

function selectReasoningEffort(
  availableLevels: readonly string[],
  hasEffortFlag: boolean,
  taskKind: IdeHarnessTaskKind,
  complexity?: 'low' | 'medium' | 'high'
): string | undefined {
  if (!hasEffortFlag || availableLevels.length === 0) {
    return undefined
  }
  const desiredOrder =
    taskKind === 'repair' || complexity === 'high'
      ? ['high', 'medium', 'low']
      : taskKind === 'plan' || taskKind === 'review' || complexity === 'medium'
        ? ['medium', 'low', 'high']
        : ['low', 'medium']
  for (const candidate of desiredOrder) {
    if (availableLevels.includes(candidate)) {
      return candidate
    }
  }
  return availableLevels[0]
}

function computePromptAllocation(
  contextWindowTokens: number,
  promptDelivery: IdePromptDeliveryKind,
  maxOutputTokens: number
): IdePromptTokenAllocation {
  const maxPromptChars =
    promptDelivery === 'argv'
      ? ARGV_SAFE_MAX_PROMPT_CHARS
      : Math.min(
          STDIN_MAX_PROMPT_CHARS,
          Math.max(32_000, Math.floor(contextWindowTokens * 0.55 * 4))
        )
  const usablePromptTokens = Math.min(
    Math.floor(maxPromptChars / 4),
    Math.max(4_500, contextWindowTokens - maxOutputTokens)
  )
  const systemTokens = Math.min(1_800, Math.max(600, Math.floor(usablePromptTokens * 0.1)))
  const projectRulesTokens = Math.min(2_400, Math.max(400, Math.floor(usablePromptTokens * 0.1)))
  const conversationHistoryTokens = Math.min(
    6_000,
    Math.max(700, Math.floor(usablePromptTokens * 0.18))
  )
  const toolResultsTokens = Math.min(10_000, Math.max(900, Math.floor(usablePromptTokens * 0.22)))
  const retrievedContextTokens = Math.max(
    1_200,
    usablePromptTokens -
      systemTokens -
      projectRulesTokens -
      conversationHistoryTokens -
      toolResultsTokens
  )
  return {
    totalContextTokens: usablePromptTokens,
    maxPromptChars,
    systemTokens,
    projectRulesTokens,
    retrievedContextTokens,
    conversationHistoryTokens,
    toolResultsTokens,
    responseHeadroomTokens: maxOutputTokens
  }
}

export function resolveModelExecutionProfile(params: {
  agentId: string
  modelId: string
  taskKind: IdeHarnessTaskKind
  complexity?: 'low' | 'medium' | 'high'
  discoveredContextWindowTokens?: number
}): ResolvedModelExecutionProfile {
  const spec = isTuiAgent(params.agentId) ? getCommitMessageAgentSpec(params.agentId) : undefined
  const resolvedModelId = params.modelId?.trim() || spec?.defaultModelId || 'default'
  const specModel =
    spec && isTuiAgent(params.agentId)
      ? getCommitMessageModel(params.agentId, resolvedModelId)
      : undefined

  const family = inferModelFamily(params.agentId, resolvedModelId)
  const promptDelivery: IdePromptDeliveryKind = spec?.promptDelivery ?? 'stdin'
  const contextWindowTokens =
    params.discoveredContextWindowTokens ??
    specModel?.contextWindowTokens ??
    defaultContextWindowForFamily(family, resolvedModelId)
  const maxOutputTokens =
    family === 'anthropic' || family === 'openai' || family === 'gemini' ? 16_384 : 8_192
  const availableThinkingLevels = (specModel?.thinkingLevels ?? []).map((t) => t.id)
  const hasEffortFlag = Boolean(spec && spec.effortFlag.length > 0)
  const selectedThinkingLevel = selectReasoningEffort(
    availableThinkingLevels,
    hasEffortFlag,
    params.taskKind,
    params.complexity
  )

  return {
    agentId: params.agentId,
    modelId: resolvedModelId,
    family,
    promptDelivery,
    contextWindowTokens,
    maxOutputTokens,
    supportsStreaming: params.agentId !== 'jcode',
    supportsStructuredJson: true,
    supportsPromptCaching: family === 'anthropic' || family === 'openai' || family === 'gemini',
    maxParallelTools: family === 'generic' ? 3 : 6,
    preferredEditFormat: selectPreferredEditFormat(family),
    availableThinkingLevels,
    ...(selectedThinkingLevel ? { selectedThinkingLevel } : {}),
    allocation: computePromptAllocation(contextWindowTokens, promptDelivery, maxOutputTokens)
  }
}

export function buildModelEditGuidance(profile: ResolvedModelExecutionProfile): string {
  if (profile.family === 'openai') {
    return 'Edit guidance: Prefer surgical `patch` operations using either `unifiedDiff` (standard `@@ -a,b +c,d @@` hunks) or `patches` (`[{ "search": "...", "replace": "..." }]`) with 2-3 context lines so unrelated lines remain untouched. Use `create`/`modify` with complete `content` for brand-new or small files.'
  }
  if (profile.family === 'anthropic') {
    return 'Edit guidance: Prefer exact `patch` operations (`[{ "search": "...", "replace": "..." }]`) that include 2-3 surrounding unchanged lines so every `search` block is unique in the target file. Use `create`/`modify` with complete `content` only for new or small files.'
  }
  if (profile.family === 'gemini') {
    return 'Edit guidance: Output strictly valid fenced JSON. Prefer targeted `patch` operations (`search`/`replace` with unique surrounding lines or `unifiedDiff`) on existing files, and `create`/`modify` with full `content` for new files.'
  }
  return 'Edit guidance: Prefer `patch` (`patches` search/replace with unique surrounding lines, or `unifiedDiff`) when editing existing files; use `create`/`modify` with complete `content` for new or short files.'
}
