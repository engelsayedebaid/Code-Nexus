import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/class-names'
import { APP_ICON, type AppIconName } from './app-icon-map'

export type { AppIconName } from './app-icon-map'

/** Canonical icon sizes (px): xs 14, sm 16, md 18, lg 20. */
export const ICON_SIZE_PX = { xs: 14, sm: 16, md: 18, lg: 20 } as const
export type IconSize = keyof typeof ICON_SIZE_PX

const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-[18px]',
  lg: 'size-5'
}

/**
 * Canonical outline icon. Wraps lucide-react so stroke weight, sizing,
 * and accessibility stay consistent app-wide. Prefer `name` for semantic
 * actions; pass `icon` for icons outside the semantic map.
 */
export function AppIcon({
  icon,
  name,
  size = 'sm',
  strokeWidth,
  className,
  label,
  active,
  disabled,
  style
}: {
  icon?: LucideIcon
  name?: AppIconName
  size?: IconSize
  strokeWidth?: number
  className?: string
  /** Accessible label; omit for decorative icons (aria-hidden). */
  label?: string
  active?: boolean
  disabled?: boolean
  style?: CSSProperties
}) {
  const Resolved = icon ?? (name ? APP_ICON[name] : undefined)
  if (!Resolved) {
    return null
  }
  return (
    <Resolved
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      strokeWidth={strokeWidth}
      className={cn(
        SIZE_CLASS[size],
        'shrink-0',
        active && 'text-foreground',
        disabled && 'opacity-50',
        className
      )}
      style={style}
    />
  )
}

/** Icon-only button chrome shared by toolbar controls. */
export function AppIconButton({
  icon,
  name,
  label,
  onClick,
  disabled,
  active,
  className
}: {
  icon?: LucideIcon
  name?: AppIconName
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent/60 hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-accent text-foreground',
        className
      )}
    >
      <AppIcon icon={icon} name={name} size="sm" />
    </button>
  )
}
