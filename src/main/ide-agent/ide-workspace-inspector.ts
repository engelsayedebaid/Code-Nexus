import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySensitiveFilePath } from '../../shared/ide-agent/ide-plan-policy'
import { detectProjectArchitecture, type ProjectArchitectureProfile } from './ide-codebase-intel'

const MAX_TREE_SCAN_FILES = 240

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target'
])

export type WorkspaceInspectionSnapshot = {
  workspacePath: string
  isGitRepo: boolean
  fileList: string[]
  keyFiles: { relativePath: string; content: string }[]
  blockedSecretFiles: string[]
  architecture?: ProjectArchitectureProfile
}

export async function inspectWorkspaceTree(
  workspacePath: string,
  hintTerms: readonly string[],
  readTextFile: (
    relativePath: string
  ) => Promise<{ ok: true; content: string | null } | { ok: false }>
): Promise<WorkspaceInspectionSnapshot> {
  const fileList: string[] = []
  const blockedSecretFiles: string[] = []
  const isGitRepo = existsSync(join(workspacePath, '.git'))

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (depth > 5 || fileList.length >= MAX_TREE_SCAN_FILES) {
      return
    }
    const absDir = relDir ? join(workspacePath, relDir) : workspacePath
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (fileList.length >= MAX_TREE_SCAN_FILES) {
        break
      }
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(relPath, depth + 1)
        }
        continue
      }
      if (entry.isFile()) {
        const sensitive = classifySensitiveFilePath(relPath, 'read-context')
        if (sensitive === 'send_secret_context') {
          blockedSecretFiles.push(relPath)
          fileList.push(`${relPath} [secret-redacted]`)
        } else {
          fileList.push(relPath)
        }
      }
    }
  }

  await walk('', 0)

  const priorityCandidates = [
    'package.json',
    'tsconfig.json',
    'README.md',
    'Cargo.toml',
    'pyproject.toml'
  ]
  const terms = hintTerms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3)
  const matchingFiles = fileList.filter(
    (path) =>
      !path.endsWith('[secret-redacted]') && terms.some((term) => path.toLowerCase().includes(term))
  )
  const toRead = Array.from(
    new Set([...priorityCandidates, ...matchingFiles, ...fileList.slice(0, 8)])
  )
    .filter((path) => !path.endsWith('[secret-redacted]'))
    .slice(0, 12)

  const keyFiles: { relativePath: string; content: string }[] = []
  for (const relPath of toRead) {
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

  const architecture = await detectProjectArchitecture(workspacePath, fileList, readTextFile)

  return {
    workspacePath,
    isGitRepo,
    fileList,
    keyFiles,
    blockedSecretFiles,
    architecture
  }
}
