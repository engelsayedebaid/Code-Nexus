import { z } from 'zod'
import { MAX_SOURCE_CONTROL_AGENT_OUTPUT_BYTES } from '../../text-generation/source-control-generation-limits'

const envelope = z.looseObject({ data: z.unknown().optional() })

export function extractOpenCodeV1InfoError(error: unknown): string | null {
  if (typeof error === 'string') {
    return error.trim() || null
  }
  if (!error || typeof error !== 'object') {
    return null
  }
  const obj = error as { message?: unknown; data?: { message?: unknown }; name?: unknown }
  if (typeof obj.data?.message === 'string' && obj.data.message.trim()) {
    return obj.data.message.trim()
  }
  if (typeof obj.message === 'string' && obj.message.trim()) {
    return obj.message.trim()
  }
  if (typeof obj.name === 'string' && obj.name.trim()) {
    return obj.name.trim()
  }
  return null
}

function unwrap(value: unknown): unknown {
  const parsed = envelope.safeParse(value)
  return parsed.success && parsed.data.data !== undefined ? parsed.data.data : value
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) {
    return ''
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        return text + decoder.decode()
      }
      bytes += chunk.value.byteLength
      if (bytes > MAX_SOURCE_CONTROL_AGENT_OUTPUT_BYTES) {
        throw new Error('OpenCode text generation exceeded its output limit')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function openCodeTextTaskUrl(url: string, path: string, version: 'v1' | 'v2'): string {
  return version === 'v1' ? url.replace(/\/$/, '') + path : new URL(path, url).toString()
}

export function createOpenCodeTextTaskHttp(
  url: string,
  password: string | undefined,
  query: string,
  username = 'opencode',
  version: 'v1' | 'v2' = 'v1'
) {
  const headers = {
    ...(password
      ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
      : {}),
    'content-type': 'application/json'
  }
  const requestRaw = async (
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal
  ): Promise<unknown> => {
    const response = await fetch(openCodeTextTaskUrl(url, `${path}${query}`, version), {
      method,
      headers,
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (!response.ok) {
      const errorText = await readBounded(response).catch(() => '')
      let detail = `HTTP ${response.status}`
      if (errorText) {
        try {
          const parsed = JSON.parse(errorText) as {
            error?: { message?: string }
            message?: string
          }
          const msg = parsed.error?.message || parsed.message
          if (typeof msg === 'string' && msg.trim()) {
            detail = `${detail}: ${msg.trim()}`
          }
        } catch {
          detail = `${detail}: ${errorText.slice(0, 240).trim()}`
        }
      }
      throw new Error(`OpenCode rejected the text generation request (${detail})`)
    }
    const text = await readBounded(response)
    return text ? JSON.parse(text) : undefined
  }
  const request: typeof requestRaw = async (...args) => unwrap(await requestRaw(...args))
  return { headers, request, requestRaw }
}
