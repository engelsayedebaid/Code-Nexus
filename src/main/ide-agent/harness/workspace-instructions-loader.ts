import { readFile } from 'node:fs/promises'
import { discoverSkills } from '../../skills/discovery/skill-native-discovery'
import type { IdeWorkspaceGateway } from '../ide-workspace-gateway'
import { redactSensitiveSecrets } from './prompt-security-guard'

export type DiscoveredWorkspaceSkillRef = {
  name: string
  description: string
  skillFilePath: string
  sourceKind: string
}

export type WorkspaceInstructionsBundle = {
  projectRulesBlock: string
  skillsSummaryBlock: string
  mcpSummaryBlock: string
  skills: readonly DiscoveredWorkspaceSkillRef[]
}

// Deterministic precedence order for project-level instruction files.
const PROJECT_RULE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md'
] as const

const MCP_CONFIG_FILES = ['.mcp.json', '.cursor/mcp.json'] as const

type CachedSkillsEntry = {
  expiresAt: number
  skills: DiscoveredWorkspaceSkillRef[]
}

const repoSkillsCacheByWorkspace = new Map<string, CachedSkillsEntry>()
const SKILLS_CACHE_TTL_MS = 20_000

async function loadRepoSkillsSummary(
  workspacePath: string,
  signal?: AbortSignal
): Promise<DiscoveredWorkspaceSkillRef[]> {
  const now = Date.now()
  const cached = repoSkillsCacheByWorkspace.get(workspacePath)
  if (cached && cached.expiresAt > now) {
    return cached.skills
  }
  try {
    const discovered = await discoverSkills({
      cwd: workspacePath,
      includeCwd: true,
      sourceKinds: ['repo'],
      signal
    })
    const skills: DiscoveredWorkspaceSkillRef[] = discovered.skills.slice(0, 16).map((s) => ({
      name: s.name,
      description: (s.description ?? 'Workspace skill').slice(0, 180),
      skillFilePath: s.skillFilePath,
      sourceKind: s.sourceKind
    }))
    repoSkillsCacheByWorkspace.set(workspacePath, {
      expiresAt: now + SKILLS_CACHE_TTL_MS,
      skills
    })
    return skills
  } catch {
    return []
  }
}

async function loadWorkspaceMcpSummary(gateway: IdeWorkspaceGateway): Promise<string> {
  const serverEntries: string[] = []
  for (const relPath of MCP_CONFIG_FILES) {
    const res = await gateway.readTextFile(relPath, { allowSecretRead: false })
    if (!res.ok || !res.content) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(res.content)
      if (!parsed || typeof parsed !== 'object' || !('mcpServers' in parsed)) {
        continue
      }
      const rawServers = parsed.mcpServers
      if (!rawServers || typeof rawServers !== 'object') {
        continue
      }
      for (const [name, cfg] of Object.entries(rawServers)) {
        if (!cfg || typeof cfg !== 'object') {
          continue
        }
        if ('disabled' in cfg && cfg.disabled === true) {
          continue
        }
        const url = 'url' in cfg && typeof cfg.url === 'string' ? cfg.url : undefined
        const command =
          'command' in cfg && typeof cfg.command === 'string' ? cfg.command : undefined
        const description =
          'description' in cfg && typeof cfg.description === 'string' ? cfg.description : undefined
        const transport = url ? 'http/sse' : command ? `stdio (${command})` : 'configured'
        const desc = description ? ` — ${description.slice(0, 120)}` : ''
        serverEntries.push(`- ${name} [${transport}]${desc}`)
      }
    } catch {
      // Ignore malformed MCP config file
    }
  }
  if (serverEntries.length === 0) {
    return ''
  }
  return `Configured Workspace MCP Servers (${serverEntries.length}):\n${serverEntries.slice(0, 12).join('\n')}`
}

export async function loadTrustedWorkspaceInstructions(params: {
  gateway: IdeWorkspaceGateway
  maxRulesChars: number
  signal?: AbortSignal
}): Promise<WorkspaceInstructionsBundle> {
  const { gateway, maxRulesChars, signal } = params
  let remaining = Math.max(800, maxRulesChars)
  const ruleSections: string[] = []

  for (const relPath of PROJECT_RULE_FILES) {
    if (signal?.aborted || remaining <= 200) {
      break
    }
    const readRes = await gateway.readTextFile(relPath, { allowSecretRead: false })
    if (!readRes.ok || !readRes.content?.trim()) {
      continue
    }
    const clean = redactSensitiveSecrets(readRes.content.trim()).text
    const slice =
      clean.length > remaining
        ? `${clean.slice(0, remaining)}\n... [project rules truncated to fit budget]`
        : clean
    remaining -= slice.length
    ruleSections.push(`### Project Rules (${relPath})\n${slice}`)
  }

  const [skills, mcpSummaryBlock] = await Promise.all([
    loadRepoSkillsSummary(gateway.target.workspacePath, signal),
    loadWorkspaceMcpSummary(gateway)
  ])

  const skillsSummaryBlock =
    skills.length > 0
      ? [
          `Available Workspace Skills (use read_skill tool with {"name": "..."} when a skill matches the task):`,
          ...skills.map((s) => `- ${s.name}: ${s.description}`)
        ].join('\n')
      : ''

  return {
    projectRulesBlock: ruleSections.join('\n\n'),
    skillsSummaryBlock,
    mcpSummaryBlock,
    skills
  }
}

export async function readDiscoveredWorkspaceSkill(
  workspacePath: string,
  skillName: string,
  signal?: AbortSignal
): Promise<{ ok: true; content: string; name: string } | { ok: false; message: string }> {
  const needle = skillName.trim().toLowerCase()
  if (!needle) {
    return { ok: false, message: 'Skill "name" is required.' }
  }
  const repoSkills = await loadRepoSkillsSummary(workspacePath, signal)
  let matched = repoSkills.find((s) => s.name.toLowerCase() === needle)
  if (!matched) {
    try {
      const all = await discoverSkills({
        cwd: workspacePath,
        includeCwd: true,
        sourceKinds: ['repo', 'plugin'],
        signal
      })
      const found = all.skills.find((s) => s.name.toLowerCase() === needle)
      if (found) {
        matched = {
          name: found.name,
          description: found.description ?? 'Skill',
          skillFilePath: found.skillFilePath,
          sourceKind: found.sourceKind
        }
      }
    } catch {
      // Ignore fallback discovery failure
    }
  }
  if (!matched) {
    return {
      ok: false,
      message: `Skill "${skillName}" is not installed in this workspace.`
    }
  }
  try {
    const raw = await readFile(matched.skillFilePath, 'utf8')
    return {
      ok: true,
      name: matched.name,
      content: redactSensitiveSecrets(raw.slice(0, 14_000)).text
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
