import { useEffect, useState } from 'react'
import { getPairedWebClientEnvironmentId } from '@/app-shell/platform/paired-web-client-host'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { captureRuntimeEnvironmentRequestRevision } from '@/runtime/rpc/environment-revisions/runtime-environment-revision'
import { useAppStore } from '@/store/index'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { isInternalAttachmentDisplayCandidate } from '../../../../../../shared/smart-paste/native-chat-attachment-metadata'

export type NativeChatTextAttachmentStat = {
  status: 'idle' | 'ready' | 'missing' | 'unsupported' | 'error'
  sizeBytes: number | null
}

type WireStatReply = {
  exists?: unknown
  sizeBytes?: unknown
}

const STAT_CACHE = new Map<string, NativeChatTextAttachmentStat>()
const IN_FLIGHT_STATS = new Map<string, Promise<NativeChatTextAttachmentStat>>()
const STAT_CACHE_LIMIT = 400

function isMethodNotFound(error: unknown): boolean {
  if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
    return true
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'method_not_found'
  )
}

function resolveStatOwner(target: RuntimeClientTarget): RuntimeClientTarget {
  const environmentId =
    target.kind === 'local' ? getPairedWebClientEnvironmentId(useAppStore.getState()) : null
  return environmentId ? { kind: 'environment', environmentId } : target
}

function rememberStat(cacheKey: string, value: NativeChatTextAttachmentStat): void {
  if (value.status !== 'error') {
    if (STAT_CACHE.size >= STAT_CACHE_LIMIT) {
      const oldest = STAT_CACHE.keys().next().value
      if (oldest !== undefined) {
        STAT_CACHE.delete(oldest)
      }
    }
    STAT_CACHE.set(cacheKey, value)
  }
}

export function invalidateNativeChatTextAttachmentStat(path: string): void {
  const suffix = `::${path}`
  for (const key of STAT_CACHE.keys()) {
    if (key.endsWith(suffix)) {
      STAT_CACHE.delete(key)
    }
  }
}

export function clearNativeChatTextAttachmentStatCacheForTests(): void {
  STAT_CACHE.clear()
  IN_FLIGHT_STATS.clear()
}

export async function probeNativeChatTextAttachmentStat(
  path: string,
  target: RuntimeClientTarget
): Promise<NativeChatTextAttachmentStat> {
  const owner = resolveStatOwner(target)
  const cacheKey = `${JSON.stringify(owner)}::${path}`
  const cached = STAT_CACHE.get(cacheKey)
  if (cached) {
    return cached
  }
  const active = IN_FLIGHT_STATS.get(cacheKey)
  if (active) {
    return active
  }
  const expectedEnvironmentPairingRevision =
    owner.kind === 'environment'
      ? captureRuntimeEnvironmentRequestRevision(owner.environmentId)
      : undefined
  const promise = (async (): Promise<NativeChatTextAttachmentStat> => {
    try {
      const raw = await callRuntimeRpc<WireStatReply>(
        owner,
        'agentSessionAttachment.stat',
        { path },
        {
          timeoutMs: 8_000,
          skipCompatibilityCheck: true,
          ...(expectedEnvironmentPairingRevision !== undefined
            ? { expectedEnvironmentPairingRevision }
            : {})
        }
      )
      const exists = Boolean(raw?.exists)
      const sizeBytes =
        typeof raw?.sizeBytes === 'number' && Number.isFinite(raw.sizeBytes) ? raw.sizeBytes : null
      const resolved: NativeChatTextAttachmentStat = exists
        ? { status: 'ready', sizeBytes }
        : { status: 'missing', sizeBytes: null }
      rememberStat(cacheKey, resolved)
      return resolved
    } catch (error) {
      if (isMethodNotFound(error)) {
        const unsupported: NativeChatTextAttachmentStat = { status: 'unsupported', sizeBytes: null }
        rememberStat(cacheKey, unsupported)
        return unsupported
      }
      return { status: 'error', sizeBytes: null }
    } finally {
      IN_FLIGHT_STATS.delete(cacheKey)
    }
  })()
  IN_FLIGHT_STATS.set(cacheKey, promise)
  return promise
}

export function useNativeChatTextAttachmentStat(
  path: string | null | undefined,
  target: RuntimeClientTarget | null | undefined,
  enabled = true
): NativeChatTextAttachmentStat {
  const active = Boolean(enabled && path && target && isInternalAttachmentDisplayCandidate(path))
  const owner = active && target ? resolveStatOwner(target) : null
  const cacheKey = active && path && owner ? `${JSON.stringify(owner)}::${path}` : ''
  const [state, setState] = useState<{ key: string; stat: NativeChatTextAttachmentStat }>(() => ({
    key: cacheKey,
    stat: cacheKey
      ? (STAT_CACHE.get(cacheKey) ?? { status: 'idle', sizeBytes: null })
      : { status: 'idle', sizeBytes: null }
  }))

  useEffect(() => {
    if (!active || !path || !target || !cacheKey) {
      return
    }
    const cached = STAT_CACHE.get(cacheKey)
    if (cached) {
      setState({ key: cacheKey, stat: cached })
      return
    }
    let cancelled = false
    void probeNativeChatTextAttachmentStat(path, target).then((result) => {
      if (!cancelled) {
        setState({ key: cacheKey, stat: result })
      }
    })
    return () => {
      cancelled = true
    }
  }, [active, path, target, cacheKey])

  if (!active || !cacheKey) {
    return { status: 'idle', sizeBytes: null }
  }
  const cached = STAT_CACHE.get(cacheKey)
  if (cached) {
    return cached
  }
  return state.key === cacheKey ? state.stat : { status: 'idle', sizeBytes: null }
}
