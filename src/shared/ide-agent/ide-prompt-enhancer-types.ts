import type { IdeExecutionMode } from './ide-agent-types'

export type IdePromptEnhancerStatus =
  | 'idle'
  | 'enhancing'
  | 'preview'
  | 'applying'
  | 'error'
  | 'cancelled'

export type IdePromptSelectedCodeContext = {
  relativePath: string
  startLine: number
  endLine: number
  text: string
}

export type IdeEnhancePromptRequest = {
  requestId: string
  conversationId?: string
  worktreeSelector?: string
  workspacePath?: string
  draft: string
  mode?: IdeExecutionMode
  agentId?: string
  modelId?: string
  activeFilePath?: string
  selectedCode?: IdePromptSelectedCodeContext
  mentionedPaths?: string[]
  regenerate?: boolean
}

export type IdeEnhancePromptResult =
  | {
      ok: true
      requestId: string
      enhancedPrompt: string
      agentId: string
      modelId: string
    }
  | {
      ok: false
      requestId: string
      error: string
      cancelled?: boolean
    }
