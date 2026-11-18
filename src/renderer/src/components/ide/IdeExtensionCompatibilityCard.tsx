import { AlertTriangle, Braces, Check, FileCode, Package, Palette, Sparkles } from 'lucide-react'
import type {
  OpenVsxActiveCapability,
  OpenVsxInstalledExtension,
  OpenVsxRuntimeSupport,
  OpenVsxUnsupportedCapability
} from '../../../../shared/openvsx/openvsx-types'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '@/components/ui/badge'

const ACTIVE_CAPABILITY_LABELS: Record<OpenVsxActiveCapability, string> = {
  syntax: 'Syntax Highlighting',
  snippets: 'Code Snippets',
  theme: 'Color Themes',
  'icon-theme': 'File Icon Themes',
  'extension-pack': 'Extension Pack'
}

const UNSUPPORTED_CAPABILITY_LABELS: Record<OpenVsxUnsupportedCapability, string> = {
  'js-runtime': 'VS Code Extension Host (JS)',
  lsp: 'Language Server / IntelliSense',
  debugger: 'Debugger / DAP',
  views: 'Sidebar / Custom Views',
  commands: 'Command Palette Actions',
  keybindings: 'Keybindings',
  menus: 'Editor Menus',
  webviews: 'Custom Editors / Webviews'
}

type IdeExtensionCompatibilityCardProps = {
  runtimeSupport: OpenVsxRuntimeSupport
  installedRecord?: OpenVsxInstalledExtension
  extensionPack: string[]
  dependencies: string[]
  onSelectExtensionById: (extensionId: string) => void
}

export function IdeExtensionCompatibilityCard({
  runtimeSupport,
  installedRecord,
  extensionPack,
  dependencies,
  onSelectExtensionById
}: IdeExtensionCompatibilityCardProps): React.JSX.Element {
  const t = useTranslate()

  return (
    <>
      <div className="mt-3 space-y-2 rounded-md border border-border/80 bg-muted/35 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-semibold text-foreground">
            {t('ide.openVsx.compatibilityTitle', 'Orca Runtime Compatibility')}
          </span>
          {installedRecord && (
            <Badge variant="referenceLabel">
              {installedRecord.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          )}
        </div>

        {runtimeSupport.activeCapabilities.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {runtimeSupport.activeCapabilities.map((cap) => (
              <Badge key={cap} variant="secondary" className="h-5 px-1.5 text-3xs font-medium">
                <Check className="size-3" />
                {ACTIVE_CAPABILITY_LABELS[cap]}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-3xs text-muted-foreground">
            {t(
              'ide.openVsx.noDeclarativeAssets',
              'No declarative TextMate grammars, snippets, themes, or SVG icon themes found.'
            )}
          </p>
        )}

        {installedRecord && (
          <div className="space-y-1 text-3xs text-muted-foreground">
            {installedRecord.contributions.syntaxes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <FileCode className="size-3 shrink-0" />
                <span>
                  Syntaxes: {installedRecord.contributions.syntaxes.map((s) => s.label).join(', ')}
                </span>
              </div>
            )}
            {installedRecord.runtimeSupport.snippetCount > 0 && (
              <div className="flex items-center gap-1.5">
                <Braces className="size-3 shrink-0" />
                <span>
                  Snippets: {installedRecord.runtimeSupport.snippetCount} active across{' '}
                  {installedRecord.contributions.snippets.map((s) => s.language).join(', ')}
                </span>
              </div>
            )}
            {installedRecord.contributions.themes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3 shrink-0" />
                <span>
                  Themes:{' '}
                  {installedRecord.contributions.themes.map((item) => item.label).join(', ')}
                </span>
              </div>
            )}
            {installedRecord.contributions.iconThemes.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Palette className="size-3 shrink-0" />
                <span>
                  Icon Themes:{' '}
                  {installedRecord.contributions.iconThemes.map((item) => item.label).join(', ')}
                </span>
              </div>
            )}
          </div>
        )}

        {runtimeSupport.unsupportedCapabilities.length > 0 && (
          <div className="rounded border border-border/70 bg-background/70 p-2 text-3xs text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <AlertTriangle className="size-3 shrink-0" />
              <span>
                {t(
                  'ide.openVsx.unsupportedFeaturesHeading',
                  'Requires VS Code Extension Host (inactive in Orca)'
                )}
              </span>
            </div>
            <p className="mt-1">
              {runtimeSupport.unsupportedCapabilities
                .map((cap) => UNSUPPORTED_CAPABILITY_LABELS[cap])
                .join(' · ')}
            </p>
          </div>
        )}

        {installedRecord && installedRecord.warnings.length > 0 && (
          <div className="space-y-0.5 border-t border-border/60 pt-1.5 text-3xs text-muted-foreground">
            {installedRecord.warnings.map((warning, idx) => (
              <div key={`${warning}-${idx}`}>• {warning}</div>
            ))}
          </div>
        )}
      </div>

      {(extensionPack.length > 0 || dependencies.length > 0) && (
        <div className="mt-3 space-y-2 rounded-md border border-border/70 p-2.5">
          {extensionPack.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-2xs font-medium text-foreground">
                <Package className="size-3" />
                <span>
                  {t('ide.openVsx.extensionPack', 'Extension Pack')} ({extensionPack.length})
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {extensionPack.map((depId) => (
                  <button
                    key={depId}
                    type="button"
                    onClick={() => onSelectExtensionById(depId)}
                    className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {depId}
                  </button>
                ))}
              </div>
            </div>
          )}
          {dependencies.length > 0 && (
            <div>
              <div className="mb-1 text-2xs font-medium text-foreground">
                {t('ide.openVsx.dependencies', 'Dependencies')} ({dependencies.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {dependencies.map((depId) => (
                  <button
                    key={depId}
                    type="button"
                    onClick={() => onSelectExtensionById(depId)}
                    className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {depId}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
