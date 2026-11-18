export type OpenVsxActiveCapability =
  | 'syntax'
  | 'snippets'
  | 'theme'
  | 'icon-theme'
  | 'extension-pack'

export type OpenVsxUnsupportedCapability =
  | 'js-runtime'
  | 'lsp'
  | 'debugger'
  | 'views'
  | 'commands'
  | 'keybindings'
  | 'menus'
  | 'webviews'

export type OpenVsxRuntimeSupport = {
  activeCapabilities: OpenVsxActiveCapability[]
  unsupportedCapabilities: OpenVsxUnsupportedCapability[]
  hasMainEntrypoint: boolean
  syntaxLanguageCount: number
  snippetCount: number
  themeCount: number
  iconThemeCount: number
  extensionPackCount: number
}

export type OpenVsxSearchSortBy = 'relevance' | 'downloadCount' | 'rating' | 'timestamp'

export type OpenVsxSearchOptions = {
  query: string
  category?: string
  sortBy?: OpenVsxSearchSortBy
  size?: number
  offset?: number
}

export type OpenVsxExtensionSummary = {
  id: string
  namespace: string
  name: string
  displayName: string
  description: string
  version: string
  publishedBy: string
  verified: boolean
  downloadCount: number
  averageRating?: number
  reviewCount?: number
  timestamp?: string
  iconUrl?: string
  downloadUrl?: string
  readmeUrl?: string
  repositoryUrl?: string
  homepageUrl?: string
  license?: string
  categories: string[]
  tags: string[]
  extensionPackCount?: number
  dependenciesCount?: number
  preRelease?: boolean
}

export type OpenVsxSearchResult = {
  extensions: OpenVsxExtensionSummary[]
  totalSize: number
  offset: number
}

export type OpenVsxExtensionDetails = OpenVsxExtensionSummary & {
  readmeMarkdown?: string
  extensionPack: string[]
  dependencies: string[]
  runtimeSupportHint?: OpenVsxRuntimeSupport
}

export type OpenVsxInstalledContributionSummary = {
  syntaxes: {
    id: string
    label: string
    extensions: string[]
    filenames: string[]
  }[]
  snippets: {
    language: string
    count: number
  }[]
  themes: {
    id: string
    label: string
    base: 'light' | 'dark'
  }[]
  iconThemes: {
    id: string
    label: string
  }[]
}

export type OpenVsxInstalledExtension = {
  id: string
  namespace: string
  name: string
  displayName: string
  description: string
  version: string
  publisher: string
  verified: boolean
  enabled: boolean
  installedAt: string
  downloadCount?: number
  averageRating?: number
  iconDataUrl?: string
  repositoryUrl?: string
  homepageUrl?: string
  license?: string
  categories: string[]
  extensionPack: string[]
  dependencies: string[]
  installedDirectly: boolean
  runtimeSupport: OpenVsxRuntimeSupport
  contributions: OpenVsxInstalledContributionSummary
  readmeMarkdown?: string
  warnings: string[]
}

export type OpenVsxSnippetItem = {
  extensionId: string
  language: string
  extensions: string[]
  filenames: string[]
  name: string
  prefixes: string[]
  body: string
  description: string
}

export type OpenVsxInstallOptions = {
  extensionId: string
  version?: string
  includePackAndDependencies?: boolean
}

export type OpenVsxInstallOutcome = {
  installed: OpenVsxInstalledExtension[]
  failed: { id: string; error: string }[]
  skipped: string[]
  primaryExtension?: OpenVsxInstalledExtension
}

function toSafePluginIdSegment(raw: string, fallback: string, maxLength = 64): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

/** Canonical Orca pluginKey (`ovsx-<publisher>.<name>`) valid for all theme/icon/syntax settings schemas. */
export function toOpenVsxPluginKey(extensionId: string): string {
  const trimmed = extensionId.trim()
  const dotIndex = trimmed.indexOf('.')
  const rawNamespace = dotIndex > 0 ? trimmed.slice(0, dotIndex) : 'ext'
  const rawName = dotIndex > 0 ? trimmed.slice(dotIndex + 1) : trimmed
  const publisherSlug = toSafePluginIdSegment(`ovsx-${rawNamespace}`, 'ovsx-ext', 64)
  const nameSlug = toSafePluginIdSegment(rawName, 'extension', 64)
  return `${publisherSlug}.${nameSlug}`
}

/** Formats IPC/network errors from Open VSX into clean user-facing English messages. */
export function formatOpenVsxErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const stripped = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:TypeError|Error):\s*/i, '')
    .trim()
  if (
    !stripped ||
    /^fetch failed$/i.test(stripped) ||
    /failed to fetch|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(
      stripped
    )
  ) {
    return 'Unable to reach Open VSX marketplace. Check your internet connection and click Refresh.'
  }
  return stripped
}
