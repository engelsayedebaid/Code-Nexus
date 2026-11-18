import {
  classifySensitiveFilePath,
  normalizeWorkspaceRelativePath
} from '../../../shared/ide-agent/ide-plan-policy'
import type { IdeChatAttachment } from '../../../shared/ide-agent/ide-agent-types'
import { formatIdeAttachmentPromptBlock } from '../ide-attachment-prompt-context'
import type { IdeContextBudgetTracker } from '../ide-context-budget'
import type { IdeWorkspaceGateway, WorkspaceInspectionSnapshot } from '../ide-workspace-gateway'
import type { ResolvedModelExecutionProfile } from './model-capability-registry'
import { fenceUntrustedWorkspaceData } from './prompt-security-guard'

export type RankedContextSnippet = {
  relativePath: string
  score: number
  reason: string
  content: string
}

const FILE_MENTION_PATTERN =
  /(?:@|\b)((?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|rs|go|yaml|yml|toml|sql))(?:(?:#L|:)(\d+)(?:-L?(\d+))?)?/g

export function extractExplicitFileMentions(text: string): {
  relativePath: string
  startLine?: number
  endLine?: number
}[] {
  const seen = new Set<string>()
  const mentions: { relativePath: string; startLine?: number; endLine?: number }[] = []
  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const rawPath = match[1]
    const matchIdx = match.index ?? 0
    const preceding = text.slice(Math.max(0, matchIdx - 3), matchIdx)
    if (
      !rawPath ||
      rawPath.startsWith('http') ||
      rawPath.includes('..') ||
      preceding.includes('..')
    ) {
      continue
    }
    const rel = normalizeWorkspaceRelativePath(rawPath)
    const lower = rel.toLowerCase()
    if (!rel || seen.has(lower)) {
      continue
    }
    seen.add(lower)
    const startLine = match[2] ? Number.parseInt(match[2], 10) : undefined
    const endLine = match[3] ? Number.parseInt(match[3], 10) : undefined
    mentions.push({
      relativePath: rel,
      ...(startLine && Number.isFinite(startLine) ? { startLine } : {}),
      ...(endLine && Number.isFinite(endLine) ? { endLine } : {})
    })
  }
  return mentions.slice(0, 8)
}

export async function gatherRankedTurnContext(params: {
  gateway: IdeWorkspaceGateway
  snapshot: WorkspaceInspectionSnapshot
  userText: string
  activeFilePath?: string
  openFilePaths?: readonly string[]
  attachments: readonly IdeChatAttachment[]
  budget: IdeContextBudgetTracker
  profile: ResolvedModelExecutionProfile
  signal?: AbortSignal
}): Promise<{
  rankedSnippets: RankedContextSnippet[]
  activeFileContent: { relativePath: string; content: string } | null
}> {
  const { gateway, snapshot, userText, attachments, budget, profile, signal } = params
  const maxRetrievedChars = Math.max(2_400, profile.allocation.retrievedContextTokens * 4)
  const perFileCharCap = Math.min(14_000, Math.max(2_000, Math.floor(maxRetrievedChars * 0.45)))

  const attachedPaths = new Set(
    attachments
      .map((a) =>
        a.relativePath ? normalizeWorkspaceRelativePath(a.relativePath).toLowerCase() : ''
      )
      .filter(Boolean)
  )

  const candidates = new Map<string, { relPath: string; score: number; reason: string }>()
  const addCandidate = (rawPath: string, score: number, reason: string): void => {
    const clean = normalizeWorkspaceRelativePath(rawPath)
    if (
      !clean ||
      clean.includes('[secret-redacted]') ||
      classifySensitiveFilePath(clean, 'read-context') === 'send_secret_context'
    ) {
      return
    }
    const key = clean.toLowerCase()
    const prev = candidates.get(key)
    if (!prev || score > prev.score) {
      candidates.set(key, { relPath: clean, score, reason })
    }
  }

  for (const mention of extractExplicitFileMentions(userText)) {
    addCandidate(mention.relativePath, 95, 'explicitly mentioned in request')
  }
  if (params.activeFilePath) {
    addCandidate(params.activeFilePath, 88, 'active editor tab')
  }
  for (const openPath of (params.openFilePaths ?? []).slice(0, 6)) {
    addCandidate(openPath, 62, 'open editor tab')
  }
  for (const keyFile of snapshot.keyFiles) {
    addCandidate(keyFile.relativePath, 55, 'workspace filename match')
  }
  for (const entry of (snapshot.architecture?.entryPoints ?? []).slice(0, 2)) {
    addCandidate(entry, 25, 'workspace entry point')
  }

  const primarySeed =
    (params.activeFilePath ? normalizeWorkspaceRelativePath(params.activeFilePath) : null) ??
    extractExplicitFileMentions(userText)[0]?.relativePath ??
    null
  if (primarySeed && gateway.getImports && !signal?.aborted) {
    const graph = await gateway.getImports(primarySeed).catch(() => null)
    if (graph) {
      for (const dependent of graph.importedBy.slice(0, 3)) {
        addCandidate(dependent, 74, `imports ${primarySeed}`)
      }
    }
  }

  const ordered = [...candidates.values()].sort(
    (a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath)
  )
  const preloadedByPath = new Map(
    snapshot.keyFiles.map((f) => [f.relativePath.toLowerCase(), f.content])
  )

  const rankedSnippets: RankedContextSnippet[] = []
  let activeFileContent: { relativePath: string; content: string } | null = null
  const normalizedActiveLower = params.activeFilePath
    ? normalizeWorkspaceRelativePath(params.activeFilePath).toLowerCase()
    : null
  let usedSnippetChars = 0

  for (const item of ordered.slice(0, 8)) {
    if (signal?.aborted || usedSnippetChars >= maxRetrievedChars) {
      break
    }
    if (
      attachedPaths.has(item.relPath.toLowerCase()) &&
      item.relPath.toLowerCase() !== normalizedActiveLower
    ) {
      continue
    }
    let rawContent = preloadedByPath.get(item.relPath.toLowerCase()) ?? null
    if (rawContent === null) {
      const readRes = await gateway.readTextFile(item.relPath, { allowSecretRead: false })
      if (!readRes.ok || readRes.content === null) {
        continue
      }
      rawContent = readRes.content
    }
    const remaining = Math.max(0, maxRetrievedChars - usedSnippetChars)
    const sliceCap = Math.min(perFileCharCap, remaining)
    if (sliceCap < 240) {
      break
    }
    const sliced =
      rawContent.length > sliceCap
        ? `${rawContent.slice(0, sliceCap)}\n... [truncated; use read_file_range for remaining lines]`
        : rawContent
    const recorded = budget.recordText(`file:${item.relPath}`, sliced)
    const finalContent = recorded.included ? recorded.text : sliced.slice(0, sliceCap)
    usedSnippetChars += finalContent.length

    if (normalizedActiveLower && item.relPath.toLowerCase() === normalizedActiveLower) {
      activeFileContent = { relativePath: item.relPath, content: finalContent }
    } else {
      rankedSnippets.push({
        relativePath: item.relPath,
        score: item.score,
        reason: item.reason,
        content: finalContent
      })
    }
  }

  return { rankedSnippets, activeFileContent }
}

export function formatBudgetedWorkspacePromptContext(params: {
  snapshot: WorkspaceInspectionSnapshot
  attachments: readonly IdeChatAttachment[]
  activeFileContent?: { relativePath: string; content: string } | null
  rankedSnippets?: readonly RankedContextSnippet[]
  maxContextChars?: number
}): string {
  const { snapshot, attachments, activeFileContent, rankedSnippets } = params
  const maxChars = Math.max(3_200, params.maxContextChars ?? 48_000)
  const arch = snapshot.architecture
  const archLines = arch
    ? [
        arch.stackLabels.length > 0 ? `Detected stack: ${arch.stackLabels.join(', ')}` : '',
        arch.packageManager ? `Package manager: ${arch.packageManager}` : '',
        Object.keys(arch.scripts).length > 0
          ? `Package scripts: ${Object.entries(arch.scripts)
              .slice(0, 14)
              .map(([k, v]) => `${k}="${v}"`)
              .join(', ')}`
          : '',
        arch.entryPoints.length > 0 ? `Entry points: ${arch.entryPoints.join(', ')}` : '',
        arch.conventions.length > 0 ? `Conventions: ${arch.conventions.join('; ')}` : ''
      ].filter(Boolean)
    : []

  const maxTreeEntries = maxChars < 16_000 ? 50 : 120
  const sections: string[] = [
    `Workspace root: ${snapshot.workspacePath}`,
    `Git repository: ${snapshot.isGitRepo ? 'yes' : 'no (folder workspace)'}`,
    ...archLines,
    `Files (${snapshot.fileList.length}):\n${snapshot.fileList.slice(0, maxTreeEntries).join('\n')}`
  ]

  if (snapshot.blockedSecretFiles.length > 0) {
    sections.push(
      `Secret files excluded from context (require explicit permission): ${snapshot.blockedSecretFiles.slice(0, 20).join(', ')}`
    )
  }

  let currentChars = sections.join('\n\n').length

  const appendBoundedSection = (block: string): void => {
    const remaining = maxChars - currentChars
    if (remaining <= 220) {
      return
    }
    const fitted =
      block.length > remaining
        ? `${block.slice(0, remaining - 48)}\n... [context clipped to model budget]\n</untrusted_workspace_data>`
        : block
    sections.push(fitted)
    currentChars += fitted.length + 2
  }

  for (const att of attachments) {
    appendBoundedSection(
      fenceUntrustedWorkspaceData({
        kind: 'attachment',
        source: att.relativePath ?? att.name,
        content: formatIdeAttachmentPromptBlock(att)
      })
    )
  }

  if (activeFileContent) {
    appendBoundedSection(
      fenceUntrustedWorkspaceData({
        kind: 'workspace_file',
        source: `${activeFileContent.relativePath} (active editor)`,
        content: activeFileContent.content
      })
    )
  }

  const snippets =
    rankedSnippets ??
    snapshot.keyFiles.map((f) => ({
      relativePath: f.relativePath,
      score: 50,
      reason: 'workspace match',
      content: f.content
    }))
  for (const snippet of snippets) {
    appendBoundedSection(
      fenceUntrustedWorkspaceData({
        kind: 'workspace_file',
        source: `${snippet.relativePath} (${snippet.reason})`,
        content: snippet.content
      })
    )
  }

  return sections.join('\n\n')
}
