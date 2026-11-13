import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  classifyNativeChatSend,
  type NativeChatSendClassification
} from '../../../../../../shared/native-chat/input/native-chat-slash-commands'
import type { deriveComposerAutocomplete } from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'
import type { AgentType } from '../../../../../../shared/agent-status/contracts/agent-status-types'
import { emitNativeChatSendClassified } from '@/components/native-chat/telemetry/native-chat-telemetry'
import { shouldClearDismissedPicker } from './native-chat-picker-dismissal'

type DeriveArgs = Parameters<typeof deriveComposerAutocomplete>

export function useNativeChatPickerDismissal(input: {
  agent: AgentType | null
  draft: string
  dismissalContext: string
  dismissed: { context: string; triggerKey: string } | null
  setDismissed: Dispatch<SetStateAction<{ context: string; triggerKey: string } | null>>
  skillOriginRef: MutableRefObject<string | null>
  pickerCommands: DeriveArgs[2]
  discovery: DeriveArgs[5]
  profile: DeriveArgs[4]
  sessionSkills?: DeriveArgs[7]
  commandAvailable: DeriveArgs[8]
  agentCommands: Parameters<typeof classifyNativeChatSend>[1]
}) {
  const {
    agent,
    draft,
    dismissalContext,
    dismissed,
    setDismissed,
    skillOriginRef,
    pickerCommands,
    discovery,
    profile,
    sessionSkills,
    commandAvailable,
    agentCommands
  } = input

  const handleDraftOrCaretChange = useCallback(
    (value: string, nextCaret: number) => {
      const firstToken = value.split(/\s/, 1)[0] ?? ''
      if (skillOriginRef.current && firstToken !== skillOriginRef.current) {
        skillOriginRef.current = null
      }
      if (
        shouldClearDismissedPicker({
          dismissed,
          dismissalContext,
          previousDraft: draft,
          nextDraft: value,
          nextCaret,
          pickerCommands,
          discovery,
          profile,
          sessionSkills,
          commandAvailable
        })
      ) {
        setDismissed(null)
      }
    },
    [
      commandAvailable,
      discovery,
      dismissalContext,
      dismissed,
      draft,
      pickerCommands,
      profile,
      sessionSkills,
      setDismissed,
      skillOriginRef
    ]
  )

  const classifySend = useCallback(
    (value: string): NativeChatSendClassification => {
      const outcome = classifyNativeChatSend(
        value,
        agentCommands,
        skillOriginRef.current,
        profile?.skillPrefix ?? null
      )
      emitNativeChatSendClassified({ agent, outcome })
      return outcome
    },
    [agent, agentCommands, profile, skillOriginRef]
  )

  const clearSkillOrigin = useCallback(() => {
    skillOriginRef.current = null
  }, [skillOriginRef])

  const isPickedSkill = useCallback(
    (value: string) => skillOriginRef.current === (value.split(/\s/, 1)[0] ?? ''),
    [skillOriginRef]
  )

  const dismiss = useCallback(
    (triggerKey: string) => setDismissed({ context: dismissalContext, triggerKey }),
    [dismissalContext, setDismissed]
  )

  return {
    handleDraftOrCaretChange,
    classifySend,
    clearSkillOrigin,
    isPickedSkill,
    dismiss
  }
}
