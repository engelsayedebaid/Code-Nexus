import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { IdeAiClient, IdeAiCompletionRequest } from './ide-ai-client'
import { PromptEnhancementService } from './ide-prompt-enhancement-service'
import { LocalIdeWorkspaceGateway } from './ide-workspace-gateway'

const tempDirs: string[] = []

async function createTestGateway(files: Record<string, string>): Promise<LocalIdeWorkspaceGateway> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-prompt-enhancer-'))
  tempDirs.push(dir)
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath)
    const slashIdx = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'))
    if (slashIdx > dir.length) {
      await mkdir(fullPath.slice(0, slashIdx), { recursive: true })
    }
    await writeFile(fullPath, content, 'utf8')
  }
  return new LocalIdeWorkspaceGateway({
    worktreeId: 'wt-test',
    workspacePath: dir,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  })
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

describe('PromptEnhancementService', () => {
  it('rejects whitespace-only drafts without invoking the AI provider', async () => {
    let called = false
    const gateway = await createTestGateway({})
    const aiClient: IdeAiClient = {
      listProviders: async () => [],
      complete: async () => {
        called = true
        return { ok: true, text: 'unused' }
      }
    }
    const service = new PromptEnhancementService({
      aiClient,
      resolveGateway: async () => gateway
    })

    const res = await service.enhancePrompt({
      requestId: 'req-empty',
      draft: '   \n  '
    })

    expect(called).toBe(false)
    expect(res).toEqual({
      ok: false,
      requestId: 'req-empty',
      error: 'Prompt cannot be empty.'
    })
  })

  it('unwraps <enhanced_prompt>, injects safe context, and blocks .env and inline secrets', async () => {
    const capturedPrompts: string[] = []
    const gateway = await createTestGateway({
      'AGENTS.md':
        'Follow TypeScript strict mode. Token sk-secret1234567890abcdef should never leak.',
      '.env': 'OPENAI_API_KEY=sk-live-99999999999999999999',
      'src/chat.ts': 'export function renderChat() { return true }'
    })
    const aiClient: IdeAiClient = {
      listProviders: async () => [],
      complete: async (req: IdeAiCompletionRequest) => {
        capturedPrompts.push(req.prompt)
        return {
          ok: true,
          text: 'Here is the enhanced prompt:\n<enhanced_prompt>\nأصلح خطأ التمرير في `IdeAiChatView.tsx` مع الحفاظ على التوافقية.\n</enhanced_prompt>'
        }
      }
    }
    const service = new PromptEnhancementService({
      aiClient,
      resolveGateway: async () => gateway,
      defaultAgentId: 'claude'
    })

    const res = await service.enhancePrompt({
      requestId: 'req-1',
      conversationId: 'conv-1',
      draft: 'صلح الاسكرول في الشات IdeAiChatView.tsx',
      mode: 'agent',
      modelId: 'claude-sonnet-4-5',
      activeFilePath: '.env',
      selectedCode: {
        relativePath: 'src/chat.ts',
        startLine: 1,
        endLine: 1,
        text: 'const apiKey = "sk-proj1234567890abcdefghij";'
      },
      mentionedPaths: ['.env', 'src/chat.ts']
    })

    expect(res).toEqual({
      ok: true,
      requestId: 'req-1',
      enhancedPrompt: 'أصلح خطأ التمرير في `IdeAiChatView.tsx` مع الحفاظ على التوافقية.',
      agentId: 'claude',
      modelId: 'claude-sonnet-4-5'
    })
    expect(capturedPrompts).toHaveLength(1)
    expect(capturedPrompts[0]).toContain('`src/chat.ts`')
    expect(capturedPrompts[0]).not.toContain('.env')
    expect(capturedPrompts[0]).not.toContain('OPENAI_API_KEY')
    expect(capturedPrompts[0]).not.toContain('sk-secret1234567890abcdef')
    expect(capturedPrompts[0]).not.toContain('sk-proj1234567890abcdefghij')
    expect(capturedPrompts[0]).toContain('[REDACTED_SECRET]')
  })

  it('supports cancellation and provider error reporting cleanly', async () => {
    const gateway = await createTestGateway({})
    let resolveStarted: (() => void) | null = null
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    let observedSignal: AbortSignal | undefined
    const aiClient: IdeAiClient = {
      listProviders: async () => [],
      complete: async (req) => {
        observedSignal = req.signal
        resolveStarted?.()
        return await new Promise((resolve) => {
          req.signal?.addEventListener(
            'abort',
            () => resolve({ ok: false, error: 'Aborted', canceled: true }),
            { once: true }
          )
        })
      }
    }
    const service = new PromptEnhancementService({
      aiClient,
      resolveGateway: async () => gateway,
      defaultAgentId: 'codex'
    })

    const pending = service.enhancePrompt({
      requestId: 'req-cancel',
      conversationId: 'conv-1',
      draft: 'refactor parser'
    })
    await started
    expect(service.cancel('req-cancel')).toBe(true)
    expect(observedSignal?.aborted).toBe(true)

    const cancelledRes = await pending
    expect(cancelledRes).toEqual({
      ok: false,
      requestId: 'req-cancel',
      error: 'Enhancement cancelled.',
      cancelled: true
    })
  })
})
