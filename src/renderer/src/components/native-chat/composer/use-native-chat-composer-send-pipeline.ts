import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useNativeChatContextUsageSummary } from '../usage/use-native-chat-context-usage-summary'
import type { NativeChatComposerImageAttachment } from '../attachments/chips/native-chat-image-attachment'
import type { NativeChatSendClassification } from '../../../../../shared/native-chat/input/native-chat-slash-commands'
import { useNativeChatComposerSessionOptions } from './controls/use-native-chat-composer-session-options'
import type { NativeChatComposerInput } from './editor/native-chat-composer-input'
import { useNativeChatDictation } from './editor/use-native-chat-dictation'
import type * as C from './native-chat-composer-types'
import { useNativeChatComposerSubmit } from './submit/use-native-chat-composer-submit'
import { useNativeChatPtyComposerSend } from './submit/use-native-chat-pty-composer-send'
import { useNativeChatStructuredComposerSend } from './submit/use-native-chat-structured-composer-send'

type PtySendArgs = Parameters<typeof useNativeChatPtyComposerSend>[0]
type SubmitArgs = Parameters<typeof useNativeChatComposerSubmit>[0]

export function useNativeChatComposerSendPipeline(input: {
  agent: C.NativeChatComposerProps['agent']
  terminalTabId: string
  paneKey: string
  draftScopeKey: string
  targetPtyId: string | null
  disabled: boolean
  draft: string
  caret: number
  imageAttachments: readonly NativeChatComposerImageAttachment[]
  structuredTransport: C.NativeChatComposerProps['structuredTransport']
  launchSeed: C.NativeChatComposerProps['launchSeed']
  launchPrompt: C.NativeChatComposerProps['launchPrompt']
  pending: boolean
  textareaRef: RefObject<NativeChatComposerInput | null>
  isComposing: () => boolean
  resolveTarget: () => { ptyId: string } | null
  onSlashCommand: C.NativeChatComposerProps['onSlashCommand']
  onSubmitted: C.NativeChatComposerProps['onSubmitted']
  answerCommandLocally: C.NativeChatComposerProps['answerCommandLocally']
  onSwitchToTerminal: C.NativeChatComposerProps['onSwitchToTerminal']
  readTerminalScreen: C.NativeChatComposerProps['readTerminalScreen']
  onOptimisticSend: C.NativeChatComposerProps['onOptimisticSend']
  optimisticSendOutcome: C.NativeChatComposerProps['optimisticSendOutcome']
  trackPendingSend: PtySendArgs['trackPendingSend']
  classifySend: (value: string) => NativeChatSendClassification
  clearSkillOrigin: () => void
  clearImageAttachments: () => void
  consumeOrcaCommand: SubmitArgs['consumeOrcaCommand']
  matchesOrcaCommand: SubmitArgs['matchesOrcaCommand']
  setDraft: (value: string) => void
  setCaret: Dispatch<SetStateAction<number>>
  setNotice: PtySendArgs['setNotice']
}) {
  const dictation = useNativeChatDictation(input.textareaRef, input.disabled)
  const sessionOptions = useNativeChatComposerSessionOptions({
    agent: input.agent,
    disabled: input.disabled,
    onSlashCommand: input.onSlashCommand,
    onSubmitted: input.onSubmitted,
    resolveTarget: input.resolveTarget,
    terminalTabId: input.terminalTabId,
    targetPtyId: input.targetPtyId,
    onSwitchToTerminal: input.onSwitchToTerminal,
    readTerminalScreen: input.readTerminalScreen,
    paneKey: input.paneKey,
    structuredTransport: input.structuredTransport
  })
  const contextUsageSummary = useNativeChatContextUsageSummary(input.structuredTransport)

  const sendStructured = useNativeChatStructuredComposerSend({
    agent: input.agent,
    draftScopeKey: input.draftScopeKey,
    imageAttachments: input.imageAttachments,
    structuredTransport: input.structuredTransport,
    isComposing: input.isComposing,
    clearSkillOrigin: input.clearSkillOrigin,
    setDraft: input.setDraft,
    setCaret: input.setCaret
  })

  const ptyCommandRouting = {
    agent: input.agent,
    disabled: input.disabled,
    isDispatchingSessionOption: sessionOptions.isDispatching,
    resolveTarget: input.resolveTarget,
    onSlashCommand: input.onSlashCommand,
    onSubmitted: input.onSubmitted,
    answerCommandLocally: input.answerCommandLocally,
    sessionOptionsSurface: sessionOptions.pty.surface,
    trackPendingSend: input.trackPendingSend,
    setDraft: input.setDraft,
    setCaret: input.setCaret,
    clearSkillOrigin: input.clearSkillOrigin,
    clearImageAttachments: input.clearImageAttachments,
    setNotice: input.setNotice
  }
  const sendPty = useNativeChatPtyComposerSend({
    draftScopeKey: input.draftScopeKey,
    ...ptyCommandRouting,
    draft: input.draft,
    imageAttachments: input.imageAttachments,
    launchDraft: input.launchSeed?.launchDraft,
    launchDraftResolved: input.launchSeed?.launchDraftResolved === true,
    readTerminalDraft: input.launchSeed?.readTerminalDraft,
    classifySend: input.classifySend,
    onOptimisticSend: input.onOptimisticSend,
    optimisticSendOutcome: input.optimisticSendOutcome,
    terminalTabId: input.terminalTabId
  })
  const submission = useNativeChatComposerSubmit({
    agent: input.agent,
    textareaRef: input.textareaRef,
    structuredTransport: input.structuredTransport,
    draftScopeKey: input.draftScopeKey,
    draft: input.draft,
    caret: input.caret,
    imageAttachments: input.imageAttachments,
    disabled: input.disabled,
    sendPty,
    sendStructured,
    submitEmpty: input.launchPrompt?.onEmptySubmit,
    consumeOrcaCommand: input.pending || input.launchPrompt ? undefined : input.consumeOrcaCommand,
    matchesOrcaCommand: input.pending || input.launchPrompt ? undefined : input.matchesOrcaCommand,
    setDraft: input.setDraft,
    setCaret: input.setCaret
  })

  return {
    dictation,
    sessionOptions,
    contextUsageSummary,
    sendStructured,
    ptyCommandRouting,
    sendPty,
    submission
  }
}
