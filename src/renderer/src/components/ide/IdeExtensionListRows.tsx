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
import { toast } from 'sonner'
import {
  toOpenVsxPluginKey,
  type OpenVsxExtensionSummary,
  type OpenVsxInstalledExtension
} from '../../../../shared/openvsx/openvsx-types'
import { cn } from '@/lib/class-names'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  applyPluginThemesNow,
  applySpecificPluginThemeById
} from '@/components/plugins/state/plugin-theme-apply'
import { useAppStore } from '@/store'
import {
  capabilityBadgeLabels,
  installedExtensionToSummary,
  summarizeOpenVsxInstallOutcome
} from './ide-extension-summary'
import { IdeExtensionIcon, formatExtensionMetricCount } from './IdeExtensionIcon'

export { installedExtensionToSummary, summarizeOpenVsxInstallOutcome }

type InstalledRowProps = {
  ext: OpenVsxInstalledExtension
  busy?: 'installing' | 'uninstalling' | 'toggling'
  onSelect: () => void
  onSetEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  onUninstall: (extensionId: string) => Promise<void>
}

export function InstalledExtensionRow({
  ext,
  busy,
  onSelect,
  onSetEnabled,
  onUninstall
}: InstalledRowProps): React.JSX.Element {
  const activeDarkTheme = useAppStore((s) => s.settings?.pluginAppThemeDark)
  const activeLightTheme = useAppStore((s) => s.settings?.pluginAppThemeLight)
  const activeIconTheme = useAppStore((s) => s.settings?.pluginIconTheme)

  const canApplyTheme =
    ext.enabled && (ext.contributions.themes.length > 0 || ext.contributions.iconThemes.length > 0)
  const isThemeActive =
    canApplyTheme &&
    (ext.contributions.themes.some((t) => t.id === activeDarkTheme || t.id === activeLightTheme) ||
      ext.contributions.iconThemes.some((it) => it.id === activeIconTheme))

  const badges = capabilityBadgeLabels(ext)
  const hasMultipleVariants = ext.contributions.themes.length > 1
  const handleApplyNow = async (): Promise<void> => {
    const applied = await applyPluginThemesNow(toOpenVsxPluginKey(ext.id))
    if (!applied) {
      toast.error(
        `Could not activate ${ext.displayName}. Restart the app if main-process updates were just applied.`
      )
    }
  }

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
          <Badge variant="referenceLabel">
            {!ext.enabled ? 'Disabled' : isThemeActive ? 'Active' : 'Installed'}
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
            {canApplyTheme && hasMultipleVariants ? (
              <DropdownMenu dir="ltr">
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs font-medium transition-colors',
                      isThemeActive
                        ? 'border border-border bg-accent text-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-accent'
                    )}
                    title="Choose theme variant"
                  >
                    {isThemeActive ? (
                      <Check className="size-2.5" />
                    ) : (
                      <Palette className="size-2.5" />
                    )}
                    <span>{isThemeActive ? 'Variant' : 'Apply'}</span>
                    <ChevronDown className="size-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="w-52">
                  <DropdownMenuLabel>Select Theme Variant</DropdownMenuLabel>
                  {ext.contributions.themes.map((variant) => {
                    const selected =
                      variant.id === activeDarkTheme || variant.id === activeLightTheme
                    return (
                      <DropdownMenuItem
                        key={variant.id}
                        onClick={() => void applySpecificPluginThemeById(variant.id)}
                      >
                        <Check className={cn('size-3.5', !selected && 'opacity-0')} />
                        <span className="truncate">{variant.label}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : canApplyTheme ? (
              <button
                type="button"
                onClick={() => void handleApplyNow()}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded px-1.5 text-3xs font-medium transition-colors',
                  isThemeActive
                    ? 'border border-border bg-accent text-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-accent'
                )}
                title={isThemeActive ? 'Re-apply appearance' : 'Apply theme / icons now'}
              >
                {isThemeActive ? <Check className="size-2.5" /> : <Palette className="size-2.5" />}
                {isThemeActive ? 'Applied' : 'Apply'}
              </button>
            ) : null}

            <DropdownMenu dir="ltr">
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
                  <DropdownMenuItem onClick={() => void handleApplyNow()}>
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
                <DropdownMenu dir="ltr">
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
