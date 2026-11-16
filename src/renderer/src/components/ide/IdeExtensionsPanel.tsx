import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Palette, X } from 'lucide-react'
import type {
  OpenVsxExtensionSummary,
  OpenVsxInstalledExtension,
  OpenVsxSearchSortBy
} from '../../../../shared/openvsx/openvsx-types'
import { useTranslate } from '@/i18n/use-translate'
import { applyPluginThemesNow } from '@/components/plugins/state/plugin-theme-apply'
import { useOpenVsxStore } from '@/store/plugins/openvsx/use-openvsx-store'
import { IdeExtensionDetailView } from './IdeExtensionDetailView'
import { formatExtensionMetricCount } from './IdeExtensionIcon'
import {
  InstalledExtensionRow,
  MarketplaceExtensionRow,
  installedExtensionToSummary,
  summarizeOpenVsxInstallOutcome
} from './IdeExtensionListRows'
import {
  IdeExtensionsFilterControls,
  type ExtensionsFilterMode
} from './IdeExtensionsFilterControls'

export type { ExtensionsFilterMode }

type IdeExtensionsPanelProps = {
  filterMode: ExtensionsFilterMode
  onFilterModeChange: (mode: ExtensionsFilterMode) => void
  refreshToken: number
}

export function IdeExtensionsPanel({
  filterMode,
  onFilterModeChange,
  refreshToken
}: IdeExtensionsPanelProps): React.JSX.Element {
  const t = useTranslate()

  const installed = useOpenVsxStore((s) => s.installed)
  const loadingInstalled = useOpenVsxStore((s) => s.loadingInstalled)
  const busyById = useOpenVsxStore((s) => s.busyById)
  const storeError = useOpenVsxStore((s) => s.error)
  const loadInstalled = useOpenVsxStore((s) => s.loadInstalled)
  const installExtension = useOpenVsxStore((s) => s.installExtension)
  const uninstallExtension = useOpenVsxStore((s) => s.uninstallExtension)
  const setExtensionEnabled = useOpenVsxStore((s) => s.setExtensionEnabled)
  const clearStoreError = useOpenVsxStore((s) => s.clearError)

  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<OpenVsxSearchSortBy>('relevance')
  const [searchResults, setSearchResults] = useState<OpenVsxExtensionSummary[]>([])
  const [totalSize, setTotalSize] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [installedExpanded, setInstalledExpanded] = useState(true)
  const [marketplaceExpanded, setMarketplaceExpanded] = useState(true)
  const [selectedExtension, setSelectedExtension] = useState<OpenVsxExtensionSummary | null>(null)
  const [statusBanner, setStatusBanner] = useState<{
    message: string
    themePluginKey?: string
  } | null>(null)

  const searchSequenceRef = useRef(0)

  const installedMap = useMemo(() => {
    const map = new Map<string, OpenVsxInstalledExtension>()
    for (const item of installed) {
      map.set(item.id.toLowerCase(), item)
    }
    return map
  }, [installed])

  const executeSearch = useCallback(
    async (nextQuery: string, mode: ExtensionsFilterMode, sort: OpenVsxSearchSortBy) => {
      const api = window.api?.openVsx
      if (!api) {
        return
      }
      if (mode === 'installed') {
        setSearchResults([])
        setSearchError(null)
        setSearching(false)
        return
      }

      const seq = ++searchSequenceRef.current
      setSearching(true)
      setSearchError(null)

      const category =
        mode === 'themes'
          ? 'Themes'
          : mode === 'languages'
            ? 'Programming Languages'
            : undefined
      const effectiveSort =
        nextQuery.trim().length === 0 && sort === 'relevance' ? 'downloadCount' : sort

      try {
        const result = await api.search({
          query: nextQuery,
          category,
          sortBy: effectiveSort,
          size: 35,
          offset: 0
        })
        if (seq === searchSequenceRef.current) {
          setSearchResults(result.extensions)
          setTotalSize(result.totalSize)
        }
      } catch (error) {
        if (seq === searchSequenceRef.current) {
          setSearchError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (seq === searchSequenceRef.current) {
          setSearching(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadInstalled()
  }, [loadInstalled])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void executeSearch(query, filterMode, sortBy)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, filterMode, sortBy, refreshToken, executeSearch])

  const handleInstall = async (
    extensionId: string,
    version?: string,
    includePackAndDependencies = true
  ): Promise<void> => {
    const outcome = await installExtension({
      extensionId,
      version,
      includePackAndDependencies
    })
    if (outcome) {
      setStatusBanner(summarizeOpenVsxInstallOutcome(outcome))
    }
  }

  const handleUninstall = async (extensionId: string): Promise<void> => {
    const removed = await uninstallExtension(extensionId)
    if (removed) {
      setStatusBanner({ message: `Uninstalled ${extensionId}.` })
    }
  }

  const handleSelectExtensionById = (extensionId: string): void => {
    const lower = extensionId.toLowerCase()
    const installedMatch = installedMap.get(lower)
    if (installedMatch) {
      setSelectedExtension(installedExtensionToSummary(installedMatch))
      return
    }
    const marketplaceMatch = searchResults.find((item) => item.id.toLowerCase() === lower)
    if (marketplaceMatch) {
      setSelectedExtension(marketplaceMatch)
      return
    }
    const dotIdx = extensionId.indexOf('.')
    const ns = dotIdx > 0 ? extensionId.slice(0, dotIdx) : ''
    const extName = dotIdx > 0 ? extensionId.slice(dotIdx + 1) : extensionId
    setSelectedExtension({
      id: extensionId,
      namespace: ns,
      name: extName,
      displayName: extName,
      description: '',
      version: '',
      publishedBy: ns,
      verified: false,
      downloadCount: 0,
      categories: [],
      tags: []
    })
  }

  const filteredInstalled = useMemo(() => {
    const q = query.trim().toLowerCase()
    return installed.filter((ext) => {
      if (
        filterMode === 'themes' &&
        ext.contributions.themes.length === 0 &&
        ext.contributions.iconThemes.length === 0
      ) {
        return false
      }
      if (
        filterMode === 'languages' &&
        ext.contributions.syntaxes.length === 0 &&
        ext.runtimeSupport.snippetCount === 0
      ) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        ext.displayName.toLowerCase().includes(q) ||
        ext.id.toLowerCase().includes(q) ||
        ext.description.toLowerCase().includes(q) ||
        ext.publisher.toLowerCase().includes(q)
      )
    })
  }, [installed, query, filterMode])

  const marketplaceVisible = useMemo(() => {
    if (filterMode === 'installed') {
      return []
    }
    return searchResults.filter((item) => !installedMap.has(item.id.toLowerCase()))
  }, [searchResults, filterMode, installedMap])

  if (selectedExtension) {
    const installedRecord = installedMap.get(selectedExtension.id.toLowerCase())
    const busy = busyById[selectedExtension.id.toLowerCase()]
    return (
      <IdeExtensionDetailView
        summary={selectedExtension}
        installedRecord={installedRecord}
        busyState={busy}
        onBack={() => setSelectedExtension(null)}
        onInstall={(id, version) => handleInstall(id, version, true)}
        onUninstall={handleUninstall}
        onSetEnabled={setExtensionEnabled}
        onSelectExtensionById={handleSelectExtensionById}
        onStatusBanner={(message) => setStatusBanner({ message })}
      />
    )
  }

  const showInstalledSection = filterMode !== 'marketplace' && filteredInstalled.length > 0
  const showMarketplaceSection = filterMode !== 'installed'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <IdeExtensionsFilterControls
        query={query}
        onQueryChange={setQuery}
        onSubmitSearch={() => void executeSearch(query, filterMode, sortBy)}
        filterMode={filterMode}
        onFilterModeChange={onFilterModeChange}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        installedCount={installed.length}
      />

      {(statusBanner || storeError || searchError) && (
        <div className="shrink-0 space-y-1 border-b border-border/70 bg-muted/40 px-2.5 py-1.5 text-2xs">
          {(storeError || searchError) && (
            <div className="flex items-start justify-between gap-2 text-destructive">
              <span className="min-w-0 break-words">{storeError ?? searchError}</span>
              <button
                type="button"
                onClick={() => {
                  clearStoreError()
                  setSearchError(null)
                }}
                className="shrink-0 rounded p-0.5 hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          {statusBanner && (
            <div className="flex items-start justify-between gap-2 text-foreground">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="leading-snug">{statusBanner.message}</p>
                {statusBanner.themePluginKey && (
                  <button
                    type="button"
                    onClick={() => {
                      const key = statusBanner.themePluginKey!
                      void applyPluginThemesNow(key).then((applied) => {
                        setStatusBanner({
                          message: applied
                            ? 'Theme applied.'
                            : 'Theme was not found in active theme registry.'
                        })
                      })
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-3xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Palette className="size-2.5" />
                    Apply Theme Now
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {showInstalledSection && (
          <div className="border-b border-border/50">
            <button
              type="button"
              onClick={() => setInstalledExpanded((v) => !v)}
              className="flex h-7 w-full cursor-pointer items-center justify-between px-2 text-left text-3xs font-semibold tracking-wider text-muted-foreground uppercase hover:bg-accent/50"
            >
              <span className="inline-flex items-center gap-1">
                {installedExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {t('ide.openVsx.installedHeading', 'Installed')}
              </span>
              <span className="rounded bg-muted px-1.5 py-0 text-3xs font-medium text-foreground">
                {filteredInstalled.length}
              </span>
            </button>
            {installedExpanded && (
              <div className="divide-y divide-border/30">
                {filteredInstalled.map((ext) => (
                  <InstalledExtensionRow
                    key={ext.id}
                    ext={ext}
                    busy={busyById[ext.id.toLowerCase()]}
                    onSelect={() => setSelectedExtension(installedExtensionToSummary(ext))}
                    onSetEnabled={setExtensionEnabled}
                    onUninstall={handleUninstall}
                    onStatusMessage={(message) => setStatusBanner({ message })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {filterMode === 'installed' && filteredInstalled.length === 0 && !loadingInstalled && (
          <div className="px-3 py-6 text-center text-2xs text-muted-foreground">
            {t('ide.openVsx.noInstalledMatches', 'No installed Open VSX extensions match.')}
          </div>
        )}

        {showMarketplaceSection && (
          <div>
            <button
              type="button"
              onClick={() => setMarketplaceExpanded((v) => !v)}
              className="flex h-7 w-full cursor-pointer items-center justify-between px-2 text-left text-3xs font-semibold tracking-wider text-muted-foreground uppercase hover:bg-accent/50"
            >
              <span className="inline-flex items-center gap-1">
                {marketplaceExpanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {t('ide.openVsx.marketplaceHeading', 'Marketplace')}
              </span>
              <span className="inline-flex items-center gap-1">
                {searching && <Loader2 className="size-3 animate-spin" />}
                {totalSize > 0 && !searching && (
                  <span className="text-3xs font-normal text-muted-foreground tabular-nums">
                    {formatExtensionMetricCount(totalSize)}
                  </span>
                )}
              </span>
            </button>

            {marketplaceExpanded && (
              <>
                {searching && marketplaceVisible.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-2xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span>{t('ide.openVsx.searching', 'Searching Open VSX...')}</span>
                  </div>
                ) : marketplaceVisible.length === 0 ? (
                  <div className="px-3 py-6 text-center text-2xs text-muted-foreground">
                    {searchError
                      ? t('ide.openVsx.searchFailed', 'Could not reach Open VSX registry.')
                      : t('ide.openVsx.noResults', 'No extensions found.')}
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {marketplaceVisible.map((item) => (
                      <MarketplaceExtensionRow
                        key={item.id}
                        item={item}
                        busy={busyById[item.id.toLowerCase()]}
                        onSelect={() => setSelectedExtension(item)}
                        onInstall={(id, version, includePack) =>
                          void handleInstall(id, version, includePack)
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
