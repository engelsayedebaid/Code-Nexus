import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { agyUsesApiKey, hasAgyCredential } from '../../../../antigravity/antigravity-host-acp'
import { spawnSourceControlAgent } from '../../../../text-generation/source-control-agent-launch'
import { killSourceControlAgentProcess } from '../../../../text-generation/source-control-local-process'

export type CouncilAgentAuthStatus = 'authenticated' | 'unauthenticated' | 'unknown' | 'unavailable'

export type CouncilAgentAuthInfo = {
  authStatus: CouncilAgentAuthStatus
  authNote?: string
}

const AUTH_CACHE_TTL_MS = 15_000
const STATUS_PROBE_TIMEOUT_MS = 3_000

const authCache = new Map<string, { at: number; info: CouncilAgentAuthInfo }>()

export function extraCliDirectoriesForAgent(
  agentId: string,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  if (agentId !== 'antigravity') {
    return []
  }
  const homePath = env.USERPROFILE ?? env.HOME ?? homedir()
  const dirs = [join(homePath, '.gemini', 'bin'), join(homePath, '.gemini', 'antigravity', 'bin')]
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? join(homePath, 'AppData', 'Local')
    dirs.push(join(localAppData, 'agy', 'bin'))
  }
  return dirs.filter((dir) => existsSync(dir))
}

export function withExtraAgentDirectoriesOnPath(
  agentId: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const extraDirs = extraCliDirectoriesForAgent(agentId, env)
  if (extraDirs.length === 0) {
    return env
  }
  const pathKey =
    process.platform === 'win32'
      ? (Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path')
      : 'PATH'
  const currentEntries = (env[pathKey] ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const existing = new Set(
    currentEntries.map((entry) => (process.platform === 'win32' ? entry.toLowerCase() : entry))
  )
  const missing = extraDirs.filter(
    (dir) => !existing.has(process.platform === 'win32' ? dir.toLowerCase() : dir)
  )
  if (missing.length === 0) {
    return env
  }
  return {
    ...env,
    [pathKey]: [...currentEntries, ...missing].join(delimiter)
  }
}

async function runQuickCliStatus(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string } | null> {
  return await new Promise((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let child: ReturnType<typeof spawnSourceControlAgent>
    try {
      child = spawnSourceControlAgent({
        binary,
        args,
        cwd: homedir(),
        env,
        stdinMode: 'ignore',
        useCwdForNative: false
      })
    } catch {
      resolve(null)
      return
    }
    const finish = (value: { code: number | null; stdout: string; stderr: string } | null) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      void killSourceControlAgentProcess(child).catch(() => {})
      finish(null)
    }, STATUS_PROBE_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 16_384) {
        stdout += chunk.toString('utf8')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_384) {
        stderr += chunk.toString('utf8')
      }
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

async function checkNonEmptyJsonFile(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return false
    }
    return Object.keys(parsed).length > 0
  } catch {
    return false
  }
}

async function probeAgentAuth(
  agentId: string,
  resolvedBinary: string,
  env: NodeJS.ProcessEnv
): Promise<CouncilAgentAuthInfo> {
  const homePath = env.USERPROFILE ?? env.HOME ?? homedir()
  if (agentId === 'claude') {
    if (
      env.ANTHROPIC_API_KEY?.trim() ||
      env.ANTHROPIC_AUTH_TOKEN?.trim() ||
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
    ) {
      return { authStatus: 'authenticated', authNote: 'Authenticated via API key/token.' }
    }
    const result = await runQuickCliStatus(resolvedBinary, ['auth', 'status'], env)
    if (result) {
      try {
        const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown; authMethod?: unknown }
        if (parsed.loggedIn === true) {
          return { authStatus: 'authenticated', authNote: 'Signed in to Claude.' }
        }
        if (parsed.loggedIn === false) {
          return {
            authStatus: 'unauthenticated',
            authNote: 'Claude CLI is not signed in. Run "claude auth login".'
          }
        }
      } catch {
        // Non-JSON output from an older CLI falls through cleanly.
      }
    }
    return { authStatus: 'unknown' }
  }
  if (agentId === 'codex') {
    if (env.OPENAI_API_KEY?.trim() || env.CODEX_API_KEY?.trim()) {
      return { authStatus: 'authenticated', authNote: 'Authenticated via API key.' }
    }
    const result = await runQuickCliStatus(resolvedBinary, ['login', 'status'], env)
    if (result) {
      const combined = `${result.stdout}\n${result.stderr}`
      if (/logged in/i.test(combined) && result.code === 0) {
        return { authStatus: 'authenticated', authNote: result.stdout.trim() || 'Signed in.' }
      }
      if (/not logged in|logged out/i.test(combined)) {
        return {
          authStatus: 'unauthenticated',
          authNote: 'Codex CLI is not signed in. Run "codex login".'
        }
      }
    }
    const codexHome = env.CODEX_HOME?.trim() || join(homePath, '.codex')
    if (await checkNonEmptyJsonFile(join(codexHome, 'auth.json'))) {
      return { authStatus: 'authenticated', authNote: 'Signed in via Codex auth.json.' }
    }
    return { authStatus: 'unknown' }
  }
  if (agentId === 'antigravity') {
    if (
      env.GEMINI_API_KEY?.trim() ||
      env.GOOGLE_API_KEY?.trim() ||
      (await agyUsesApiKey(homePath))
    ) {
      return { authStatus: 'authenticated', authNote: 'Configured via API key.' }
    }
    if (await hasAgyCredential(homePath)) {
      return { authStatus: 'authenticated', authNote: 'Signed in to Antigravity.' }
    }
    return {
      authStatus: 'unknown',
      authNote: 'Click Refresh models to verify Antigravity session credentials.'
    }
  }
  if (agentId === 'opencode' || agentId === 'opencode2') {
    if (
      env.OPENAI_API_KEY?.trim() ||
      env.ANTHROPIC_API_KEY?.trim() ||
      env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      env.OPENROUTER_API_KEY?.trim()
    ) {
      return { authStatus: 'authenticated', authNote: 'Provider API key set.' }
    }
    const authPath = join(homePath, '.local', 'share', 'opencode', 'auth.json')
    if (await checkNonEmptyJsonFile(authPath)) {
      return { authStatus: 'authenticated', authNote: 'OpenCode credentials configured.' }
    }
    return { authStatus: 'unknown' }
  }
  return { authStatus: 'unknown' }
}

export function clearCouncilAuthCache(agentId?: string): void {
  if (!agentId) {
    authCache.clear()
    return
  }
  const prefix = `${agentId}:`
  for (const key of authCache.keys()) {
    if (key.startsWith(prefix)) {
      authCache.delete(key)
    }
  }
}

/** Detects real provider authentication state with a short cache to keep dropdown opens snappy. */
export async function resolveCouncilAgentAuthInfo(
  agentId: string,
  resolvedBinary: string,
  env: NodeJS.ProcessEnv,
  refresh = false
): Promise<CouncilAgentAuthInfo> {
  const key = `${agentId}:${resolvedBinary}`
  const cached = authCache.get(key)
  if (!refresh && cached && Date.now() - cached.at < AUTH_CACHE_TTL_MS) {
    return cached.info
  }
  const info = await probeAgentAuth(agentId, resolvedBinary, env)
  authCache.set(key, { at: Date.now(), info })
  return info
}
