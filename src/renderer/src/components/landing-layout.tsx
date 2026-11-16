import { ShortcutKeyCombo } from './ShortcutKeyCombo'
import type { ShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import logo from '../../../../resources/carver-logo.png'
import { useTranslate } from '@/i18n/use-translate'

export type LandingShortcutItem = {
  id: string
  shortcut: ShortcutKeyComboDetails
  action: string
}

export const LANDING_ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-sm px-4 py-2 rounded-md cursor-pointer hover:bg-accent transition-colors'

export function LandingBrand(): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <img
        src={logo}
        alt={t('brand.carverLogo', 'Carver logo')}
        className="size-20 object-contain"
      />
      <h1 className="text-4xl font-bold text-foreground tracking-tight">
        {t('brand.carver', 'Carver')}
      </h1>
    </>
  )
}

export function LandingShortcutList({
  shortcuts
}: {
  shortcuts: readonly LandingShortcutItem[]
}): React.JSX.Element {
  return (
    <div className="mt-6 w-full max-w-xs space-y-2">
      {shortcuts.map((shortcut) => (
        <div key={shortcut.id} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-sm text-muted-foreground">{shortcut.action}</span>
          <ShortcutKeyCombo
            keys={shortcut.shortcut.keys}
            doubleTap={shortcut.shortcut.doubleTap}
            separatorClassName="mx-0.5 text-[10px] text-muted-foreground"
          />
        </div>
      ))}
    </div>
  )
}
