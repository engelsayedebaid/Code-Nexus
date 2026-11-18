import {
  toOpenVsxPluginKey,
  type OpenVsxExtensionSummary,
  type OpenVsxInstallOutcome,
  type OpenVsxInstalledExtension
} from '../../../../shared/openvsx/openvsx-types'

export function installedExtensionToSummary(
  ext: OpenVsxInstalledExtension
): OpenVsxExtensionSummary {
  return {
    id: ext.id,
    namespace: ext.namespace,
    name: ext.name,
    displayName: ext.displayName,
    description: ext.description,
    version: ext.version,
    publishedBy: ext.publisher,
    verified: ext.verified,
    downloadCount: ext.downloadCount ?? 0,
    averageRating: ext.averageRating,
    iconUrl: ext.iconDataUrl,
    repositoryUrl: ext.repositoryUrl,
    homepageUrl: ext.homepageUrl,
    license: ext.license,
    categories: ext.categories,
    tags: [],
    extensionPackCount: ext.extensionPack.length > 0 ? ext.extensionPack.length : undefined,
    dependenciesCount: ext.dependencies.length > 0 ? ext.dependencies.length : undefined
  }
}

export function summarizeOpenVsxInstallOutcome(outcome: OpenVsxInstallOutcome): {
  message: string
  themePluginKey?: string
} {
  const primary = outcome.primaryExtension ?? outcome.installed[0]
  if (!primary) {
    return { message: 'Extension install completed.' }
  }

  const activeCaps = new Set<string>()
  let hasUnsupportedHost = false
  let themePluginKey: string | undefined

  for (const item of outcome.installed) {
    if (item.contributions.syntaxes.length > 0) {
      activeCaps.add('syntax')
    }
    if (item.runtimeSupport.snippetCount > 0) {
      activeCaps.add('snippets')
    }
    if (item.contributions.themes.length > 0) {
      activeCaps.add('color theme')
      themePluginKey = themePluginKey ?? toOpenVsxPluginKey(item.id)
    }
    if (item.contributions.iconThemes.length > 0) {
      activeCaps.add('file icons')
      themePluginKey = themePluginKey ?? toOpenVsxPluginKey(item.id)
    }
    if (item.runtimeSupport.unsupportedCapabilities.length > 0) {
      hasUnsupportedHost = true
    }
  }

  const extraCount = Math.max(0, outcome.installed.length - 1)
  const capSummary =
    activeCaps.size > 0
      ? `Activated: ${Array.from(activeCaps).join(', ')}.`
      : 'No declarative syntax, snippets, or themes included.'
  const hostNote = hasUnsupportedHost ? ' JS runtime APIs remain inactive.' : ''
  const failNote = outcome.failed.length > 0 ? ` (${outcome.failed.length} dependency failed)` : ''

  return {
    message: `Installed ${primary.displayName}${extraCount > 0 ? ` (+${extraCount} bundled)` : ''}. ${capSummary}${hostNote}${failNote}`,
    themePluginKey
  }
}

export function capabilityBadgeLabels(ext: OpenVsxInstalledExtension): string[] {
  const labels: string[] = []
  if (ext.contributions.syntaxes.length > 0) {
    labels.push('Syntax')
  }
  if (ext.runtimeSupport.snippetCount > 0) {
    labels.push('Snippets')
  }
  if (ext.contributions.themes.length > 0) {
    labels.push('Theme')
  }
  if (ext.contributions.iconThemes.length > 0) {
    labels.push('Icons')
  }
  if (labels.length === 0 && ext.extensionPack.length > 0) {
    labels.push('Pack')
  }
  if (labels.length === 0) {
    labels.push('Host Only')
  }
  return labels
}
