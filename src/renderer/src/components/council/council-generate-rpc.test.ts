// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CouncilParticipant } from '../../../../shared/council/council-contract'
import { runCouncilGenerateRpc } from './council-generate-rpc'

const participant: CouncilParticipant = {
  id: 'p-gemini',
  agent: 'antigravity',
  label: 'Antigravity',
  model: 'gemini-2.5-pro',
  modelLabel: 'Gemini 2.5 Pro',
  role: 'Architect',
  moderator: true
}

const originalApi = (window as unknown as { api?: unknown }).api

afterEach(() => {
  ;(window as unknown as { api?: unknown }).api = originalApi
  vi.restoreAllMocks()
})

describe('runCouncilGenerateRpc', () => {
  it('streams deltas and returns final done result while unsubscribing', async () => {
    const unsubscribe = vi.fn()
    const call = vi.fn()
    const subscribe = vi.fn((_req, listener: (msg: unknown) => void) => {
      queueMicrotask(() => {
        listener({ ok: true, result: { type: 'delta', text: 'Part 1 ' } })
        listener({ ok: true, result: { type: 'delta', text: 'Part 1 + 2' } })
        listener({
          ok: true,
          result: { type: 'done', result: { success: true, content: 'Part 1 + 2' } }
        })
      })
      return { unsubscribe }
    })
    ;(window as unknown as { api?: unknown }).api = {
      runtime: { subscribe, call }
    }

    const deltas: string[] = []
    const result = await runCouncilGenerateRpc({
      workspaceId: 'C:\\repo',
      operationId: 'op-stream-1',
      participant,
      prompt: 'Review architecture',
      onDelta: (text) => deltas.push(text)
    })

    expect(deltas).toEqual(['Part 1 ', 'Part 1 + 2'])
    expect(result).toEqual({ success: true, content: 'Part 1 + 2' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(call).not.toHaveBeenCalled()
  })

  it('falls back to unary council.generate if stream errors before any event arrives', async () => {
    const unsubscribe = vi.fn()
    const call = vi.fn().mockResolvedValue({
      ok: true,
      result: { success: true, content: 'Unary fallback answer' }
    })
    const subscribe = vi.fn((_req, listener: (msg: unknown) => void) => {
      queueMicrotask(() => {
        listener({
          ok: false,
          error: { code: 'method_not_found', message: 'Method not implemented' }
        })
      })
      return { unsubscribe }
    })
    ;(window as unknown as { api?: unknown }).api = {
      runtime: { subscribe, call }
    }

    const result = await runCouncilGenerateRpc({
      workspaceId: 'C:\\repo',
      operationId: 'op-fallback-1',
      participant,
      prompt: 'Fallback test',
      onDelta: () => {}
    })

    expect(result).toEqual({ success: true, content: 'Unary fallback answer' })
    expect(call).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('does not re-invoke unary generation if stream errors after deltas already arrived', async () => {
    const unsubscribe = vi.fn()
    const call = vi.fn()
    const subscribe = vi.fn((_req, listener: (msg: unknown) => void) => {
      queueMicrotask(() => {
        listener({ ok: true, result: { type: 'delta', text: 'Partial' } })
        listener({
          ok: false,
          error: { code: 'internal_error', message: 'Mid-stream disconnect' }
        })
      })
      return { unsubscribe }
    })
    ;(window as unknown as { api?: unknown }).api = {
      runtime: { subscribe, call }
    }

    const result = await runCouncilGenerateRpc({
      workspaceId: 'C:\\repo',
      operationId: 'op-mid-err',
      participant,
      prompt: 'Partial error',
      onDelta: () => {}
    })

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('Mid-stream disconnect')
    })
    expect(call).not.toHaveBeenCalled()
  })
})
