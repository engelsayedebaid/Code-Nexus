import { Suspense, useState } from 'react'
import {
  Blocks,
  Files,
  FolderKanban,
  GitBranch,
  MoreHorizontal,
  RotateCw,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import { hasCustomTitleBar } from '@/app-shell/app-window-chrome'
import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import type { IdeDevelopmentView } from '@/store/slices/ui/ui-slice-contract-core'
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
            'relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'text-foreground'
          )}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          {active ? (
            <span className="absolute inset-x-1.5 -bottom-[5px] h-0.5 rounded-full bg-foreground" />
          ) : null}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function IdeActivityStrip({ className }: { className?: string }): React.JSX.Element {
  const view = useAppStore((state) => state.ideDevelopmentView)
  const setView = useAppStore((state) => state.setIdeDevelopmentView)

  return (
    <div
      dir="ltr"
      className={cn('flex min-w-0 flex-1 items-center gap-0.5 text-left', className)}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="tablist"
      aria-label="Development tools"
    >
      <ActivityButton active={view === 'files'} label="Explorer" onClick={() => setView('files')}>
        <Files className="size-4" />
      </ActivityButton>
      <ActivityButton active={view === 'search'} label="Search" onClick={() => setView('search')}>
        <Search className="size-4" />
      </ActivityButton>
      <ActivityButton
        active={view === 'source-control'}
        label="Source Control"
        onClick={() => setView('source-control')}
      >
        <GitBranch className="size-4" />
      </ActivityButton>
      <ActivityButton
        active={view === 'extensions'}
        label="Extensions"
        onClick={() => setView('extensions')}
      >
        <Blocks className="size-4" />
      </ActivityButton>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => useAppStore.getState().openModal('worktree-palette')}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Switch project"
            >
              <FolderKanban className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Switch project
          </TooltipContent>
        </Tooltip>

        <DropdownMenu dir="ltr">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="More views"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>More views</DropdownMenuLabel>
            {(
              [
                ['files', 'Explorer'],
                ['search', 'Search'],
                ['source-control', 'Source Control'],
                ['extensions', 'Extensions']
              ] satisfies readonly [IdeDevelopmentView, string][]
            ).map(([id, itemLabel]) => (
              <DropdownMenuItem key={id} onClick={() => setView(id)}>
                {itemLabel}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openPluginsSettings}>
              <SlidersHorizontal className="size-3.5" />
              Plugins Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function IdeDevelopmentSidebar(): React.JSX.Element {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const view = useAppStore((state) => state.ideDevelopmentView)
  const width = useAppStore((state) => state.sidebarWidth)
  const setWidth = useAppStore((state) => state.setSidebarWidth)
  const [extensionsFilterMode, setExtensionsFilterMode] = useState<ExtensionsFilterMode>('all')
  const [extensionsRefreshToken, setExtensionsRefreshToken] = useState(0)

  const { containerRef, onResizeStart } = useSidebarResize<HTMLDivElement>({
    isOpen: sidebarOpen,
    width,
    minWidth: 220,
    maxWidth: 500,
    deltaSign: 1,
    setWidth
  })

  const sectionTitle =
    view === 'extensions' ? 'Extensions' : view === 'source-control' ? 'Source Control' : 'Search'

  return (
    <aside
      ref={containerRef}
      dir="ltr"
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col bg-background text-left',
        sidebarOpen ? 'border-r border-border overflow-visible' : 'w-0 overflow-hidden border-r-0'
      )}
      aria-hidden={!sidebarOpen || undefined}
      aria-label="Development tools"
    >
      {sidebarOpen ? (
        <>
          {!hasCustomTitleBar ? (
            <div className="flex h-9 shrink-0 items-center border-b border-border/70 px-2">
              <IdeActivityStrip />
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {view !== 'files' ? (
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/70 px-3">
                <span className="truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {sectionTitle}
                </span>
                {view === 'extensions' ? (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setExtensionsRefreshToken((n) => n + 1)}
                          aria-label="Refresh Marketplace"
                          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <RotateCw className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={4}>
                        Refresh Marketplace
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenu dir="ltr">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label="Views and More Actions"
                              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <MoreHorizontal className="size-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={4}>
                          Views and More Actions
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end" side="bottom" className="w-56">
                        <DropdownMenuItem onClick={() => setExtensionsFilterMode('all')}>
                          All Marketplace Extensions
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setExtensionsFilterMode('installed')}>
                          Installed Extensions
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setExtensionsFilterMode('languages')}>
                          Languages & Snippets
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setExtensionsFilterMode('themes')}>
                          Themes & Icons
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={openPluginsSettings}>
                          <SlidersHorizontal className="size-3.5" />
                          <span>Plugins Settings</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            ) : null}

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
        </>
      ) : null}
    </aside>
  )
}
