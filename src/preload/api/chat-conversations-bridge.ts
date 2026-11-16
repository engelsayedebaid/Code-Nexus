import { ipcRenderer } from 'electron'
import type { ChatConversationsApi } from './chat-conversations-api'

export const chatConversationsApi = {
  list: (input) => ipcRenderer.invoke('chatConversations:list', input ?? {}),
  get: (input) => ipcRenderer.invoke('chatConversations:get', input),
  upsertConversation: (input) =>
    ipcRenderer.invoke('chatConversations:upsertConversation', input),
  upsertMessages: (messages, streamed) =>
    ipcRenderer.invoke('chatConversations:upsertMessages', { messages, streamed }),
  saveTurn: (input, streamed) =>
    ipcRenderer.invoke('chatConversations:saveTurn', { input, streamed }),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke('chatConversations:delete', conversationId),
  importConversations: (entries) =>
    ipcRenderer.invoke('chatConversations:importConversations', entries),
  getKvState: (key) => ipcRenderer.invoke('chatConversations:getKvState', key),
  setKvState: (key, valueJson) =>
    ipcRenderer.invoke('chatConversations:setKvState', { key, valueJson }),
  importKvStateIfMissing: (entries) =>
    ipcRenderer.invoke('chatConversations:importKvStateIfMissing', entries),
  listStructuredHistory: (workspaceId) =>
    ipcRenderer.invoke('chatConversations:listStructuredHistory', workspaceId)
} satisfies ChatConversationsApi
