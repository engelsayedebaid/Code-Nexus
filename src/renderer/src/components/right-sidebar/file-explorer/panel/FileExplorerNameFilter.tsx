import React from 'react'
import { ListFilter, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'

type FileExplorerNameFilterProps = {
  query: string
  scopeLabel?: string
  loading?: boolean
  autoFocus?: boolean
  onQueryChange: (value: string) => void
  onClear: () => void
  onClose?: () => void
}

export function FileExplorerNameFilter({
  query,
  scopeLabel,
  loading = false,
  autoFocus = false,
  onQueryChange,
  onClear,
  onClose
}: FileExplorerNameFilterProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-input/50 px-2 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
      data-ignore-file-explorer-keys="true"
    >
      <ListFilter className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="text"
        autoFocus={autoFocus}
        data-explorer-query-input="files"
        className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        aria-label={t(
          'auto.components.right.sidebar.FileExplorerNameFilter.26fb73c6e3',
          'Find files'
        )}
        placeholder={
          scopeLabel
            ? t('fileExplorer.root.findInFolder', 'Find in {{path}}', { path: scopeLabel })
            : t('auto.components.right.sidebar.FileExplorerNameFilter.26fb73c6e3', 'Find files')
        }
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClear()
            onClose?.()
          }
        }}
        spellCheck={false}
      />
      {loading ? <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" /> : null}
      {query || onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="h-auto w-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={t(
            'auto.components.right.sidebar.FileExplorerNameFilter.4d5a6b2a49',
            'Clear file filter'
          )}
          onClick={() => {
            onClear()
            onClose?.()
          }}
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}
