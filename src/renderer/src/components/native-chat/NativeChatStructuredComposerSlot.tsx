import type { ComponentProps, RefObject } from 'react'
import { NativeChatComposer } from '@/components/native-chat/composer/NativeChatComposer'
import { NativeChatPromptSlotNotices } from '@/components/native-chat/composer/controls/NativeChatComposerNotices'
import type { NativeChatComposerHandle } from '@/components/native-chat/composer/native-chat-composer-types'
import { structuredAgentSessionDraftScopeKey } from '@/components/native-chat/drafts/native-chat-draft-scope'
import { NativeChatInstallSlot } from '@/components/native-chat/host-access/NativeChatInstallSlot'
import { NativeChatStructuredComposerTabStrips } from '@/components/native-chat/pane/actions/NativeChatStructuredComposerTabStrips'
import { nativeChatStructuredAsyncQuestion } from '@/components/native-chat/prompts/NativeChatStructuredAsyncQuestion'
import { NativeChatStructuredPromptCard } from '@/components/native-chat/prompts/NativeChatStructuredPromptCard'
import { NativeChatQueuedMessageList } from '@/components/native-chat/queue/NativeChatQueuedMessageList'
import { NativeChatStructuredSessionStatus } from '@/components/native-chat/tools/tasks/NativeChatStructuredSessionStatus'
import { NativeChatPartyWorkerApprovalStack } from '@/components/native-chat/worker-approvals/NativeChatWorkerApprovals'
import type { NativeChatStructuredViewProps } from './native-chat-view-types'
import type { MultiModelChatController } from './group-chat/use-multi-model-chat'

type AsyncQuestionArgs = Parameters<typeof nativeChatStructuredAsyncQuestion>
type PromptCardProps = ComponentProps<typeof NativeChatStructuredPromptCard>
type QueuedListProps = ComponentProps<typeof NativeChatQueuedMessageList>
type StatusProps = ComponentProps<typeof NativeChatStructuredSessionStatus>
type ApprovalProps = ComponentProps<typeof NativeChatPartyWorkerApprovalStack>
type TabStripsProps = ComponentProps<typeof NativeChatStructuredComposerTabStrips>
type InstallProps = ComponentProps<typeof NativeChatInstallSlot>
type ComposerProps = ComponentProps<typeof NativeChatComposer>
type StructuredTransport = NonNullable<ComposerProps['structuredTransport']> & AsyncQuestionArgs[3]
type StructuredController = AsyncQuestionArgs[1] &
  StatusProps['tasks'] &
  Pick<TabStripsProps, 'threadGoal' | 'isWorking' | 'turnId' | 'workingStartedAt'>

export function NativeChatStructuredComposerSlot({
  pane,
  paneKey,
  ownerWorktreeId,
  agentLabel,
  startFailures,
  hostHeld,
  focusComposer,
  transport,
  controller,
  session,
  submits,
  stopControlsComposer,
  stopStopping,
  steerHead,
  workerApprovalParty,
  prompt,
  promptResponse,
  cancelPrompt,
  promptsUnanswerable,
  questionAnswerInputRef,
  imageRuntimeContext,
  notices,
  composerShown,
  installSlot,
  installUnavailableHint,
  multiActive,
  multiModel,
  composerRef
}: {
  pane: Omit<NativeChatStructuredViewProps, 'mode'>
  paneKey: string
  ownerWorktreeId: string | null | undefined
  agentLabel: string
  startFailures: QueuedListProps['statedFailures']
  hostHeld: boolean
  focusComposer: () => void
  transport: StructuredTransport
  controller: StructuredController
  session: AsyncQuestionArgs[2]
  submits: AsyncQuestionArgs[4] & {
    queuedMessages: QueuedListProps['controller']
    messageListRef: StatusProps['messageListRef']
  }
  stopControlsComposer: Pick<
    ComposerProps,
    'canSend' | 'isWorking' | 'isStopping' | 'afterStop' | 'onStop'
  >
  stopStopping: boolean
  steerHead: ComposerProps['steerHead']
  workerApprovalParty: ApprovalProps['party']
  prompt: PromptCardProps['prompt']
  promptResponse: PromptCardProps['promptResponse']
  cancelPrompt: PromptCardProps['onCancel']
  promptsUnanswerable: boolean
  questionAnswerInputRef: PromptCardProps['answerInputRef']
  imageRuntimeContext: TabStripsProps['runtimeContext']
  notices: ComponentProps<typeof NativeChatPromptSlotNotices>['notices']
  composerShown: boolean
  installSlot: InstallProps['slot']
  installUnavailableHint: ComposerProps['unavailableHint']
  multiActive: boolean
  multiModel: MultiModelChatController
  composerRef: RefObject<NativeChatComposerHandle | null>
}): React.JSX.Element {
  return (
    <>
      <NativeChatQueuedMessageList
        controller={submits.queuedMessages}
        chatWorktreeId={ownerWorktreeId ?? null}
        agentName={agentLabel}
        statedFailures={startFailures}
        steerHeld={stopStopping || hostHeld}
        focusComposer={focusComposer}
        editAttachTo={{ terminalTabId: pane.tabId, agent: pane.agent, transport }}
      />
      <NativeChatStructuredSessionStatus
        sessionId={pane.sessionId}
        paneKey={paneKey}
        isVisible={pane.isVisible}
        tasks={controller}
        messageListRef={submits.messageListRef}
      />
      {/* Workers' open prompts stay pinned here, above this chat's own prompt. */}
      <NativeChatPartyWorkerApprovalStack
        party={workerApprovalParty}
        target={pane.target}
        isVisible={pane.isVisible}
      />
      {prompt ? null : (
        <NativeChatStructuredComposerTabStrips
          tabId={pane.tabId}
          runtimeContext={imageRuntimeContext}
          threadGoal={controller.threadGoal}
          transport={transport}
          isWorking={controller.isWorking}
          isVisible={pane.isVisible}
          turnId={controller.turnId}
          workingStartedAt={controller.workingStartedAt}
        />
      )}
      {composerShown ? null : <NativeChatPromptSlotNotices notices={notices} />}
      <NativeChatStructuredPromptCard
        key={prompt ? `${prompt.itemId}:${prompt.revision}` : undefined}
        prompt={prompt}
        promptResponse={promptResponse}
        onCancel={cancelPrompt}
        shouldFocus={!promptsUnanswerable && pane.isVisible && pane.isFocusedGroup}
        answerInputRef={questionAnswerInputRef}
      />
      {nativeChatStructuredAsyncQuestion(pane, controller, session, transport, submits)}
      {composerShown && !multiActive && (
        <NativeChatInstallSlot slot={installSlot} agentLabel={agentLabel} />
      )}
      {composerShown ? (
        <NativeChatComposer
          ref={composerRef}
          terminalTabId={pane.tabId}
          paneKey={paneKey}
          draftScopeKey={structuredAgentSessionDraftScopeKey(pane.sessionId)}
          targetPtyId={null}
          agent={pane.agent}
          {...stopControlsComposer}
          isWorking={multiActive ? multiModel.isRunning : stopControlsComposer.isWorking}
          onStop={multiActive ? () => multiModel.stop() : stopControlsComposer.onStop}
          unavailableHint={multiActive ? undefined : installUnavailableHint}
          steerHead={steerHead}
          structuredTransport={transport}
          notices={notices}
          recallSource={{ messages: session.messages, withoutImageMarkers: true }}
        />
      ) : null}
    </>
  )
}
