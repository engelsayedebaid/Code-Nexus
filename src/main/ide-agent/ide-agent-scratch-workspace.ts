import { mkdir } from 'node:fs/promises'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { nativeChatScratchFolderFor } from '../native-chat/native-chat-scratch-folder'

// One stable scratch folder per profile gives workspace-less IDE chats a real directory the agent can write into.
const IDE_AGENT_SCRATCH_SESSION_KEY = 'ide-agent-workspace'

export type IdeAgentScratchWorkspace = {
  workspaceKey: string
  workspacePath: string
  worktreeSelector: string
}

export async function resolveIdeAgentScratchWorkspace(): Promise<IdeAgentScratchWorkspace> {
  const workspacePath = nativeChatScratchFolderFor(
    getProfileUserDataPath(),
    IDE_AGENT_SCRATCH_SESSION_KEY
  )
  await mkdir(workspacePath, { recursive: true })
  return {
    workspaceKey: `ide-scratch:${workspacePath}`,
    workspacePath,
    worktreeSelector: `path:${workspacePath}`
  }
}
