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
