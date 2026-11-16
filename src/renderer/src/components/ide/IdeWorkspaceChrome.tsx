import { Suspense, useState } from 'react'
import {
  Blocks,
  Files,
  GitBranch,
  MoreHorizontal,
  RotateCw,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { RightSidebarPanelContent } from '@/components/right-sidebar/right-sidebar-panel-content'
import { openPluginsSettings } from '@/components/settings/navigation/open-plugins-settings'
import type { ExtensionsFilterMode } from './IdeExtensionsPanel'

const FileExplorer = lazy(
  () => import('@/components/right-sidebar/file-explorer/panel/FileExplorer')
)
const IdeExtensionsPanel = lazy(() =>
  import('./IdeExtensionsPanel').then((mod) => ({ default: mod.IdeExtensionsPanel }))
)

type DevelopmentView = 'files' | 'search' | 'source-control' | 'extensions'

function ActivityButton({
  active,
  label,
  onClick,
  children
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex size-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground',
            active && 'text-foreground'
          )}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          {active ? (
            <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-foreground" />
          ) : null}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function IdeDevelopmentSidebar(): React.JSX.Element {
  const t = useTranslate()
  const [view, setView] = useState<DevelopmentView>('files')
  const [extensionsMenuOpen, setExtensionsMenuOpen] = useState(false)
  const [extensionsFilterMode, setExtensionsFilterMode] = useState<ExtensionsFilterMode>('all')
  const [extensionsRefreshToken, setExtensionsRefreshToken] = useState(0)
  const width = useAppStore((state) => state.sidebarWidth)
  const setWidth = useAppStore((state) => state.setSidebarWidth)
  const setExplorerView = useAppStore((state) => state.setRightSidebarExplorerView)
  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width,
    minWidth: 220,
    maxWidth: 500,
    deltaSign: 1,
    setWidth
  })
  const selectView = (next: DevelopmentView): void => {
    setView(next)
    if (next === 'files' || next === 'search') {
      setExplorerView(next)
    }
  }
  const title =
    view === 'extensions'
      ? t('ide.extensionsMarketplace', 'Extensions: Marketplace')
      : view === 'source-control'
        ? t('ide.sourceControl', 'Source Control')
        : view === 'search'
          ? t('ide.search', 'Search')
          : t('ide.explorer', 'Explorer')

  return (
    <aside
      ref={containerRef}
      className="relative flex min-h-0 shrink-0 border-r border-border bg-background"
      aria-label={t('ide.developmentTools', 'Development tools')}
    >
      <nav className="flex w-10 shrink-0 flex-col border-r border-border/70 bg-card/40 pt-1">
        <ActivityButton
          active={view === 'files'}
          label={t('ide.explorer', 'Explorer')}
          onClick={() => selectView('files')}
        >
          <Files className="size-4" />
        </ActivityButton>
        <ActivityButton
          active={view === 'search'}
          label={t('ide.search', 'Search')}
          onClick={() => selectView('search')}
        >
          <Search className="size-4" />
        </ActivityButton>
        <ActivityButton
          active={view === 'source-control'}
          label={t('ide.sourceControl', 'Source Control')}
          onClick={() => selectView('source-control')}
        >
          <GitBranch className="size-4" />
        </ActivityButton>
        <DropdownMenu open={extensionsMenuOpen} onOpenChange={setExtensionsMenuOpen}>
          <div className="relative flex items-center justify-center">
            <DropdownMenuTrigger asChild>
              <span aria-hidden className="pointer-events-none absolute inset-0" />
            </DropdownMenuTrigger>
            <ActivityButton
              active={view === 'extensions' || extensionsMenuOpen}
              label={t('ide.extensions', 'Extensions')}
              onClick={() => setExtensionsMenuOpen((open) => !open)}
            >
              <Blocks className="size-4" />
            </ActivityButton>
          </div>
          <DropdownMenuContent side="right" align="end" className="w-60">
            <DropdownMenuLabel>
              {t('ide.extensionsChooseMode', 'Extensions View')}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => selectView('extensions')}>
              <Blocks className="size-3.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">
                  {t('ide.extensionsOpenPanel', 'Extensions Panel (Open VSX)')}
                </div>
                <div className="text-3xs text-muted-foreground">
                  {t('ide.extensionsOpenPanelDesc', 'Browse and install marketplace .vsix')}
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openPluginsSettings}>
              <SlidersHorizontal className="size-3.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">
                  {t('ide.extensionsCurrentSettings', 'Plugins Settings (Current Mode)')}
                </div>
                <div className="text-3xs text-muted-foreground">
                  {t('ide.extensionsCurrentSettingsDesc', 'Manage Orca plugins and permissions')}
                </div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/70 px-3">
          <span className="truncate text-2xs font-semibold uppercase tracking-wider text-foreground">
            {title}
          </span>
          {view === 'extensions' && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setExtensionsRefreshToken((n) => n + 1)}
                title={t('ide.openVsx.refresh', 'Refresh Marketplace')}
                aria-label={t('ide.openVsx.refresh', 'Refresh Marketplace')}
                className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCw className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={t('ide.openVsx.moreActions', 'Views and More Actions')}
                    aria-label={t('ide.openVsx.moreActions', 'Views and More Actions')}
                    className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="w-56">
                  <DropdownMenuItem onClick={() => setExtensionsFilterMode('all')}>
                    All Marketplace Extensions
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExtensionsFilterMode('installed')}>
                    Show Installed Extensions
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExtensionsFilterMode('languages')}>
                    Show Languages &amp; Snippets
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExtensionsFilterMode('themes')}>
                    Show Themes &amp; Icons
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={openPluginsSettings}>
                    <SlidersHorizontal className="size-3.5" />
                    <span>Open Plugins Settings (Current Mode)</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden scrollbar-sleek-parent">
          <Suspense fallback={null}>
            {view === 'extensions' ? (
              <IdeExtensionsPanel
                filterMode={extensionsFilterMode}
                onFilterModeChange={setExtensionsFilterMode}
                refreshToken={extensionsRefreshToken}
              />
            ) : view === 'source-control' ? (
              <RightSidebarPanelContent
                effectiveTab="source-control"
                rightSidebarOpen
                focusVaultSearch={false}
                onVaultSearchFocusHandled={() => undefined}
              />
            ) : (
              <FileExplorer />
            )}
          </Suspense>
        </div>
      </div>
      <div
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30"
        onMouseDown={onResizeStart}
      />
    </aside>
  )
}
