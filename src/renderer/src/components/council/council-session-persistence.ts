import type { CouncilMessage, CouncilSession } from '../../../../shared/council/council-contract'
import type { CouncilSessionStorage } from './council-session-storage'
import { cancelCouncilGenerateRpcs, markSessionMessagesStopped } from './council-session-execution'

type SessionRefs = {
  stopRef: { current: boolean }
  pauseRef: { current: boolean }
  sessionRef: { current: CouncilSession | null }
}

/** The session that owns this message: the live run first, else the stored transcript. */
export function councilSessionForMessage(
  storage: CouncilSessionStorage,
  sessionRef: SessionRefs['sessionRef'],
  sessionId: string
): CouncilSession | null {
  return sessionRef.current?.id === sessionId
    ? sessionRef.current
    : (storage.load().find((candidate) => candidate.id === sessionId) ?? null)
}

export function replaceCouncilSessionMessage(
  base: CouncilSession,
  messageId: string,
  updated: CouncilMessage
): CouncilSession {
  return {
    ...base,
    messages: base.messages.map((message) => (message.id === messageId ? updated : message))
  }
}

/** Stop every in-flight provider call and persist the interrupted transcript. */
export async function cancelCouncilRun(input: {
  operationIds: ReadonlySet<string>
  refs: SessionRefs
  persist: (session: CouncilSession) => CouncilSession
}): Promise<void> {
  const { operationIds, refs, persist } = input
  refs.stopRef.current = true
  refs.pauseRef.current = false
  await cancelCouncilGenerateRpcs([...operationIds])
  const current = refs.sessionRef.current
  if (!current) {
    return
  }
  persist({
    ...current,
    status: 'stopped',
    messages: markSessionMessagesStopped(current.messages)
  })
}
