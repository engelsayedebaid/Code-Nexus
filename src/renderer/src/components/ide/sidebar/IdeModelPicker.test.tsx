// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { IdeModelPicker } from './IdeModelPicker'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type { IdeProviderAgentOption } from '../../../../../shared/ide-agent/ide-agent-events'
import type { IdeConversation } from '../../../../../shared/ide-agent/ide-agent-types'
import { readModelPickerRecents } from './ide-model-picker-preferences'

const providers: IdeProviderAgentOption[] = [
  {
    id: 'claude',
    label: 'Claude',
    binary: 'claude',
    available: true,
    defaultModelId: 'sonnet',
    models: [
      { id: 'sonnet', label: 'Sonnet 4.5' },
      { id: 'opus', label: 'Opus 4.1' }
    ]
  },
  {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    available: true,
    defaultModelId: 'gpt-5',
    models: [
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-codex', label: 'GPT-5 Codex' }
    ]
  },
  {
    id: 'gemini',
    label: 'Gemini',
    binary: 'gemini',
    available: false,
    defaultModelId: 'gemini-pro',
    models: [{ id: 'gemini-pro', label: 'Gemini Pro' }],
    unavailableReason: 'gemini CLI not detected on PATH.'
  }
]

const conversation: IdeConversation = {
  id: 'conv-1',
  workspaceKey: 'ws-1',
  workspacePath: '/tmp/ws',
  title: 'Chat',
  mode: 'agent',
  agentId: 'claude',
  modelId: 'sonnet',
  multiAgentEnabled: false,
  followAgent: true,
  activePlanId: null,
  activeRunId: null,
  status: 'idle',
  createdAt: 0,
  updatedAt: 0,
  messages: [],
  plans: [],
  activity: [],
  fileChanges: [],
  checkpoints: [],
  commandExecutions: [],
  pendingPermissions: []
}

function renderPicker() {
  return render(
    <IdeModelPicker conversation={conversation} providers={providers} providersLoading={false} />
  )
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('ide-model-select'))
  await screen.findByPlaceholderText('Search all models')
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

it('lists every provider model grouped by provider and marks the selection', async () => {
  const user = userEvent.setup()
  renderPicker()
  await openPicker(user)

  expect(screen.getByRole('option', { name: 'Claude Sonnet 4.5' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Codex GPT-5 Codex' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Gemini Gemini Pro' })).toBeTruthy()

  const selected = screen.getByRole('option', { name: 'Claude Sonnet 4.5' })
  expect(selected.querySelector('svg.lucide-check')).not.toBeNull()
})

it('filters models by search text across provider and model names', async () => {
  const user = userEvent.setup()
  renderPicker()
  await openPicker(user)

  await user.type(screen.getByPlaceholderText('Search all models'), 'codex')

  await waitFor(() => {
    expect(screen.queryByRole('option', { name: 'Claude Sonnet 4.5' })).toBeNull()
  })
  expect(screen.getByRole('option', { name: 'Codex GPT-5' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Codex GPT-5 Codex' })).toBeTruthy()
})

it('narrows the list to a chosen provider without closing the picker', async () => {
  const user = userEvent.setup()
  renderPicker()
  await openPicker(user)

  await user.click(screen.getByRole('button', { name: /All providers/ }))
  await user.click(await screen.findByRole('menuitemradio', { name: /Codex/ }))

  await waitFor(() => {
    expect(screen.queryByRole('option', { name: 'Claude Sonnet 4.5' })).toBeNull()
  })
  expect(screen.getByRole('option', { name: 'Codex GPT-5' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'Gemini Gemini Pro' })).toBeNull()
})

it('selects a model through updateSettings and records it as recent', async () => {
  const user = userEvent.setup()
  const updateSettings = vi.fn().mockResolvedValue(undefined)
  useIdeAgentStore.setState({ updateSettings })
  renderPicker()
  await openPicker(user)

  await user.click(screen.getByRole('option', { name: 'Codex GPT-5 Codex' }))

  expect(updateSettings).toHaveBeenCalledWith({
    conversationId: 'conv-1',
    agentId: 'codex',
    modelId: 'gpt-5-codex'
  })
  await waitFor(() => {
    expect(screen.queryByPlaceholderText('Search all models')).toBeNull()
  })
  expect(readModelPickerRecents()[0]).toBe('codex::gpt-5-codex')
})
