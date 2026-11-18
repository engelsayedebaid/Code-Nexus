import type { IdeConversation } from '../../shared/ide-agent/ide-agent-types'
import {
  classifySensitiveFilePath,
  isUnsafeRelativePath,
  normalizeWorkspaceRelativePath
} from '../../shared/ide-agent/ide-plan-policy'
import type {
  IdeEnhancePromptRequest,
  IdeEnhancePromptResult
} from '../../shared/ide-agent/ide-prompt-enhancer-types'
import { resolveModelExecutionProfile } from './harness/model-capability-registry'
import type { IdeAiClient } from './ide-ai-client'
import type { ResolveWorkspaceGateway } from './ide-agent-runtime-types'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'

const DEFAULT_ENHANCE_TIMEOUT_MS = 45_000
const MAX_ENHANCED_OUTPUT_CHARS = 32_000
const INSTRUCTION_CANDIDATE_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'] as const

export const PROMPT_ENHANCER_SYSTEM_INSTRUCTION = `You are an expert AI Coding Prompt Engineer.

Improve the user's draft into a clear, precise, effective prompt optimized for AI coding agents.

Follow these rules:
1. Preserve the user's original intention exactly.
2. Never invent missing project requirements.
3. Correct spelling and grammar.
4. Improve clarity and technical precision.
5. Organize complex instructions logically.
6. Add implementation details only when justified.
7. Preserve existing restrictions and constraints.
8. Preserve filenames, paths, variables, URLs, and technical identifiers.
9. Preserve code blocks unless modification is explicitly requested.
10. Preserve the original language by default.
11. Support Arabic, English, and mixed-language prompts.
12. Avoid unnecessary verbosity.
13. Make debugging instructions emphasize root-cause analysis.
14. Make implementation instructions specify expected results and relevant verification.
15. Make refactoring instructions emphasize backward compatibility.
16. Avoid adding unrelated tasks.
17. Keep short prompts short.
18. Structure complex prompts when useful.
19. Do not expand the user's authorization to execute risky actions.
20. Return only the enhanced prompt.`

const INLINE_SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,})\b/g

function redactInlineSecrets(text: string): string {
  return text.replace(INLINE_SECRET_PATTERN, '[REDACTED_SECRET]')
}

function isSafeContextPath(rawPath: string | undefined): string | null {
  if (!rawPath) {
    return null
  }
  const normalized = normalizeWorkspaceRelativePath(rawPath)
  if (!normalized || isUnsafeRelativePath(normalized)) {
    return null
  }
  if (classifySensitiveFilePath(normalized, 'read-context') !== null) {
    return null
  }
  return normalized
}

export function cleanEnhancedPromptOutput(rawOutput: string, fallbackMaxChars: number): string {
  let cleaned = rawOutput.trim()
  const tagged = cleaned.match(/<enhanced_prompt>\s*([\s\S]*?)\s*<\/enhanced_prompt>/i)
  cleaned = tagged?.[1]
    ? tagged[1].trim()
    : cleaned
        .replace(
          /^(?:here(?:'s| is)\s+(?:the\s+|your\s+)?(?:enhanced|improved)\s+prompt\s*:\s*)/i,
          ''
        )
        .trim()
  if (cleaned.length > fallbackMaxChars) {
    cleaned = cleaned.slice(0, fallbackMaxChars).trimEnd()
  }
  return cleaned
}

async function readSafeWorkspaceContextSnippet(
  gateway: IdeWorkspaceGateway | null,
  request: IdeEnhancePromptRequest
): Promise<string> {
  const sections: string[] = []
  const safeActivePath = isSafeContextPath(request.activeFilePath)
  if (safeActivePath) {
    sections.push(`Active editor file: \`${safeActivePath}\``)
  }

  if (request.selectedCode) {
    const safeSelPath = isSafeContextPath(request.selectedCode.relativePath)
    const snippet = redactInlineSecrets(request.selectedCode.text.trim()).slice(0, 1_800)
    if (safeSelPath && snippet) {
      sections.push(
        `Selected editor range (\`${safeSelPath}\` L${request.selectedCode.startLine}-L${request.selectedCode.endLine}):\n\`\`\`\n${snippet}\n\`\`\``
      )
    }
  }

  const safeMentions = (request.mentionedPaths ?? [])
    .map((p) => isSafeContextPath(p))
    .filter((p): p is string => p !== null)
    .slice(0, 8)
  if (safeMentions.length > 0) {
    sections.push(`Explicitly mentioned paths: ${safeMentions.map((p) => `\`${p}\``).join(', ')}`)
  }

  if (gateway) {
    for (const candidate of INSTRUCTION_CANDIDATE_FILES) {
      const safeDoc = isSafeContextPath(candidate)
      if (!safeDoc) {
        continue
      }
      const docRead = await gateway.readTextFile(safeDoc).catch(() => null)
      if (docRead && docRead.ok && docRead.content) {
        const preview = redactInlineSecrets(docRead.content.trim()).slice(0, 900)
        if (preview) {
          sections.push(`Project conventions excerpt (\`${safeDoc}\`):\n${preview}`)
          break
        }
      }
    }

    for (const relPath of safeMentions.slice(0, 2)) {
      const fileRead = await gateway.readTextFile(relPath).catch(() => null)
      if (fileRead && fileRead.ok && fileRead.content) {
        const preview = redactInlineSecrets(fileRead.content.trim()).slice(0, 900)
        if (preview) {
          sections.push(`Mentioned file header (\`${relPath}\`):\n\`\`\`\n${preview}\n\`\`\``)
        }
      }
    }
  }

  return sections.join('\n\n')
}

export class PromptEnhancementService {
  private readonly controllersByRequestId = new Map<string, AbortController>()
  private readonly activeRequestByScope = new Map<string, string>()

  constructor(
    private readonly deps: {
      aiClient: IdeAiClient
      resolveGateway: ResolveWorkspaceGateway
      getConversation?: (conversationId: string) => IdeConversation | null
      defaultAgentId?: string
      timeoutMs?: number
    }
  ) {}

  cancel(requestId: string): boolean {
    const controller = this.controllersByRequestId.get(requestId)
    if (!controller) {
      return false
    }
    controller.abort()
    this.controllersByRequestId.delete(requestId)
    for (const [scope, activeId] of this.activeRequestByScope.entries()) {
      if (activeId === requestId) {
        this.activeRequestByScope.delete(scope)
      }
    }
    return true
  }

  async enhancePrompt(
    request: IdeEnhancePromptRequest,
    externalSignal?: AbortSignal
  ): Promise<IdeEnhancePromptResult> {
    const trimmedDraft = request.draft.trim()
    if (!trimmedDraft) {
      return { ok: false, requestId: request.requestId, error: 'Prompt cannot be empty.' }
    }

    const scopeKey = request.conversationId ?? 'global'
    const previousRequestId = this.activeRequestByScope.get(scopeKey)
    if (previousRequestId && previousRequestId !== request.requestId) {
      this.cancel(previousRequestId)
    }

    const controller = new AbortController()
    this.controllersByRequestId.set(request.requestId, controller)
    this.activeRequestByScope.set(scopeKey, request.requestId)

    const onExternalAbort = (): void => controller.abort()
    if (externalSignal?.aborted) {
      controller.abort()
    } else {
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const conversation = request.conversationId
        ? (this.deps.getConversation?.(request.conversationId) ?? null)
        : null
      const selectorOrPath =
        request.worktreeSelector ||
        request.workspacePath ||
        conversation?.workspacePath ||
        process.cwd()

      const gateway = await this.deps.resolveGateway(selectorOrPath).catch(() => null)
      const workspacePath =
        gateway?.target.workspacePath ||
        request.workspacePath ||
        conversation?.workspacePath ||
        process.cwd()

      let agentId = request.agentId || conversation?.agentId || this.deps.defaultAgentId || ''
      let modelId = request.modelId || conversation?.modelId || ''
      if (!agentId) {
        const providers = await this.deps.aiClient
          .listProviders(request.worktreeSelector)
          .catch(() => [])
        const available = providers.find((p) => p.available) ?? providers[0]
        if (!available) {
          return {
            ok: false,
            requestId: request.requestId,
            error: 'No configured AI provider is available to enhance this prompt.'
          }
        }
        agentId = available.id
        modelId = modelId || available.defaultModelId
      }

      const profile = resolveModelExecutionProfile({
        agentId,
        modelId: modelId || 'default',
        taskKind: 'ask'
      })
      const contextBlock = await readSafeWorkspaceContextSnippet(gateway, request)

      if (controller.signal.aborted) {
        return {
          ok: false,
          requestId: request.requestId,
          error: 'Enhancement cancelled.',
          cancelled: true
        }
      }

      const modeHint = request.mode ?? conversation?.mode ?? 'agent'
      const variationLine = request.regenerate
        ? '\nGenerate a fresh, distinct phrasing and structure compared to a prior attempt while strictly preserving intent.'
        : ''
      const prompt = [
        PROMPT_ENHANCER_SYSTEM_INSTRUCTION,
        '',
        'Operational constraints:',
        '- Do NOT execute tools, inspect unlisted files, or output conversational filler.',
        '- Wrap ONLY the final improved prompt inside <enhanced_prompt>...</enhanced_prompt> tags.',
        `- Target IDE execution mode: ${modeHint} (model family: ${profile.family}).${variationLine}`,
        contextBlock
          ? `\nWorkspace reference context (background reference only — do not paste raw file contents or invent facts):\n${contextBlock}`
          : '',
        '\nUser draft prompt to enhance:\n<user_draft>',
        trimmedDraft,
        '</user_draft>'
      ]
        .filter(Boolean)
        .join('\n')

      const completion = await this.deps.aiClient.complete({
        workspacePath,
        agentId,
        modelId,
        prompt,
        signal: controller.signal,
        timeoutMs: this.deps.timeoutMs ?? DEFAULT_ENHANCE_TIMEOUT_MS
      })

      if (!completion.ok) {
        const isCancelled = Boolean(completion.canceled || controller.signal.aborted)
        return {
          ok: false,
          requestId: request.requestId,
          error: isCancelled ? 'Enhancement cancelled.' : completion.error,
          cancelled: isCancelled
        }
      }

      const maxChars = Math.min(Math.max(trimmedDraft.length * 4, 8_000), MAX_ENHANCED_OUTPUT_CHARS)
      const enhancedPrompt = cleanEnhancedPromptOutput(completion.text, maxChars)
      if (!enhancedPrompt) {
        return {
          ok: false,
          requestId: request.requestId,
          error: 'The AI provider returned an empty enhanced prompt.'
        }
      }

      return {
        ok: true,
        requestId: request.requestId,
        enhancedPrompt,
        agentId,
        modelId
      }
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      this.controllersByRequestId.delete(request.requestId)
      if (this.activeRequestByScope.get(scopeKey) === request.requestId) {
        this.activeRequestByScope.delete(scopeKey)
      }
    }
  }
}
