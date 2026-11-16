import { Sparkles } from 'lucide-react'
import { useAppStore } from '@/store'

export function IdeLiveEditingBadge({ relativePath }: { relativePath: string }) {
  const highlight = useAppStore((s) => s.ideActiveEditHighlight)

  if (!highlight || highlight.relativePath !== relativePath) {
    return null
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500"
      title={highlight.label ? `AI editing: ${highlight.label}` : 'AI live editing active'}
      data-testid="ide-live-editing-badge"
    >
      <Sparkles className="size-3 animate-pulse" />
      <span>AI editing{highlight.label ? ` · ${highlight.label}` : ''}</span>
    </span>
  )
}

