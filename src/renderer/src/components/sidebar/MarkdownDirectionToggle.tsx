import { useState } from 'react'
import { AlignLeft, AlignRight, Languages } from 'lucide-react'
import type { MarkdownDirectionOverride } from './CommentMarkdown'

const ARABIC_CHAR_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const MAX_STORED_OVERRIDES = 500
const directionOverrides = new Map<string, MarkdownDirectionOverride>()

export function containsArabicText(text: string): boolean {
  return ARABIC_CHAR_PATTERN.test(text)
}

export function useMarkdownDirectionOverride(
  messageId?: string
): [MarkdownDirectionOverride, (next: MarkdownDirectionOverride) => void] {
  const [override, setOverrideState] = useState<MarkdownDirectionOverride>(() =>
    messageId ? (directionOverrides.get(messageId) ?? 'auto') : 'auto'
  )

  const setOverride = (next: MarkdownDirectionOverride): void => {
    setOverrideState(next)
    if (!messageId) {
      return
    }
    if (next === 'auto') {
      directionOverrides.delete(messageId)
      return
    }
    if (!directionOverrides.has(messageId) && directionOverrides.size >= MAX_STORED_OVERRIDES) {
      const oldestKey = directionOverrides.keys().next().value
      if (oldestKey !== undefined) {
        directionOverrides.delete(oldestKey)
      }
    }
    directionOverrides.set(messageId, next)
  }

  return [override, setOverride]
}

const NEXT_DIRECTION: Record<MarkdownDirectionOverride, MarkdownDirectionOverride> = {
  auto: 'rtl',
  rtl: 'ltr',
  ltr: 'auto'
}

const DIRECTION_LABEL: Record<MarkdownDirectionOverride, string> = {
  auto: 'Auto',
  rtl: 'RTL',
  ltr: 'LTR'
}

export function MarkdownDirectionToggle({
  value,
  onChange,
  compact = false
}: {
  value: MarkdownDirectionOverride
  onChange: (next: MarkdownDirectionOverride) => void
  compact?: boolean
}): React.JSX.Element {
  const Icon = value === 'rtl' ? AlignRight : value === 'ltr' ? AlignLeft : Languages
  return (
    <button
      type="button"
      onClick={() => onChange(NEXT_DIRECTION[value])}
      aria-label={`Text direction: ${DIRECTION_LABEL[value]}`}
      title={`Text direction: ${DIRECTION_LABEL[value]} (click to switch Auto / RTL / LTR)`}
      className={
        compact
          ? 'inline-flex size-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
          : 'inline-flex size-6 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      }
    >
      <Icon className={compact ? 'size-3' : 'size-3.5'} aria-hidden />
    </button>
  )
}
