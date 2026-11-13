import type { ComponentProps } from 'react'
import { cn } from '@/lib/class-names'
import { NativeChatComposerActions } from '../controls/NativeChatComposerActions'

type ActionsProps = ComponentProps<typeof NativeChatComposerActions>

export function NativeChatComposerActionsRow({
  launch,
  isDictating,
  draft,
  imageAttachments,
  editSession,
  attachDisabled,
  dictationDisabled,
  sendButtonDisabled,
  sendBlockedReason,
  draftNotSaved,
  isWorking,
  hasDraft,
  alternateSend,
  isStopping,
  isDictationHoldMode,
  attach,
  dictationToggle,
  dictationHoldStart,
  dictationHoldEnd,
  send,
  steerPreview,
  runSteerPreview,
  onStop,
  stop,
  sessionOptionsSurface,
  sessionOptionsSnapshot,
  contextUsage,
  sessionOptionsPickerRequest,
  focusComposer,
  goalMode,
  exitGoalMode,
  agent
}: Pick<
  ActionsProps,
  | 'editSession'
  | 'attachDisabled'
  | 'dictationDisabled'
  | 'sendBlockedReason'
  | 'draftNotSaved'
  | 'isWorking'
  | 'hasDraft'
  | 'alternateSend'
  | 'isStopping'
  | 'isDictating'
  | 'isDictationHoldMode'
  | 'steerPreview'
  | 'sessionOptionsSurface'
  | 'sessionOptionsSnapshot'
  | 'contextUsage'
  | 'sessionOptionsPickerRequest'
  | 'focusComposer'
  | 'agent'
> & {
  launch: boolean
  draft: string
  imageAttachments: readonly unknown[]
  sendButtonDisabled: ActionsProps['sendDisabled']
  attach: ActionsProps['onAttach']
  dictationToggle: ActionsProps['onDictationToggle']
  dictationHoldStart: ActionsProps['onDictationHoldStart']
  dictationHoldEnd: ActionsProps['onDictationHoldEnd']
  send: ActionsProps['onSend']
  runSteerPreview: ActionsProps['onSteerPreview']
  onStop?: () => void
  stop: () => void
  goalMode?: { active: boolean }
  exitGoalMode: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 pt-0.5',
        // An empty launch prompt is one line; its controls appear once it has focus, content or live dictation.
        launch &&
          !isDictating &&
          draft === '' &&
          imageAttachments.length === 0 &&
          'hidden group-focus-within/composer:flex'
      )}
    >
      <NativeChatComposerActions
        editSession={editSession}
        attachDisabled={attachDisabled}
        dictationDisabled={dictationDisabled}
        sendDisabled={sendButtonDisabled}
        sendBlockedReason={sendBlockedReason}
        draftNotSaved={draftNotSaved}
        isWorking={isWorking}
        hasDraft={hasDraft}
        alternateSend={alternateSend}
        isStopping={isStopping}
        isDictating={isDictating}
        isDictationHoldMode={isDictationHoldMode}
        onAttach={attach}
        onDictationToggle={dictationToggle}
        onDictationHoldStart={dictationHoldStart}
        onDictationHoldEnd={dictationHoldEnd}
        onSend={send}
        steerPreview={steerPreview}
        onSteerPreview={runSteerPreview}
        onStop={onStop ? stop : undefined}
        sessionOptionsSurface={sessionOptionsSurface}
        sessionOptionsSnapshot={sessionOptionsSnapshot}
        contextUsage={contextUsage}
        sessionOptionsPickerRequest={sessionOptionsPickerRequest}
        focusComposer={focusComposer}
        onExitGoalMode={goalMode?.active ? exitGoalMode : undefined}
        launchPrompt={launch}
        {...(agent ? { agent } : {})}
      />
    </div>
  )
}
