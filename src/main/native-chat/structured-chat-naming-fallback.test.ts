import { describe, expect, it, vi } from 'vitest'
import { stripTemporaryAttachmentPaths } from '../../shared/agent-session/requests/structured-agent-session-first-prompt'
import { conversationNameSeed } from '../../shared/source-control/ai/generation/conversation-name-generation'
import { createStructuredChatNamingHandler } from './structured-chat-naming'
import { agentSessionRecordFixture } from './agent-session-record-test-fixture'
import {
  compareAndSetAgentSessionRecordName,
  setAgentSessionRecordUserName
} from '../runtime/agent-session/records/agent-session-record-conversation-name'
import { openCodeTextTaskEvents } from '../opencode/text-tasks/opencode-text-task-events'
import { createOpenCodeTextTaskHttp } from '../opencode/text-tasks/opencode-text-task-http'

describe('chat auto-naming sanitization and fallback', () => {
  it('strips Windows AppData temporary attachment paths while keeping Arabic and English text', () => {
    const withAttachment =
      'اصلاح خطأ البناء "C:\\Users\\engelsayedebaid\\AppData\\Roaming\\Orca Nexus\\agent-session-attachments\\12345678-1234-1234-1234-1234567890ab\\screenshot 1.png" الآن'
    expect(stripTemporaryAttachmentPaths(withAttachment)).toBe('اصلاح خطأ البناء الآن')

    const attachmentOnly =
      'C:\\Users\\user\\AppData\\Roaming\\Code Nexus\\agent-session-attachments\\12345678-1234-1234-1234-1234567890ab\\trace.log'
    expect(stripTemporaryAttachmentPaths(attachmentOnly)).toBe('')

    expect(conversationNameSeed('## مراجعة [الملف](https://example.com)\nتفاصيل إضافية')).toBe(
      'مراجعة الملف'
    )
  })

  it('keeps clean fallback seed and suppresses red failure state on automatic naming errors', async () => {
    let record = agentSessionRecordFixture({ sessionId: 'chat-ar' })
    const handler = createStructuredChatNamingHandler({
      getStore: () => ({
        getRecord: () => record,
        compareAndSetConversationName: async (_id, name, expected, context, applicable) =>
          compareAndSetAgentSessionRecordName(
            async (apply) => {
              record = apply(record)
              return record
            },
            name,
            expected,
            context,
            applicable
          ),
        setUserConversationName: async (_id, name, write) => {
          const result = setAgentSessionRecordUserName(record, name, write, 1)
          record = result.record
          return result
        }
      }),
      getSettings: () => ({ nativeChatAutoName: true }),
      readFirstPrompt: async () =>
        'حل مشكلة الاتجاه العربي في المحادثات C:\\Users\\dev\\AppData\\Local\\Temp\\shot.png',
      readJournalFirstPrompt: async () =>
        'حل مشكلة الاتجاه العربي في المحادثات C:\\Users\\dev\\AppData\\Local\\Temp\\shot.png',
      workerTaskTitle: () => null,
      generate: async () => ({ error: 'OpenCode reported an error. Insufficient balance' }),
      wait: async () => {},
      onNamed: () => {},
      logger: { warn: vi.fn(), error: vi.fn() }
    })

    handler(
      {
        sessionId: 'chat-ar',
        workspaceId: 'w1',
        agent: 'opencode',
        status: 'working',
        latestPrompt: '...',
        updatedAt: 1
      },
      { replay: false, firstInputSubmissionKey: 'k1' }
    )

    await vi.waitFor(() => expect(handler.activeSessionIds()).toEqual([]))
    expect(record.conversationName).toBe('حل مشكلة الاتجاه العربي في المحادثات')
    expect(handler.failure('chat-ar')).toBeUndefined()

    // Manual regeneration surfaces the detailed error while preserving the user-facing name.
    handler.regenerate('chat-ar')
    await vi.waitFor(() => expect(handler.activeSessionIds()).toEqual([]))
    expect(handler.failure('chat-ar')?.message).toContain('Insufficient balance')
  })

  it('surfaces real OpenCode session.step.failed error details instead of generic failure copy', async () => {
    const encoder = new TextEncoder()
    const payload = [
      'data: {"type":"session.step.failed","data":{"sessionID":"ses_1","error":{"type":"provider.quota","message":"Insufficient balance"}}}\n\n',
      'data: {"type":"session.execution.failed","data":{"sessionID":"ses_1"}}\n\n'
    ].join('')
    let sent = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true
              controller.enqueue(encoder.encode(payload))
            }
          }
        })
        const reader = stream.getReader()
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const value = await reader.read()
            if (value.done) {
              controller.close()
            } else {
              controller.enqueue(value.value)
            }
          },
          async cancel() {
            await reader.cancel()
          }
        })
        options?.signal?.addEventListener('abort', () => void reader.cancel(), { once: true })
        return new Response(body)
      })
    )
    const events = openCodeTextTaskEvents({
      version: 'v2',
      url: 'http://fixture',
      signal: new AbortController().signal,
      lost: new AbortController(),
      messageID: 'msg_1',
      context: () => ({
        sessionID: 'ses_1',
        owned: true,
        ownedTree: new Set(['ses_1']),
        directory: '/workspace',
        http: createOpenCodeTextTaskHttp('http://fixture', undefined, '')
      })
    })
    await events.subscribe()
    await expect(events.completion).rejects.toThrow('Insufficient balance')
    await events.close()
    vi.unstubAllGlobals()
  })
})
