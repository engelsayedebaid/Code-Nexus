import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import { isPlausiblePluginIconSvg } from '../../shared/plugins/artifacts/plugin-icon-theme-artifact'
import type { OpenVsxUnsupportedCapability } from '../../shared/openvsx/openvsx-types'

const MAX_JSON_FILE_BYTES = 8 * 1024 * 1024
const MAX_ICON_FILE_BYTES = 512 * 1024

export const WELL_KNOWN_LANGUAGE_EXTENSIONS: Record<string, readonly string[]> = {
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'],
  csharp: ['.cs'],
  css: ['.css'],
  dart: ['.dart'],
  dockerfile: ['.dockerfile'],
  elixir: ['.ex', '.exs'],
  flutter: ['.dart'],
  go: ['.go'],
  graphql: ['.graphql', '.gql'],
  html: ['.html', '.htm'],
  ini: ['.ini', '.cfg', '.conf'],
  java: ['.java'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  javascriptreact: ['.jsx'],
  json: ['.json'],
  jsonc: ['.jsonc'],
  kotlin: ['.kt', '.kts'],
  less: ['.less'],
  lua: ['.lua'],
  makefile: ['.mk', '.make'],
  markdown: ['.md', '.mdx'],
  php: ['.php'],
  powershell: ['.ps1'],
  prisma: ['.prisma'],
  proto: ['.proto'],
  python: ['.py', '.pyw'],
  r: ['.r'],
  ruby: ['.rb'],
  rust: ['.rs'],
  scala: ['.scala'],
  scss: ['.scss'],
  shellscript: ['.sh', '.bash', '.zsh'],
  sql: ['.sql'],
  svelte: ['.svelte'],
  swift: ['.swift'],
  terraform: ['.tf', '.tfvars'],
  toml: ['.toml'],
  typescript: ['.ts', '.mts', '.cts'],
  typescriptreact: ['.tsx'],
  vue: ['.vue'],
  xml: ['.xml'],
  yaml: ['.yaml', '.yml'],
  zig: ['.zig']
}

export type VsCodePackageContributes = {
  languages?: unknown
  grammars?: unknown
  snippets?: unknown
  themes?: unknown
  iconThemes?: unknown
  debuggers?: unknown
  breakpoints?: unknown
  views?: unknown
  viewsContainers?: unknown
  viewsWelcome?: unknown
  commands?: unknown
  keybindings?: unknown
  menus?: unknown
  submenus?: unknown
  customEditors?: unknown
  notebookRenderer?: unknown
}

export type VsCodePackageManifest = {
  name?: unknown
  displayName?: unknown
  description?: unknown
  version?: unknown
  publisher?: unknown
  icon?: unknown
  license?: unknown
  homepage?: unknown
  repository?: unknown
  categories?: unknown
  keywords?: unknown
  main?: unknown
  browser?: unknown
  dependencies?: unknown
  extensionPack?: unknown
  extensionDependencies?: unknown
  contributes?: VsCodePackageContributes
}

export function resolveContainedExtensionPath(
  extensionRootDir: string,
  relativePath: string
): string | null {
  const trimmed = relativePath.trim()
  if (!trimmed || trimmed.includes('\0')) {
    return null
  }
  const resolvedRoot = path.resolve(extensionRootDir)
  const resolvedTarget = path.resolve(resolvedRoot, trimmed)
  const rel = path.relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null
  }
  return resolvedTarget
}

export async function readBoundedText(
  filePath: string,
  maxBytes = MAX_JSON_FILE_BYTES
): Promise<string | null> {
  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size > maxBytes) {
      return null
    }
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

export function parseJsoncObject(raw: string): Record<string, unknown> | null {
  const parsed: unknown = parseJsonc(raw, undefined, { allowTrailingComma: true })
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return null
}

export function slugifyContribId(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

export function resolveNlsString(
  raw: unknown,
  nls: Record<string, string> | null
): string {
  if (typeof raw !== 'string') {
    return ''
  }
  const trimmed = raw.trim()
  if (trimmed.startsWith('%') && trimmed.endsWith('%') && trimmed.length > 2 && nls) {
    const key = trimmed.slice(1, -1)
    if (Object.hasOwn(nls, key) && typeof nls[key] === 'string') {
      return nls[key].trim()
    }
  }
  return trimmed
}

export function extractStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export function extractExtensionIdList(raw: unknown): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of extractStringList(raw)) {
    const cleaned = item.trim()
    const lower = cleaned.toLowerCase()
    if (!seen.has(lower) && cleaned.includes('.')) {
      seen.add(lower)
      unique.push(cleaned)
    }
  }
  return unique
}

export function extractRepositoryUrl(raw: unknown): string | undefined {
  let candidate: string | undefined
  if (typeof raw === 'string') {
    candidate = raw.trim()
  } else if (raw && typeof raw === 'object' && typeof (raw as { url?: unknown }).url === 'string') {
    candidate = (raw as { url: string }).url.trim()
  }
  if (!candidate) {
    return undefined
  }
  const normalized = candidate.startsWith('git+') ? candidate.slice(4) : candidate
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function computeRevisionHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

export async function readIconDataUrl(
  extensionRootDir: string,
  iconRelPath: unknown
): Promise<string | undefined> {
  if (typeof iconRelPath !== 'string' || !iconRelPath.trim()) {
    return undefined
  }
  const resolved = resolveContainedExtensionPath(extensionRootDir, iconRelPath)
  if (!resolved) {
    return undefined
  }
  try {
    const fileStat = await stat(resolved)
    if (!fileStat.isFile() || fileStat.size > MAX_ICON_FILE_BYTES) {
      return undefined
    }
    const ext = path.extname(resolved).toLowerCase()
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.svg'
              ? 'image/svg+xml'
              : ext === '.gif'
                ? 'image/gif'
                : null
    if (!mime) {
      return undefined
    }
    const bytes = await readFile(resolved)
    if (ext === '.svg' && !isPlausiblePluginIconSvg(bytes.toString('utf8'))) {
      return undefined
    }
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return undefined
  }
}

export async function readLocalReadme(extensionRootDir: string): Promise<string | undefined> {
  for (const filename of ['README.md', 'readme.md', 'Readme.md']) {
    const candidate = resolveContainedExtensionPath(extensionRootDir, filename)
    if (!candidate) {
      continue
    }
    const content = await readBoundedText(candidate, 512 * 1024)
    if (content) {
      return content
    }
  }
  return undefined
}

export function classifyUnsupportedCapabilities(
  manifest: VsCodePackageManifest,
  description: string
): { hasMainEntrypoint: boolean; unsupportedCapabilities: OpenVsxUnsupportedCapability[] } {
  const unsupported = new Set<OpenVsxUnsupportedCapability>()
  const hasMainEntrypoint =
    (typeof manifest.main === 'string' && manifest.main.trim().length > 0) ||
    (typeof manifest.browser === 'string' && manifest.browser.trim().length > 0)

  if (hasMainEntrypoint) {
    unsupported.add('js-runtime')
  }

  const contributes = manifest.contributes
  if (contributes && typeof contributes === 'object') {
    if (
      (Array.isArray(contributes.debuggers) && contributes.debuggers.length > 0) ||
      (Array.isArray(contributes.breakpoints) && contributes.breakpoints.length > 0)
    ) {
      unsupported.add('debugger')
    }
    if (
      (contributes.views && Object.keys(contributes.views).length > 0) ||
      (contributes.viewsContainers && Object.keys(contributes.viewsContainers).length > 0) ||
      (Array.isArray(contributes.viewsWelcome) && contributes.viewsWelcome.length > 0)
    ) {
      unsupported.add('views')
    }
    if (Array.isArray(contributes.commands) && contributes.commands.length > 0) {
      unsupported.add('commands')
    }
    if (Array.isArray(contributes.keybindings) && contributes.keybindings.length > 0) {
      unsupported.add('keybindings')
    }
    if (
      (contributes.menus && Object.keys(contributes.menus).length > 0) ||
      (contributes.submenus && Object.keys(contributes.submenus).length > 0)
    ) {
      unsupported.add('menus')
    }
    if (
      (Array.isArray(contributes.customEditors) && contributes.customEditors.length > 0) ||
      (Array.isArray(contributes.notebookRenderer) && contributes.notebookRenderer.length > 0)
    ) {
      unsupported.add('webviews')
    }
  }

  if (hasMainEntrypoint) {
    const deps =
      manifest.dependencies && typeof manifest.dependencies === 'object'
        ? Object.keys(manifest.dependencies)
        : []
    const keywords = extractStringList(manifest.keywords).map((k) => k.toLowerCase())
    const categories = extractStringList(manifest.categories).map((c) => c.toLowerCase())
    const combinedText = `${description.toLowerCase()} ${keywords.join(' ')}`
    if (
      deps.includes('vscode-languageclient') ||
      categories.includes('programming languages') ||
      categories.includes('linters') ||
      categories.includes('formatters') ||
      /\b(language server|lsp|intellisense|autocomplete|code completion)\b/.test(combinedText)
    ) {
      unsupported.add('lsp')
    }
  }

  return {
    hasMainEntrypoint,
    unsupportedCapabilities: Array.from(unsupported)
  }
}
