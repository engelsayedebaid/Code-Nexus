import { createHash } from 'node:crypto'
import type { ProjectArchitectureProfile } from '../ide-codebase-intel'

const CODE_EXTENSION_PATTERN = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs|py|rs|go)$/i
const TS_EXTENSION_PATTERN = /\.(ts|tsx|mts|cts)$/i

function buildPackageScriptCommand(
  packageManager: ProjectArchitectureProfile['packageManager'],
  scriptName: string
): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm run ${scriptName}`
    case 'bun':
      return `bun run ${scriptName}`
    case 'yarn':
      return `yarn ${scriptName}`
    case 'npm':
    case null:
    default:
      return `npm run ${scriptName}`
  }
}

export function selectPolicyVerificationCommands(params: {
  explicitCommands: readonly string[]
  modifiedFiles: ReadonlySet<string>
  architecture?: ProjectArchitectureProfile
}): string[] {
  const chosen: string[] = [...params.explicitCommands]
  if (chosen.length > 0 || params.modifiedFiles.size === 0 || !params.architecture) {
    return chosen
  }

  const scripts = params.architecture.scripts
  const pm = params.architecture.packageManager
  const modifiedArray = [...params.modifiedFiles]
  const touchedCode = modifiedArray.some((p) => CODE_EXTENSION_PATTERN.test(p))
  if (!touchedCode) {
    return chosen
  }

  const touchedTs = modifiedArray.some((p) => TS_EXTENSION_PATTERN.test(p))
  if (touchedTs) {
    const tcScript = ['typecheck', 'tc', 'check-types', 'type-check'].find(
      (key) => typeof scripts[key] === 'string' && scripts[key].trim().length > 0
    )
    if (tcScript) {
      chosen.push(buildPackageScriptCommand(pm, tcScript))
    }
  }

  const touchedTests = modifiedArray.some((p) => /\.(test|spec)\.[A-Za-z0-9]+$/.test(p))
  if (touchedTests && typeof scripts.test === 'string' && scripts.test.trim().length > 0) {
    chosen.push(buildPackageScriptCommand(pm, 'test'))
  }

  return chosen.slice(0, 3)
}

export function computeVerificationFailureSignature(params: {
  command: string
  exitCode: number | null
  stdoutTail: string
  stderrTail: string
}): string {
  const normalizedOutput = `${params.stdoutTail}\n${params.stderrTail}`
    .replace(/\b\d+ms\b/g, '<ms>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-2_000)
  return createHash('sha256')
    .update(`${params.command}|${params.exitCode ?? 'null'}|${normalizedOutput}`, 'utf8')
    .digest('hex')
    .slice(0, 16)
}

export function extractDiagnosticErrorSignatures(details: string): Set<string> {
  const signatures = new Set<string>()
  for (const line of details.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (/\berror TS\d+:|:\d+:\d+\s+-\s+error\b/i.test(trimmed)) {
      signatures.add(trimmed)
    }
  }
  return signatures
}

export function filterNewDiagnosticRegressions(
  baselineErrors: ReadonlySet<string>,
  afterDetails: string
): { newErrors: string[]; preExistingCount: number } {
  if (baselineErrors.size === 0) {
    const all = [...extractDiagnosticErrorSignatures(afterDetails)]
    return { newErrors: all, preExistingCount: 0 }
  }
  const afterSet = extractDiagnosticErrorSignatures(afterDetails)
  const newErrors: string[] = []
  let preExistingCount = 0
  for (const item of afterSet) {
    if (baselineErrors.has(item)) {
      preExistingCount += 1
    } else {
      newErrors.push(item)
    }
  }
  return { newErrors, preExistingCount }
}
