import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { detectProjectArchitecture, type ProjectArchitectureProfile } from './ide-codebase-intel'
import { listWorkspaceFilesWithRipgrep } from './harness/ripgrep-workspace-search'

const MAX_TREE_SCAN_FILES = 1_600

export type WorkspaceInspectionSnapshot = {
  workspacePath: string
  isGitRepo: boolean
  fileList: string[]
  keyFiles: { relativePath: string; content: string }[]
  blockedSecretFiles: string[]
  architecture?: ProjectArchitectureProfile
}

async function hasGitEntry(workspacePath: string): Promise<boolean> {
  try {
    await stat(join(workspacePath, '.git'))
    return true
  } catch {
    return false
  }
}

export async function inspectWorkspaceTree(
  workspacePath: string,
  hintTerms: readonly string[],
  readTextFile: (
    relativePath: string
  ) => Promise<{ ok: true; content: string | null } | { ok: false }>,
  signal?: AbortSignal
): Promise<WorkspaceInspectionSnapshot> {
  const [isGitRepo, scanned] = await Promise.all([
    hasGitEntry(workspacePath),
    listWorkspaceFilesWithRipgrep({
      workspacePath,
      maxFiles: MAX_TREE_SCAN_FILES,
      signal
    })
  ])

  const fileList = [
    ...scanned.files,
    ...scanned.blockedSecretFiles.map((rel) => `${rel} [secret-redacted]`)
  ].sort((a, b) => a.localeCompare(b))
  const blockedSecretFiles = scanned.blockedSecretFiles

  const terms = hintTerms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3)
  const scoredCandidates =
    terms.length > 0
      ? scanned.files
          .map((relPath) => {
            const lower = relPath.toLowerCase()
            const base = lower.split('/').pop() ?? lower
            let score = 0
            for (const term of terms) {
              if (base === term || base.startsWith(`${term}.`)) {
                score += 6
              } else if (base.includes(term)) {
                score += 3
              } else if (lower.includes(term)) {
                score += 1
              }
            }
            return { relPath, score }
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
          .slice(0, 4)
          .map((entry) => entry.relPath)
      : []

  const keyFiles: { relativePath: string; content: string }[] = []
  for (const relPath of scoredCandidates) {
    if (signal?.aborted) {
      break
    }
    const readRes = await readTextFile(relPath)
    if (readRes.ok && readRes.content !== null) {
      keyFiles.push({
        relativePath: relPath,
        content:
          readRes.content.length > 16_000
            ? `${readRes.content.slice(0, 16_000)}\n... [truncated]`
            : readRes.content
      })
    }
  }

  const architecture = await detectProjectArchitecture(workspacePath, scanned.files, readTextFile)

  return {
    workspacePath,
    isGitRepo,
    fileList,
    keyFiles,
    blockedSecretFiles,
    architecture
  }
}
