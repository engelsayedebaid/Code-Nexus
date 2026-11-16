import { ArrowLeft, ArrowRight, MoreHorizontal, PanelLeft, Search } from 'lucide-react'
import logo from '../../../../resources/carver-logo.png'
import { useTranslate } from '@/i18n/use-translate'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { shouldShowWorktreeHistoryControls } from './chrome/titlebar-worktree-history-controls'
import {
  canGoBackWorktreeHistory,
  canGoForwardWorktreeHistory
} from '@/store/slices/ui/workspace-navigation-history'
import { useShortcutLabel } from '../hooks/useShortcutLabel'
import { useAppStore } from '../store/index'
import { hasCustomTitleBar, hasMacTrafficLights } from './app-window-chrome'
import type { AppChromeLayout } from './use-app-chrome-layout'

/** Reuse left chrome across full-width and sidebar-width headers so controls/popovers stay consistent. */
export function TitlebarLeftControls({
  layout,
  mode = 'combined'
}: {
  layout: AppChromeLayout
  mode?: 'combined' | 'window-menu' | 'sidebar-nav'
}): React.JSX.Element {
  const t = useTranslate()
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const canGoBackWorktree = useAppStore(canGoBackWorktreeHistory)
  const canGoForwardWorktree = useAppStore(canGoForwardWorktreeHistory)
  const leftSidebarShortcutLabel = useShortcutLabel('sidebar.left.toggle')
  const historyBackShortcutLabel = useShortcutLabel('worktree.history.back')
  const historyForwardShortcutLabel = useShortcutLabel('worktree.history.forward')
  const isWindowMenuOnly = mode === 'window-menu'
  const isSidebarNavOnly = mode === 'sidebar-nav'
  const showWindowMenuControls = !isSidebarNavOnly && hasCustomTitleBar
  const showNavControls = !isWindowMenuOnly

  return (
    // Measure the whole row for tab-strip spacing. w-max prevents the collapsed w-0 wrapper shrinking Windows text to one glyph.
    <div
      ref={isWindowMenuOnly ? undefined : layout.titlebarLeftControlsRef}
      className={`flex h-full shrink-0 items-center${
        !isWindowMenuOnly && layout.leftTitlebarChromeLayout.isFloating ? ' w-max' : ' w-full'
      }`}
    >
      <div className="flex h-full items-center">
        {hasMacTrafficLights && !layout.isFullScreen && !isSidebarNavOnly ? (
          <div className="titlebar-traffic-light-pad" />
        ) : showWindowMenuControls ? (
          /* Replace native Windows/Linux chrome with logo and application-menu access. */
          <img src={logo} alt="" aria-hidden className="titlebar-brand-logo" />
        ) : !isSidebarNavOnly ? (
          <div className="pl-2" />
        ) : null}
        {showWindowMenuControls ? (
          <nav className="titlebar-menu" aria-label={t('appMenu.label', 'Application menu')}>
            {(
              [
                ['file', t('appMenu.file', 'File')],
                ['edit', t('appMenu.edit', 'Edit')],
                ['view', t('appMenu.view', 'View')],
                ['help', t('appMenu.help', 'Help')]
              ] as const
            ).map(([section, label]) => (
              <button
                key={section}
                type="button"
                className="titlebar-menu-button"
                onClick={() => window.api.ui.popupMenu(section)}
              >
                {label}
              </button>
            ))}
          </nav>
        ) : null}
        {!isSidebarNavOnly &&
          !showWindowMenuControls &&
          layout.showSidebar &&
          !hasCustomTitleBar &&
          layout.showTitlebarAppName && (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="titlebar-app-name" aria-label={t('brand.carver', 'Carver')}>
                  <span className="titlebar-app-name-main">{t('brand.carver', 'Carver')}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    void updateSettings({ showTitlebarAppName: false })
                  }}
                >
                  {t('auto.App.e81217c1b7', 'Hide App Name')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        {!isSidebarNavOnly && hasCustomTitleBar ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="titlebar-icon-button sr-only focus:not-sr-only"
                aria-label={t('auto.App.8b0b8eb54f', 'Application menu')}
                onClick={() => window.api.ui.popupMenu()}
              >
                <MoreHorizontal size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.8b0b8eb54f', 'Application menu')}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {showNavControls && layout.showSidebar && (!hasCustomTitleBar || isSidebarNavOnly) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle"
                onClick={toggleSidebar}
                aria-label={t('auto.App.e4b9e7dff7', 'Toggle sidebar')}
              >
                <PanelLeft size={15} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.ce37cf5279', 'Toggle sidebar ({{value0}})', {
                value0: leftSidebarShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        )}
        {isSidebarNavOnly && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="sidebar-toggle"
                onClick={() => useAppStore.getState().openModal('worktree-palette')}
                aria-label={t('auto.App.searchWorkspaces', 'Search workspaces')}
              >
                <Search size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.searchWorkspaces', 'Search workspaces')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Show shared workspace/page history wherever its shortcut is available. */}
      {showNavControls && shouldShowWorktreeHistoryControls(layout.activeView) && (
        // Collapsed headers shrink-wrap, so ml-auto alone cannot leave a history-button gutter.
        <div className="ml-auto mr-1 flex items-center pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goBackWorktree()}
                disabled={!canGoBackWorktree}
                aria-label={t('auto.App.064bd07810', 'Go back')}
              >
                <ArrowLeft size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.fe21e8f6f5', 'Go back ({{value0}})', {
                value0: historyBackShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="sidebar-toggle sidebar-toggle-compact"
                onClick={() => useAppStore.getState().goForwardWorktree()}
                disabled={!canGoForwardWorktree}
                aria-label={t('auto.App.cf9099fe98', 'Go forward')}
              >
                <ArrowRight size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('auto.App.f7aa73e785', 'Go forward ({{value0}})', {
                value0: historyForwardShortcutLabel
              })}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
