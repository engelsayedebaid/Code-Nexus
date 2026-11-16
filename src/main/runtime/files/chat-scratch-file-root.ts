import { lstat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { RuntimeStore } from '../construction/runtime-store-contract'
import {
  resolveAuthorizedPath,
  type ResolveAuthorizedPathOptions
} from '../../ipc/filesystem/access/filesystem-auth'
import { isENOENT } from '../../ipc/filesystem/access/filesystem-path-containment'
import { nativeChatScratchRootFor } from '../../native-chat/native-chat-scratch-folder'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { getFloatingWorkspaceFileRoots } from '../../ipc/floating-workspace-directory'

const PATH_SELECTOR_PREFIX = 'path:'
const SCRATCH_FOLDER_NAME = /^[0-9a-f]{32}$/

function chatScratchRoot(): string {
  return nativeChatScratchRootFor(getProfileUserDataPath())
}

export function resolveRuntimeAuthorizedPath(
  targetPath: string,
  store: RuntimeStore,
  options: ResolveAuthorizedPathOptions = {}
): Promise<string> {
  const floating = getFloatingWorkspaceFileRoots(store)
  return resolveAuthorizedPath(targetPath, store, {
    ...options,
    extraRoots: [chatScratchRoot(), ...floating.extraRoots],
    exactRoots: floating.exactRoots
  })
}

export function isChatScratchWorktreeId(worktreeId: string): boolean {
  return worktreeId.startsWith(PATH_SELECTOR_PREFIX)
}

async function chatScratchFolderIfDirectory(folder: string): Promise<string | null> {
  if (dirname(folder) !== chatScratchRoot() || !SCRATCH_FOLDER_NAME.test(basename(folder))) {
    return null
  }
  try {
    return (await lstat(folder)).isDirectory() ? folder : null
  } catch (error) {
    if (isENOENT(error)) {
      return null
    }
    throw error
  }
}

/** Only this host's exact scratch-root/32-hex folder may answer; reject lookalike roots and symlinks. */
export async function resolveChatScratchSelectorFolder(selector: string): Promise<string | null> {
  if (!selector.startsWith(PATH_SELECTOR_PREFIX)) {
    return null
  }
  return chatScratchFolderIfDirectory(selector.slice(PATH_SELECTOR_PREFIX.length))
}

/** Same validation for callers that hold the folder's absolute path instead of a `path:` selector. */
export async function resolveChatScratchFolderPath(folder: string): Promise<string | null> {
  return chatScratchFolderIfDirectory(folder)
}
