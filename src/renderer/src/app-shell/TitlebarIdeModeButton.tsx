import { Bot, Code2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { cn } from '@/lib/class-names'

export function TitlebarIdeModeButton(): React.JSX.Element {
  const appMode = useAppStore((state) => state.appMode)
  const setAppMode = useAppStore((state) => state.setAppMode)

  return (
    <div dir="ltr" className="titlebar-mode-switch" role="group" aria-label="Workspace mode">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'titlebar-mode-entry inline-flex items-center gap-1',
              appMode === 'command' && 'is-active'
            )}
            aria-pressed={appMode === 'command'}
            onClick={() => setAppMode('command')}
          >
            <Bot className="size-3 shrink-0" />
            <span>Agent</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Agent Command Center — multi-project sessions &amp; autonomous agents
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              'titlebar-mode-entry inline-flex items-center gap-1',
              appMode === 'ide' && 'is-active'
            )}
            aria-pressed={appMode === 'ide'}
            onClick={() => setAppMode('ide')}
          >
            <Code2 className="size-3 shrink-0" />
            <span>IDE</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          IDE Code Studio — inline Ctrl+K AI edits, live diff review &amp; docked terminal
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
