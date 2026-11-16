import { useEffect, useState } from 'react'
import { Blocks } from 'lucide-react'
import { cn } from '@/lib/class-names'

type IdeExtensionIconProps = {
  src?: string
  name: string
  packCount?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function formatExtensionMetricCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0'
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`
  }
  return String(Math.round(count))
}

export function IdeExtensionIcon({
  src,
  name,
  packCount,
  size = 'md',
  className
}: IdeExtensionIconProps): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const boxSizeClass =
    size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10'
  const iconSizeClass =
    size === 'sm' ? 'size-4' : size === 'lg' ? 'size-6' : 'size-5'

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/60',
        boxSizeClass,
        className
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          className="size-[78%] rounded-sm object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Blocks className={cn('text-muted-foreground', iconSizeClass)} />
      )}
      {typeof packCount === 'number' && packCount > 1 && (
        <span
          className="absolute -bottom-1 -left-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-background px-1 text-3xs font-semibold text-foreground shadow-xs"
          title={`${packCount} bundled extensions`}
        >
          {packCount}
        </span>
      )}
    </div>
  )
}
