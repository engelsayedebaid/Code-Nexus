import type { SleepingAgentSessionRecord } from '../../../../../../shared/agent-session/lifecycle/agent-session-resume'
import type { AgentStatusEntry } from '../../../../../../shared/agent-status/contracts/agent-status-types'

/** Find the sleeping session record matching a pane key or terminal tab across restarts. */
export function findSleepingAgentRecordForPane(
  records: Readonly<Record<string, SleepingAgentSessionRecord>>,
  terminalTabId: string,
  preferredPaneKey: string | undefined
): SleepingAgentSessionRecord | undefined {
  if (preferredPaneKey && records[preferredPaneKey]) {
    return records[preferredPaneKey]
  }
  const tabPrefix = `${terminalTabId}:`
  let best: SleepingAgentSessionRecord | undefined
  for (const record of Object.values(records)) {
    if (record.tabId === terminalTabId || record.paneKey.startsWith(tabPrefix)) {
      if (!best || record.updatedAt > best.updatedAt) {
        best = record
      }
    }
  }
  return best
}

/** Resolve the native-chat status entry, falling back to a persisted sleeping session after restart or sleep. */
export function resolveNativeChatStatusEntry(args: {
  liveEntry: AgentStatusEntry | undefined
  sleepingRecord: SleepingAgentSessionRecord | undefined
  shellForeground: boolean
  terminalTabId: string
}): AgentStatusEntry | undefined {
  const { liveEntry, sleepingRecord, shellForeground, terminalTabId } = args
  if (liveEntry && liveEntry.restoredUnconfirmed !== true && liveEntry.providerSession?.id) {
    return liveEntry
  }
  if (!shellForeground && sleepingRecord?.providerSession?.id) {
    return {
      ...(liveEntry ?? {}),
      state: liveEntry?.state ?? sleepingRecord.state ?? 'done',
      prompt: liveEntry?.prompt ?? sleepingRecord.prompt ?? '',
      updatedAt: liveEntry?.updatedAt ?? sleepingRecord.updatedAt,
      stateStartedAt: liveEntry?.stateStartedAt ?? sleepingRecord.capturedAt,
      stateHistory: liveEntry?.stateHistory ?? [],
      agentType: liveEntry?.agentType ?? sleepingRecord.agent,
      providerSession: sleepingRecord.providerSession,
      paneKey: liveEntry?.paneKey ?? sleepingRecord.paneKey,
      tabId: liveEntry?.tabId ?? sleepingRecord.tabId ?? terminalTabId,
      worktreeId: liveEntry?.worktreeId ?? sleepingRecord.worktreeId,
      terminalTitle: liveEntry?.terminalTitle ?? sleepingRecord.terminalTitle,
      lastAssistantMessage: liveEntry?.lastAssistantMessage ?? sleepingRecord.lastAssistantMessage,
      interrupted: liveEntry?.interrupted ?? sleepingRecord.interrupted
    }
  }
  return liveEntry
}
