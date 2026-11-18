import { create } from 'zustand'
import type {
  IdeConversation,
  IdeFileChangeRecord
} from '../../../../shared/ide-agent/ide-agent-types'
import { useAppStore } from '@/store'
import { openWorkspaceFileInEditor } from '@/components/ide/sidebar/ide-workspace-navigation'
import { syncRevertedIdeFilesToWorkspace } from '@/lib/ide-agent/ide-agent-live-sync'

export type IdeDiffReviewLayout = 'split' | 'inline'

type IdeDiffReviewState = {
  reviewingChangeId: string | null
  diffLayout: IdeDiffReviewLayout
  collapseUnchanged: boolean
  setReviewingChangeId: (changeId: string | null) => void
  setDiffLayout: (layout: IdeDiffReviewLayout) => void
  setCollapseUnchanged: (collapse: boolean) => void
}

export const useIdeDiffReviewStore = create<IdeDiffReviewState>((set) => ({
  reviewingChangeId: null,
  diffLayout: 'split',
  collapseUnchanged: true,
  setReviewingChangeId: (reviewingChangeId) => set({ reviewingChangeId }),
  setDiffLayout: (diffLayout) => set({ diffLayout }),
  setCollapseUnchanged: (collapseUnchanged) => set({ collapseUnchanged })
}))

/** Opens the target file in the IDE editor and activates the Before/After diff comparison view. */
export function openIdeChangeDiffInEditor(
  change: Pick<IdeFileChangeRecord, 'id' | 'relativePath' | 'changeType'>,
  scratchWorkspace?: boolean
): void {
  if (change.changeType !== 'deleted') {
    openWorkspaceFileInEditor(change.relativePath, undefined, scratchWorkspace)
  } else {
    useAppStore.getState().setActiveView('terminal')
  }
  useIdeDiffReviewStore.getState().setReviewingChangeId(change.id)
}

export function reconcileIdeChangeDecisionEffects(
  action: 'accept' | 'reject' | 'restore_checkpoint',
  prevChanges: readonly IdeFileChangeRecord[],
  nextConversation: IdeConversation
): void {
  if (action === 'reject' || action === 'restore_checkpoint') {
    const newlyReverted = nextConversation.fileChanges.filter((afterItem) => {
      const beforeItem = prevChanges.find((c) => c.id === afterItem.id)
      return afterItem.acceptedState === 'reverted' && beforeItem?.acceptedState !== 'reverted'
    })
    syncRevertedIdeFilesToWorkspace(newlyReverted)
  }
  const activeReviewId = useIdeDiffReviewStore.getState().reviewingChangeId
  if (activeReviewId) {
    const reviewed = nextConversation.fileChanges.find((c) => c.id === activeReviewId)
    if (!reviewed || reviewed.acceptedState !== 'pending') {
      useIdeDiffReviewStore.getState().setReviewingChangeId(null)
    }
  }
}
