import {
  BadgeCheck,
  Check,
  ChevronDown,
  CloudDownload,
  Loader2,
  MoreHorizontal,
  Palette,
  Power,
  Settings2,
  Star,
  Trash2
} from 'lucide-react'
import type {
  OpenVsxExtensionSummary,
  OpenVsxInstallOutcome,
  OpenVsxInstalledExtension
} from '../../../../shared/openvsx/openvsx-types'
import { cn } from '@/lib/class-names'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { applyPluginThemesNow } from '@/components/plugins/state/plugin-theme-apply'
import { IdeExtensionIcon, formatExtensionMetricCount } from './IdeExtensionIcon'

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
    if (item.contributions.syntaxes.length > 0) activeCaps.add('syntax')
    if (item.runtimeSupport.snippetCount > 0) activeCaps.add('snippets')
    if (item.contributions.themes.length > 0 || item.contributions.iconThemes.length > 0) {
      activeCaps.add('appearance themes')
      themePluginKey = themePluginKey ?? `openvsx:${item.id}`
    }
    if (item.runtimeSupport.unsupportedCapabilities.length > 0) {
      hasUnsupportedHost = true
    }
  }

  const extraCount = Math.max(0, outcome.installed.length - 1)
  const capSummary =
    activeCaps.size > 0
      ? `Active in Orca: ${Array.from(activeCaps).join(', ')}.`
      : 'No declarative syntax, snippets, or themes included.'
  const hostNote = hasUnsupportedHost ? ' LSP/Debugger/JS APIs remain inactive.' : ''
  const failNote = outcome.failed.length > 0 ? ` (${outcome.failed.length} dependency failed)` : ''

  return {
    message: `Installed ${primary.displayName}${extraCount > 0 ? ` (+${extraCount} bundled)` : ''}. ${capSummary}${hostNote}${failNote}`,
    themePluginKey
  }
}

function capabilityBadgeLabels(ext: OpenVsxInstalledExtension): string[] {
  const labels: string[] = []
  if (ext.contributions.syntaxes.length > 0) labels.push('Syntax')
  if (ext.runtimeSupport.snippetCount > 0) labels.push('Snippets')
  if (ext.contributions.themes.length > 0) labels.push('Theme')
  if (ext.contributions.iconThemes.length > 0) labels.push('Icons')
  if (labels.length === 0 && ext.extensionPack.length > 0) labels.push('Pack')
  if (labels.length === 0) labels.push('Host Only')
  return labels
}

type InstalledRowProps = {
  ext: OpenVsxInstalledExtension
  busy?: 'installing' | 'uninstalling' | 'toggling'
  onSelect: () => void
  onSetEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  onUninstall: (extensionId: string) => Promise<void>
  onStatusMessage: (message: string) => void
}

export function InstalledExtensionRow({
  ext,
  busy,
  onSelect,
  onSetEnabled,
  onUninstall,
  onStatusMessage
}: InstalledRowProps): React.JSX.Element {
  const canApplyTheme =
    ext.enabled &&
    (ext.contributions.themes.length > 0 || ext.contributions.iconThemes.length > 0)
  const badges = capabilityBadgeLabels(ext)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none',
        !ext.enabled && 'opacity-65'
      )}
    >
      <IdeExtensionIcon
        src={ext.iconDataUrl}
        name={ext.displayName}
        packCount={ext.extensionPack.length}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{ext.displayName}</span>
          <Badge variant="referenceLabel" className="shrink-0">
            {ext.enabled ? 'Installed' : 'Disabled'}
          </Badge>
        </div>

        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
          {ext.description || ext.id}
        </p>

        <div className="mt-1 flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="inline-flex min-w-0 items-center gap-0.5 truncate text-3xs text-muted-foreground">
              <span className="truncate">{ext.publisher}</span>
              {ext.verified && <BadgeCheck className="size-2.5 shrink-0 text-foreground" />}
            </span>
            {badges.slice(0, 2).map((label) => (
              <span
                key={label}
                className="rounded border border-border/70 bg-muted/70 px-1 py-0 text-3xs leading-4 text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>

          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {canApplyTheme && (
              <button
                type="button"
                onClick={() => {
                  void applyPluginThemesNow(`openvsx:${ext.id}`).then((applied) => {
                    if (applied) {
                      onStatusMessage(`Applied appearance from ${ext.displayName}.`)
                    }
                  })
                }}
                className="inline-flex h-5 items-center gap-1 rounded bg-secondary px-1.5 text-3xs font-medium text-secondary-foreground hover:bg-accent"
                title="Apply theme / icons now"
              >
                <Palette className="size-2.5" />
                Apply
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="inline-flex h-5 items-center gap-1 rounded border border-border bg-background px-1.5 text-3xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  title="Manage extension"
                >
                  {busy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Settings2 className="size-3" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom" className="w-44">
                <DropdownMenuItem onClick={() => void onSetEnabled(ext.id, !ext.enabled)}>
                  <Power className="size-3.5" />
                  <span>{ext.enabled ? 'Disable' : 'Enable'}</span>
                </DropdownMenuItem>
                {canApplyTheme && (
                  <DropdownMenuItem onClick={() => void applyPluginThemesNow(`openvsx:${ext.id}`)}>
                    <Palette className="size-3.5" />
                    <span>Apply Theme / Icons</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void onUninstall(ext.id)}>
                  <Trash2 className="size-3.5" />
                  <span>Uninstall</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

type MarketplaceRowProps = {
  item: OpenVsxExtensionSummary
  busy?: 'installing' | 'uninstalling' | 'toggling'
  onSelect: () => void
  onInstall: (extensionId: string, version?: string, includePackAndDependencies?: boolean) => void
}

export function MarketplaceExtensionRow({
  item,
  busy,
  onSelect,
  onInstall
}: MarketplaceRowProps): React.JSX.Element {
  const hasPack = (item.extensionPackCount ?? 0) > 0 || (item.dependenciesCount ?? 0) > 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="group flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
    >
      <IdeExtensionIcon
        src={item.iconUrl}
        name={item.displayName}
        packCount={item.extensionPackCount}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{item.displayName}</span>
          <div className="flex shrink-0 items-center gap-1.5 text-3xs text-muted-foreground">
            {item.downloadCount > 0 && (
              <span className="inline-flex items-center gap-0.5 tabular-nums">
                <CloudDownload className="size-3" />
                {formatExtensionMetricCount(item.downloadCount)}
              </span>
            )}
            {typeof item.averageRating === 'number' && item.averageRating > 0 && (
              <span className="inline-flex items-center gap-0.5 tabular-nums">
                <Star className="size-2.5 fill-current text-foreground/80" />
                {Number.isInteger(item.averageRating)
                  ? item.averageRating
                  : item.averageRating.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        <p className="mt-0.5 truncate text-2xs text-muted-foreground">
          {item.description || item.id}
        </p>

        <div className="mt-1 flex items-center justify-between gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-0.5 truncate text-2xs text-muted-foreground">
            <span className="truncate">{item.publishedBy}</span>
            {item.verified && <BadgeCheck className="size-3 shrink-0 text-foreground" />}
          </span>

          <div
            className="flex shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {hasPack ? (
              <div className="inline-flex items-center overflow-hidden rounded bg-primary text-primary-foreground">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => onInstall(item.id, item.version, true)}
                  className="inline-flex h-5 cursor-pointer items-center gap-1 px-2 text-3xs font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === 'installing' && <Loader2 className="size-2.5 animate-spin" />}
                  {busy === 'installing' ? 'Installing' : 'Install'}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      aria-label="Install options"
                      className="inline-flex h-5 cursor-pointer items-center border-l border-primary-foreground/20 px-1 hover:bg-primary/90 disabled:opacity-50"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom" className="w-48">
                    <DropdownMenuItem onClick={() => onInstall(item.id, item.version, true)}>
                      <Check className="size-3.5" />
                      <span>Install with Pack &amp; Deps</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onInstall(item.id, item.version, false)}>
                      <MoreHorizontal className="size-3.5" />
                      <span>Install Extension Only</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => onInstall(item.id, item.version, true)}
                className="inline-flex h-5 cursor-pointer items-center gap-1 rounded bg-primary px-2 text-3xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === 'installing' && <Loader2 className="size-2.5 animate-spin" />}
                {busy === 'installing' ? 'Installing' : 'Install'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
