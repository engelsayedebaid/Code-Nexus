import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../../../store/index'
import { findTabAgentEntry } from './native-chat-tab-agent-entry'
import {
  findSleepingAgentRecordForPane,
  resolveNativeChatStatusEntry
} from './native-chat-sleeping-fallback'

export function useNativeChatStatusEntry(
  terminalTabId: string,
  preferredPaneKey: string | undefined
) {
  const { liveEntry, sleepingRecord, shellForeground } = useAppStore(
    useShallow((state) => {
      const liveEntry = preferredPaneKey
        ? state.agentStatusByPaneKey[preferredPaneKey]
        : findTabAgentEntry(state.agentStatusByPaneKey, terminalTabId)
      const sleepingRecord = findSleepingAgentRecordForPane(
        state.sleepingAgentSessionsByPaneKey,
        terminalTabId,
        preferredPaneKey ?? liveEntry?.paneKey
      )
      const resolvedPaneKey =
        preferredPaneKey ?? liveEntry?.paneKey ?? sleepingRecord?.paneKey ?? `${terminalTabId}:`
      return {
        liveEntry,
        sleepingRecord,
        shellForeground: state.paneForegroundAgentByPaneKey[resolvedPaneKey]?.shellForeground === true
      }
    })
  )
  const entry = useMemo(
    () =>
      resolveNativeChatStatusEntry({
        liveEntry,
        sleepingRecord,
        shellForeground,
        terminalTabId
      }),
    [liveEntry, sleepingRecord, shellForeground, terminalTabId]
  )
  return {
    entry,
    paneKey: preferredPaneKey ?? entry?.paneKey ?? `${terminalTabId}:`
  }
}
