import { Filter, X } from 'lucide-react'
import type { OpenVsxSearchSortBy } from '../../../../shared/openvsx/openvsx-types'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { openPluginsSettings } from '@/components/settings/navigation/open-plugins-settings'

export type ExtensionsFilterMode = 'all' | 'installed' | 'marketplace' | 'themes' | 'languages'

type IdeExtensionsFilterControlsProps = {
  query: string
  onQueryChange: (value: string) => void
  onSubmitSearch: () => void
  filterMode: ExtensionsFilterMode
  onFilterModeChange: (mode: ExtensionsFilterMode) => void
  sortBy: OpenVsxSearchSortBy
  onSortByChange: (sortBy: OpenVsxSearchSortBy) => void
  installedCount: number
}

export function IdeExtensionsFilterControls({
  query,
  onQueryChange,
  onSubmitSearch,
  filterMode,
  onFilterModeChange,
  sortBy,
  onSortByChange,
  installedCount
}: IdeExtensionsFilterControlsProps): React.JSX.Element {
  const t = useTranslate()

  return (
    <div className="shrink-0 space-y-2 border-b border-border/70 px-2.5 py-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSubmitSearch()
              }
            }}
            placeholder={t('ide.openVsx.searchPlaceholder', 'Search Extensions in Marketplace')}
            className="h-7 pr-7 pl-2 text-xs"
            aria-label="Search Extensions in Marketplace"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Filter Extensions"
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                filterMode !== 'all' && 'border-foreground/40 bg-accent text-foreground'
              )}
            >
              <Filter className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="w-52">
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={filterMode}
              onValueChange={(value) => onFilterModeChange(value as ExtensionsFilterMode)}
            >
              <DropdownMenuRadioItem value="all">All Extensions</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="installed">
                Installed ({installedCount})
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="marketplace">Marketplace Only</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="languages">
                Languages &amp; Snippets
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="themes">Themes &amp; Icons</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort Marketplace By</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(value) => onSortByChange(value as OpenVsxSearchSortBy)}
            >
              <DropdownMenuRadioItem value="relevance">Relevance</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="downloadCount">Most Downloaded</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="rating">Top Rated</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="timestamp">Recently Updated</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-2xs leading-relaxed text-muted-foreground">
        {t('ide.openVsx.noticePrefix', 'By default, Orca IDE uses')}{' '}
        <button
          type="button"
          onClick={() => window.api.shell.openUrl('https://open-vsx.org')}
          className="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:opacity-80"
        >
          Open VSX
        </button>{' '}
        {t('ide.openVsx.noticeMiddle', 'as a marketplace. Native plugins can be managed in')}{' '}
        <button
          type="button"
          onClick={openPluginsSettings}
          className="cursor-pointer font-medium text-foreground underline underline-offset-2 hover:opacity-80"
        >
          {t('ide.openVsx.pluginsSettingsLink', 'Plugins settings')}
        </button>
        .
      </p>
    </div>
  )
}
