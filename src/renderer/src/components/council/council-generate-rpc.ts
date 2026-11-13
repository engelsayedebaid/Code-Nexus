import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { subscribeRuntimeRpc } from '@/runtime/rpc/subscriptions/runtime-rpc-subscribe'
import type {
  CouncilGenerationResult,
  CouncilParticipant,
  CouncilStreamEvent
} from '../../../../shared/council/council-contract'

export function formatCouncilError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return String(error)
}

export async function runCouncilGenerateRpc(args: {
  workspaceId: string
  operationId: string
  participant: CouncilParticipant
  prompt: string
  onDelta?: (text: string) => void
}): Promise<CouncilGenerationResult> {
  const params = {
    worktree: args.workspaceId,
    operationId: args.operationId,
    agent: args.participant.agent,
    model: args.participant.model,
    ...(args.participant.thinkingLevel ? { thinkingLevel: args.participant.thinkingLevel } : {}),
    prompt: args.prompt
  }
  const canSubscribe =
    typeof window !== 'undefined' && typeof window.api?.runtime?.subscribe === 'function'
  if (!args.onDelta || !canSubscribe) {
    return await callRuntimeRpc<CouncilGenerationResult>(
      { kind: 'local' },
      'council.generate',
      params
    )
  }
  let receivedEvent = false
  try {
    return await new Promise<CouncilGenerationResult>((resolve, reject) => {
      let settled = false
      let unsubscribe = () => {}
      const finish = (result: CouncilGenerationResult): void => {
        if (settled) {
          return
        }
        settled = true
        unsubscribe()
        resolve(result)
      }
      const fail = (error: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        unsubscribe()
        reject(error)
      }
      void subscribeRuntimeRpc({ kind: 'local' }, 'council.generateStream', params, {
        onEvent: (raw) => {
          if (!raw || typeof raw !== 'object') {
            return
          }
          const event = raw as CouncilStreamEvent
          if (event.type === 'delta') {
            receivedEvent = true
            args.onDelta?.(event.text)
            return
          }
          if (event.type === 'done') {
            receivedEvent = true
            finish(event.result)
          }
        },
        onError: fail,
        onClose: () => {
          finish({ success: false, error: 'Stream closed before completion.' })
        }
      })
        .then((sub) => {
          if (settled) {
            sub.unsubscribe()
            return
          }
          unsubscribe = sub.unsubscribe
        })
        .catch(fail)
    })
  } catch (error) {
    // Fall back to unary RPC when running against a bridge/test stub without streaming support.
    if (!receivedEvent) {
      return await callRuntimeRpc<CouncilGenerationResult>(
        { kind: 'local' },
        'council.generate',
        params
      )
    }
    return {
      success: false,
      error: formatCouncilError(error)
    }
  }
}

export async function cancelCouncilGenerateRpcs(operationIds: readonly string[]): Promise<void> {
  await Promise.allSettled(
    operationIds.map((operationId) =>
      callRuntimeRpc({ kind: 'local' }, 'council.cancel', { operationId })
    )
  )
}
