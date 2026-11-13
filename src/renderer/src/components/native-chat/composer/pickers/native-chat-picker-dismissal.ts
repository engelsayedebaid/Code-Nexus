import {
  deriveComposerAutocomplete,
  editReplacesTriggerToken
} from '../../../../../../shared/native-chat/input/native-chat-composer-autocomplete'

type DeriveArgs = Parameters<typeof deriveComposerAutocomplete>

export function shouldClearDismissedPicker(input: {
  dismissed: { context: string; triggerKey: string } | null
  dismissalContext: string
  previousDraft: string
  nextDraft: string
  nextCaret: number
  pickerCommands: DeriveArgs[2]
  discovery: DeriveArgs[5]
  profile: DeriveArgs[4]
  sessionSkills?: DeriveArgs[7]
  commandAvailable: DeriveArgs[8]
}): boolean {
  const { dismissed, dismissalContext, previousDraft, nextDraft, nextCaret } = input
  if (!dismissed || dismissed.context !== dismissalContext) {
    return false
  }
  // Whole-token replacement starts a new trigger even at the same position (select-all/paste).
  if (editReplacesTriggerToken(previousDraft, nextDraft, dismissed.triggerKey)) {
    return true
  }
  const next = deriveComposerAutocomplete(
    nextDraft,
    nextCaret,
    input.pickerCommands,
    input.discovery?.skills ?? [],
    input.profile,
    input.discovery,
    null,
    input.sessionSkills,
    input.commandAvailable
  )
  return next.mode === 'none' || next.triggerKey !== dismissed.triggerKey
}
