import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  CloudDownload,
  ExternalLink,
  Loader2,
  Palette,
  Power,
  Star,
  Trash2
} from 'lucide-react'
import type {
  OpenVsxExtensionDetails,
  OpenVsxExtensionSummary,
  OpenVsxInstalledExtension
} from '../../../../shared/openvsx/openvsx-types'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { applyPluginThemesNow } from '@/components/plugins/state/plugin-theme-apply'
import { IdeExtensionCompatibilityCard } from './IdeExtensionCompatibilityCard'
import { IdeExtensionIcon, formatExtensionMetricCount } from './IdeExtensionIcon'

type IdeExtensionDetailViewProps = {
  summary: OpenVsxExtensionSummary
  installedRecord?: OpenVsxInstalledExtension
  busyState?: 'installing' | 'uninstalling' | 'toggling'
  onBack: () => void
  onInstall: (extensionId: string, version?: string) => Promise<void>
  onUninstall: (extensionId: string) => Promise<void>
  onSetEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  onSelectExtensionById: (extensionId: string) => void
  onStatusBanner: (message: string) => void
}

export function IdeExtensionDetailView({
  summary,
  installedRecord,
  busyState,
  onBack,
  onInstall,
  onUninstall,
  onSetEnabled,
  onSelectExtensionById,
  onStatusBanner
}: IdeExtensionDetailViewProps): React.JSX.Element {
  const t = useTranslate()
  const [details, setDetails] = useState<OpenVsxExtensionDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [applyingTheme, setApplyingTheme] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingDetails(true)
    const api = window.api?.openVsx
    if (!api) {
      setLoadingDetails(false)
      return
    }
    void api
      .getDetails(summary.id)
      .then((fetched) => {
        if (!cancelled) {
          setDetails(fetched)
        }
      })
      .catch(() => {
        // Fallback smoothly to summary + installed record metadata
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetails(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [summary.id])

  const displayName = installedRecord?.displayName ?? details?.displayName ?? summary.displayName
  const description = installedRecord?.description ?? details?.description ?? summary.description
  const version = installedRecord?.version ?? details?.version ?? summary.version
  const publisher = installedRecord?.publisher ?? details?.publishedBy ?? summary.publishedBy
  const verified = installedRecord?.verified ?? details?.verified ?? summary.verified
  const downloadCount = details?.downloadCount ?? summary.downloadCount ?? installedRecord?.downloadCount
  const averageRating = details?.averageRating ?? summary.averageRating ?? installedRecord?.averageRating
  const iconSrc = installedRecord?.iconDataUrl ?? details?.iconUrl ?? summary.iconUrl
  const extensionPack = installedRecord?.extensionPack ?? details?.extensionPack ?? []
  const dependencies = installedRecord?.dependencies ?? details?.dependencies ?? []
  const readmeMarkdown = details?.readmeMarkdown ?? installedRecord?.readmeMarkdown
  const repositoryUrl = installedRecord?.repositoryUrl ?? details?.repositoryUrl ?? summary.repositoryUrl
  const homepageUrl = installedRecord?.homepageUrl ?? details?.homepageUrl ?? summary.homepageUrl
  const runtimeSupport = installedRecord?.runtimeSupport ?? details?.runtimeSupportHint

  const hasThemes = Boolean(
    installedRecord &&
      installedRecord.enabled &&
      (installedRecord.contributions.themes.length > 0 ||
        installedRecord.contributions.iconThemes.length > 0)
  )

  const handleApplyThemes = async (): Promise<void> => {
    if (!installedRecord) {
      return
    }
    setApplyingTheme(true)
    try {
      const applied = await applyPluginThemesNow(`openvsx:${installedRecord.id}`)
      onStatusBanner(
        applied
          ? t('ide.openVsx.themeApplied', `Applied appearance from ${displayName}.`)
          : t('ide.openVsx.themeApplyEmpty', 'No color or icon theme could be applied.')
      )
    } finally {
      setApplyingTheme(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('common.back', 'Back')}
        </button>
        <span className="truncate font-mono text-3xs text-muted-foreground">{summary.id}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-sleek">
        <div className="flex items-start gap-2.5">
          <IdeExtensionIcon
            src={iconSrc}
            name={displayName}
            packCount={extensionPack.length || summary.extensionPackCount}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-foreground">{displayName}</h3>
              {verified && (
                <BadgeCheck
                  className="size-3.5 shrink-0 text-foreground"
                  aria-label="Verified publisher"
                />
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
              <span className="truncate">{publisher}</span>
              <span>v{version}</span>
              {typeof downloadCount === 'number' && downloadCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <CloudDownload className="size-3" />
                  {formatExtensionMetricCount(downloadCount)}
                </span>
              )}
              {typeof averageRating === 'number' && averageRating > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="size-3 fill-current" />
                  {averageRating.toFixed(1)}
                </span>
              )}
            </div>
            {description && (
              <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {!installedRecord ? (
            <Button
              size="xs"
              disabled={Boolean(busyState)}
              onClick={() => void onInstall(summary.id, summary.version)}
            >
              {busyState === 'installing' ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {t('ide.openVsx.installing', 'Installing...')}
                </>
              ) : (
                t('ide.openVsx.install', 'Install')
              )}
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                variant={installedRecord.enabled ? 'outline' : 'default'}
                disabled={Boolean(busyState)}
                onClick={() => void onSetEnabled(installedRecord.id, !installedRecord.enabled)}
              >
                {busyState === 'toggling' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Power className="size-3" />
                )}
                {installedRecord.enabled
                  ? t('ide.openVsx.disable', 'Disable')
                  : t('ide.openVsx.enable', 'Enable')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={Boolean(busyState)}
                onClick={() => void onUninstall(installedRecord.id)}
              >
                {busyState === 'uninstalling' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                {t('ide.openVsx.uninstall', 'Uninstall')}
              </Button>
              {hasThemes && (
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={applyingTheme}
                  onClick={() => void handleApplyThemes()}
                >
                  {applyingTheme ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Palette className="size-3" />
                  )}
                  {t('ide.openVsx.applyTheme', 'Apply Theme')}
                </Button>
              )}
            </>
          )}

          {(homepageUrl || repositoryUrl) && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => window.api.shell.openUrl((homepageUrl ?? repositoryUrl)!)}
            >
              <ExternalLink className="size-3" />
              {t('ide.openVsx.openWebsite', 'Links')}
            </Button>
          )}
        </div>

        {runtimeSupport && (
          <IdeExtensionCompatibilityCard
            runtimeSupport={runtimeSupport}
            installedRecord={installedRecord}
            extensionPack={extensionPack}
            dependencies={dependencies}
            onSelectExtensionById={onSelectExtensionById}
          />
        )}

        <div className="mt-3 border-t border-border/70 pt-3">
          {loadingDetails && !readmeMarkdown ? (
            <div className="flex items-center gap-2 py-4 text-2xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span>{t('ide.openVsx.loadingReadme', 'Loading extension details...')}</span>
            </div>
          ) : readmeMarkdown ? (
            <CommentMarkdown
              content={readmeMarkdown}
              variant="compact"
              className="text-2xs leading-relaxed text-muted-foreground [&_h1]:text-xs [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-2xs [&_h3]:font-semibold [&_h3]:text-foreground"
            />
          ) : (
            <p className="text-2xs text-muted-foreground">
              {t('ide.openVsx.noReadme', 'No README available for this extension.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
