import type {
  OpenVsxExtensionDetails,
  OpenVsxInstallOptions,
  OpenVsxInstallOutcome,
  OpenVsxInstalledExtension,
  OpenVsxSearchOptions,
  OpenVsxSearchResult,
  OpenVsxSnippetItem
} from '../../shared/openvsx/openvsx-types'

export type OpenVsxApi = {
  search: (options: OpenVsxSearchOptions) => Promise<OpenVsxSearchResult>
  getDetails: (extensionId: string, version?: string) => Promise<OpenVsxExtensionDetails>
  listInstalled: () => Promise<OpenVsxInstalledExtension[]>
  install: (options: OpenVsxInstallOptions) => Promise<OpenVsxInstallOutcome>
  uninstall: (extensionId: string) => Promise<boolean>
  setEnabled: (extensionId: string, enabled: boolean) => Promise<OpenVsxInstalledExtension | null>
  listSnippets: () => Promise<OpenVsxSnippetItem[]>
  onChanged: (callback: () => void) => () => void
}
