export type DropIndicator = 'left' | 'right' | null

// Use a visible blue insertion cue above tab borders without changing layout.
export function getDropIndicatorClasses(dropIndicator: DropIndicator): string {
  if (dropIndicator === 'left') {
    return "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-blue-500 before:z-10 before:content-['']"
  }
  if (dropIndicator === 'right') {
    return "after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-blue-500 after:z-10 after:content-['']"
  }
  return ''
}

// Keep the foreground marker above selection/unread layers; zero horizontal inset avoids scrollWidth jitter at the strip’s end.
export const ACTIVE_TAB_INDICATOR_CLASSES = 'pointer-events-none hidden'

export function getTabRootStateClasses(isActive: boolean): string {
  return isActive
    ? 'rounded-lg bg-tab-active text-tab-active-foreground'
    : 'rounded-lg bg-tab-inactive text-tab-inactive-foreground hover:bg-tab-active/50 hover:text-tab-active-foreground'
}

export function getTabStripBorderClasses(
  _hasTabsToRight: boolean,
  _options?: { includeTopBorder?: boolean }
): string {
  return ''
}
