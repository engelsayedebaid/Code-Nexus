import { beforeEach, describe, expect, it } from 'vitest'
import { useIdePromptQueueStore } from './ide-prompt-queue'

describe('useIdePromptQueueStore', () => {
  beforeEach(() => {
    useIdePromptQueueStore.setState({ byConversation: {} })
  })

  it('enqueues FIFO items per conversation, reorders with moveUp, and shifts sequentially', () => {
    const store = useIdePromptQueueStore.getState()
    const first = store.enqueue({
      conversationId: 'conv-1',
      worktreeSelector: 'id:wt-1',
      text: 'First task',
      mode: 'agent',
      agentId: 'codex',
      modelId: 'gpt-5',
      multiAgentEnabled: false,
      followAgent: true,
      attachments: []
    })
    const second = store.enqueue({
      conversationId: 'conv-1',
      worktreeSelector: 'id:wt-1',
      text: 'Second task',
      mode: 'plan',
      agentId: 'codex',
      modelId: 'gpt-5',
      multiAgentEnabled: false,
      followAgent: true,
      attachments: []
    })

    useIdePromptQueueStore.getState().moveUp('conv-1', second.id)
    expect(
      useIdePromptQueueStore.getState().byConversation['conv-1']?.map((item) => item.text)
    ).toEqual(['Second task', 'First task'])

    expect(useIdePromptQueueStore.getState().shiftNext('conv-1')?.id).toBe(second.id)
    expect(useIdePromptQueueStore.getState().shiftNext('conv-1')?.id).toBe(first.id)
    expect(useIdePromptQueueStore.getState().shiftNext('conv-1')).toBeNull()
  })
})
