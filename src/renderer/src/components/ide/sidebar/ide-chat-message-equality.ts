import type {
  IdeChatMessage,
  IdeCommandExecutionRecord,
  IdeConversation,
  IdeProviderAgentOption,
  IdeTaskPlan
} from '../../../../../shared/ide-agent/ide-agent-types'
import { formatIdeFileCount } from './ide-chat-copy'

const LEGACY_PLAN_MARKDOWN_PREFIX =
  /^### (?:Proposed Implementation Plan|خطة التنفيذ المقترحة) \(v\d+\)/
const TRAILING_MODIFIED_FILES_BLOCK =
  /\n+(?:\*\*)?Modified files:(?:\*\*)?\s*\n(?:\s*[-*]\s+.+\n?)+$/i

export type IdeChatMessageItemProps = {
  message: IdeChatMessage
  conversation: IdeConversation
  providers: IdeProviderAgentOption[]
  providersLoading?: boolean
  worktreeSelector?: string | null
  plansById: Map<string, IdeTaskPlan>
  commandsById: Map<string, IdeCommandExecutionRecord>
  isLatestMessage?: boolean
}

export function resolveDisplayModelLabel(
  providers: readonly IdeProviderAgentOption[],
  agentId?: string,
  modelId?: string
): string | null {
  if (!modelId) {
    return null
  }
  const provider = providers.find((p) => p.id === agentId)
  const model = provider?.models.find((m) => m.id === modelId)
  return model?.label ?? modelId
}

export function resolveDisplayContent(
  message: IdeChatMessage,
  linkedPlan: IdeTaskPlan | undefined
): string {
  let content = message.text
  if (linkedPlan && LEGACY_PLAN_MARKDOWN_PREFIX.test(content.trimStart())) {
    content =
      linkedPlan.intro?.trim() ||
      `Prepared an implementation plan (${formatIdeFileCount(linkedPlan.affectedFiles.length)}).`
  }
  if (message.modifiedFiles && message.modifiedFiles.length > 0) {
    content = content.replace(TRAILING_MODIFIED_FILES_BLOCK, '')
  }
  if (message.error) {
    const trimmed = content.trim()
    const cleanErr = message.error.trim()
    if (trimmed === cleanErr || trimmed === `Error: ${cleanErr}`) {
      return ''
    }
  }
  return content
}

export function areIdeChatMessagePropsEqual(
  prev: IdeChatMessageItemProps,
  next: IdeChatMessageItemProps
): boolean {
  if (
    prev.message !== next.message ||
    prev.isLatestMessage !== next.isLatestMessage ||
    prev.providers !== next.providers ||
    prev.providersLoading !== next.providersLoading ||
    prev.worktreeSelector !== next.worktreeSelector ||
    prev.conversation.id !== next.conversation.id
  ) {
    return false
  }
  if (prev.message.planId) {
    if (prev.plansById.get(prev.message.planId) !== next.plansById.get(next.message.planId ?? '')) {
      return false
    }
  }
  if (prev.message.commandIds?.length) {
    for (const cmdId of prev.message.commandIds) {
      if (prev.commandsById.get(cmdId) !== next.commandsById.get(cmdId)) {
        return false
      }
    }
  }
  if (next.isLatestMessage) {
    if (
      prev.conversation.status !== next.conversation.status ||
      prev.conversation.activeRunId !== next.conversation.activeRunId
    ) {
      return false
    }
  }
  const runId = next.message.runId
  if (runId) {
    let prevActCount = 0
    let nextActCount = 0
    for (const ev of prev.conversation.activity) {
      if (ev.runId === runId) {
        prevActCount += 1
      }
    }
    for (const ev of next.conversation.activity) {
      if (ev.runId === runId) {
        nextActCount += 1
      }
    }
    if (prevActCount !== nextActCount) {
      return false
    }
    const prevChanges = prev.conversation.fileChanges.filter((c) => c.runId === runId)
    const nextChanges = next.conversation.fileChanges.filter((c) => c.runId === runId)
    if (prevChanges.length !== nextChanges.length) {
      return false
    }
    for (let i = 0; i < prevChanges.length; i += 1) {
      if (
        prevChanges[i].acceptedState !== nextChanges[i].acceptedState ||
        prevChanges[i].updatedAt !== nextChanges[i].updatedAt
      ) {
        return false
      }
    }
  }
  return true
}
