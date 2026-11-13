import { ExternalLink } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function TitlebarIdeModeButton(): React.JSX.Element {
  const t = useTranslate()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="titlebar-mode-entry"
          disabled
          aria-label={t('appMode.ideUnavailable', 'IDE mode is not available yet')}
        >
          IDE
          <ExternalLink className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {t('appMode.ideUnavailable', 'IDE mode is not available yet')}
      </TooltipContent>
    </Tooltip>
  )
}
