import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { getActiveIdeEditorSelection } from '@/lib/ide-agent/ide-editor-selection'
import { useAppStore } from '@/store'
import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../../shared/ide-agent/ide-plan-policy'
import type {
  IdeEnhancePromptRequest,
  IdeEnhancePromptResult,
  IdePromptSelectedCodeContext
} from '../../../../shared/ide-agent/ide-prompt-enhancer-types'
import { useIdeAgentStore } from './ide-agent-store'

export type PromptEnhancerTransport = {
  enhance: (req: IdeEnhancePromptRequest) => Promise<IdeEnhancePromptResult>
  cancel: (requestId: string) => Promise<void>
}

const defaultTransport: PromptEnhancerTransport = {
  enhance: (req) =>
    callRuntimeRpc<IdeEnhancePromptResult>({ kind: 'local' }, 'ideAgent.enhancePrompt', req, {
      timeoutMs: 50_000
    }),
  cancel: async (requestId) => {
    await callRuntimeRpc<{ cancelled: boolean }>(
      { kind: 'local' },
      'ideAgent.cancelEnhancePrompt',
      { requestId }
    ).catch(() => undefined)
  }
}

let activeTransport: PromptEnhancerTransport = defaultTransport

export function getPromptEnhancerTransport(): PromptEnhancerTransport {
  return activeTransport
}

export function setPromptEnhancerTransportForTesting(
  transport: PromptEnhancerTransport | null
): void {
  activeTransport = transport ?? defaultTransport
}

export function collectIdeContextForEnhancement(
  conversationId: string,
  worktreeId: string | null | undefined
): {
  activeFilePath?: string
  selectedCode?: IdePromptSelectedCodeContext
  mentionedPaths?: string[]
} {
  const appState = useAppStore.getState()
  const activeOpenFile = appState.openFiles.find((f) => f.id === appState.activeFileId)
  let activeFilePath: string | undefined
  let selectedCode: IdePromptSelectedCodeContext | undefined

  if (activeOpenFile && (!worktreeId || activeOpenFile.worktreeId === worktreeId)) {
    const cleanRel = normalizeWorkspaceRelativePath(
      activeOpenFile.relativePath || activeOpenFile.filePath
    )
    if (cleanRel && classifySensitiveFilePath(cleanRel, 'read-context') === null) {
      activeFilePath = cleanRel
      const sel = getActiveIdeEditorSelection(cleanRel)
      if (sel && sel.text.trim().length > 0) {
        selectedCode = {
          relativePath: cleanRel,
          startLine: sel.startLine,
          endLine: sel.endLine,
          text: sel.text.slice(0, 4_000)
        }
      }
    }
  }

  const attachments = useIdeAgentStore.getState().attachmentsByConversation[conversationId] ?? []
  const mentionedPaths = attachments
    .map((att) => (att.relativePath ? normalizeWorkspaceRelativePath(att.relativePath) : null))
    .filter(
      (rel): rel is string =>
        rel !== null && rel.length > 0 && classifySensitiveFilePath(rel, 'read-context') === null
    )
    .slice(0, 12)

  return {
    ...(activeFilePath ? { activeFilePath } : {}),
    ...(selectedCode ? { selectedCode } : {}),
    ...(mentionedPaths.length > 0 ? { mentionedPaths } : {})
  }
}
