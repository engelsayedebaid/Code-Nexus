import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { cn } from '@/lib/class-names'

export function TitlebarIdeModeButton(): React.JSX.Element {
  const t = useTranslate()
  const appMode = useAppStore((state) => state.appMode)
  const setAppMode = useAppStore((state) => state.setAppMode)
  return (
    <div className="titlebar-mode-switch" role="group" aria-label={t('appMode.label', 'App mode')}>
      {(['command', 'ide'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn('titlebar-mode-entry', appMode === mode && 'is-active')}
          aria-pressed={appMode === mode}
          onClick={() => setAppMode(mode)}
        >
          {mode === 'command' ? t('appMode.agent', 'Agent') : t('appMode.ide', 'IDE')}
        </button>
      ))}
    </div>
  )
}
