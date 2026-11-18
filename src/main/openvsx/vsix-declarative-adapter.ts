import path from 'node:path'
import type { PluginThemeRegistration } from '../../shared/plugins/artifacts/plugin-theme-artifact'
import {
  toOpenVsxPluginKey,
  type OpenVsxActiveCapability,
  type OpenVsxInstalledContributionSummary,
  type OpenVsxRuntimeSupport,
  type OpenVsxSnippetItem
} from '../../shared/openvsx/openvsx-types'
import {
  classifyUnsupportedCapabilities,
  extractExtensionIdList,
  extractRepositoryUrl,
  extractStringList,
  parseJsoncObject,
  readBoundedText,
  readIconDataUrl,
  readLocalReadme,
  resolveNlsString,
  type VsCodePackageManifest
} from './vsix-package-manifest'
import {
  extractVsixIconThemes,
  type AdaptedOpenVsxIconThemeEntry
} from './vsix-icon-theme-converter'
import { extractVsixSnippets } from './vsix-snippet-converter'
import { extractVsixSyntaxes, type AdaptedOpenVsxSyntaxEntry } from './vsix-syntax-converter'
import { extractVsixThemes } from './vsix-theme-converter'

export type { AdaptedOpenVsxIconThemeEntry, AdaptedOpenVsxSyntaxEntry }

export type AdaptedOpenVsxExtensionAssets = {
  id: string
  namespace: string
  name: string
  displayName: string
  description: string
  version: string
  publisher: string
  iconDataUrl?: string
  repositoryUrl?: string
  homepageUrl?: string
  license?: string
  categories: string[]
  extensionPack: string[]
  dependencies: string[]
  runtimeSupport: OpenVsxRuntimeSupport
  contributions: OpenVsxInstalledContributionSummary
  syntaxes: AdaptedOpenVsxSyntaxEntry[]
  snippets: OpenVsxSnippetItem[]
  themes: PluginThemeRegistration[]
  iconThemes: AdaptedOpenVsxIconThemeEntry[]
  readmeMarkdown?: string
  warnings: string[]
}

export async function adaptExtractedVsixExtension(
  extensionRootDir: string,
  expectedId?: string
): Promise<AdaptedOpenVsxExtensionAssets> {
  const pkgRaw = await readBoundedText(path.join(extensionRootDir, 'package.json'))
  if (!pkgRaw) {
    throw new Error('Missing or unreadable extension/package.json inside VSIX')
  }
  const manifest: VsCodePackageManifest | null = parseJsoncObject(pkgRaw)
  if (!manifest) {
    throw new Error('Invalid JSON in extension/package.json')
  }

  let nls: Record<string, string> | null = null
  const nlsRaw = await readBoundedText(path.join(extensionRootDir, 'package.nls.json'))
  if (nlsRaw) {
    const parsedNls = parseJsoncObject(nlsRaw)
    if (parsedNls) {
      nls = Object.fromEntries(
        Object.entries(parsedNls).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    }
  }

  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  const publisher = typeof manifest.publisher === 'string' ? manifest.publisher.trim() : ''
  const version = typeof manifest.version === 'string' ? manifest.version.trim() : '0.0.0'
  const id = expectedId?.trim() || (publisher && name ? `${publisher}.${name}` : '')
  if (!id || !id.includes('.')) {
    throw new Error('VSIX package.json does not declare valid publisher and name')
  }

  const resolvedPublisher = publisher || id.slice(0, id.indexOf('.'))
  const resolvedName = name || id.slice(id.indexOf('.') + 1)
  const displayName = resolveNlsString(manifest.displayName, nls) || resolvedName
  const description = resolveNlsString(manifest.description, nls)
  const categories = extractStringList(manifest.categories)
  const extensionPack = extractExtensionIdList(manifest.extensionPack)
  const dependencies = extractExtensionIdList(manifest.extensionDependencies)
  const pluginKey = toOpenVsxPluginKey(id)

  const warnings: string[] = []
  const contributes = manifest.contributes ?? {}

  const { syntaxes, languageExtensionsMap } = await extractVsixSyntaxes(
    extensionRootDir,
    pluginKey,
    version,
    contributes.languages,
    contributes.grammars,
    nls,
    warnings
  )

  const snippets = await extractVsixSnippets(
    extensionRootDir,
    id,
    contributes.snippets,
    languageExtensionsMap,
    warnings
  )

  const themes = await extractVsixThemes(
    extensionRootDir,
    pluginKey,
    displayName,
    version,
    contributes.themes,
    nls,
    warnings
  )

  const iconThemes = await extractVsixIconThemes(
    extensionRootDir,
    pluginKey,
    version,
    contributes.iconThemes,
    nls,
    warnings
  )

  const iconDataUrl = await readIconDataUrl(extensionRootDir, manifest.icon)
  const readmeMarkdown = await readLocalReadme(extensionRootDir)

  const activeCapabilities: OpenVsxActiveCapability[] = []
  if (syntaxes.length > 0) {
    activeCapabilities.push('syntax')
  }
  if (snippets.length > 0) {
    activeCapabilities.push('snippets')
  }
  if (themes.length > 0) {
    activeCapabilities.push('theme')
  }
  if (iconThemes.length > 0) {
    activeCapabilities.push('icon-theme')
  }
  if (extensionPack.length > 0) {
    activeCapabilities.push('extension-pack')
  }

  const { hasMainEntrypoint, unsupportedCapabilities } = classifyUnsupportedCapabilities(
    manifest,
    description
  )

  const snippetSummaryMap = new Map<string, number>()
  for (const snippet of snippets) {
    snippetSummaryMap.set(snippet.language, (snippetSummaryMap.get(snippet.language) ?? 0) + 1)
  }

  return {
    id,
    namespace: resolvedPublisher,
    name: resolvedName,
    displayName,
    description,
    version,
    publisher: resolvedPublisher,
    iconDataUrl,
    repositoryUrl: extractRepositoryUrl(manifest.repository),
    homepageUrl:
      typeof manifest.homepage === 'string' && manifest.homepage.startsWith('https://')
        ? manifest.homepage
        : undefined,
    license: typeof manifest.license === 'string' ? manifest.license : undefined,
    categories,
    extensionPack,
    dependencies,
    runtimeSupport: {
      activeCapabilities,
      unsupportedCapabilities,
      hasMainEntrypoint,
      syntaxLanguageCount: syntaxes.length,
      snippetCount: snippets.length,
      themeCount: themes.length,
      iconThemeCount: iconThemes.length,
      extensionPackCount: extensionPack.length
    },
    contributions: {
      syntaxes: syntaxes.map((item) => ({
        id: item.metadata.id,
        label: item.metadata.label,
        extensions: item.metadata.extensions,
        filenames: item.metadata.filenames
      })),
      snippets: Array.from(snippetSummaryMap.entries()).map(([language, count]) => ({
        language,
        count
      })),
      themes: themes.map((item) => ({
        id: item.id,
        label: item.label,
        base: item.base
      })),
      iconThemes: iconThemes.map((item) => ({
        id: item.metadata.id,
        label: item.metadata.label
      }))
    },
    syntaxes,
    snippets,
    themes,
    iconThemes,
    readmeMarkdown,
    warnings
  }
}
