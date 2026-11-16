import { useEffect, useMemo, useState } from 'react'
import { FileCode2, FolderOpen, Sparkles } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { cn } from '@/lib/class-names'
import { launchAddProjectMenuAction } from '@/components/sidebar/project-admission/menu/launch-add-project-menu-action'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { IDE_SCRATCH_PREVIEW_FILE_EVENT } from './ide-scratch-preview-navigation'

const RUNNING = new Set(['analyzing', 'planning', 'executing', 'verifying'])

export function IdeScratchWorkspacePreview(): React.JSX.Element | null {
  const conversation = useIdeAgentStore((state) => state.activeConversation)
  const followAgent = useAppStore((state) => state.ideFollowAgent)
  const openModal = useAppStore((state) => state.openModal)
  const changes = useMemo(
    () => [...(conversation?.fileChanges ?? [])].sort((a, b) => a.updatedAt - b.updatedAt),
    [conversation?.fileChanges]
  )
  const latestPath = changes.at(-1)?.relativePath ?? null
  const [selectedPath, setSelectedPath] = useState<string | null>(latestPath)

  useEffect(() => {
    if (followAgent && latestPath) {
      setSelectedPath(latestPath)
    }
  }, [followAgent, latestPath])

  useEffect(() => {
    const reveal = (event: Event): void => {
      const relativePath = (event as CustomEvent<string>).detail
      if (relativePath) {
        setSelectedPath(relativePath)
      }
    }
    window.addEventListener(IDE_SCRATCH_PREVIEW_FILE_EVENT, reveal)
    return () => window.removeEventListener(IDE_SCRATCH_PREVIEW_FILE_EVENT, reveal)
  }, [])

  if (!conversation?.workspaceKey.startsWith('ide-scratch:')) {
    return null
  }

  const selected =
    changes.find((change) => change.relativePath === selectedPath) ?? changes.at(-1) ?? null
  const running = RUNNING.has(conversation.status)
  const arabic = /[\u0600-\u06ff]/.test(
    conversation.messages.findLast((message) => message.role === 'user')?.text ?? ''
  )
  const lines = (selected?.afterContent ?? '').split(/\r?\n/)

  const openProject = (): void => {
    void launchAddProjectMenuAction({
      action: 'browse',
      hostId: LOCAL_EXECUTION_HOST_ID,
      onOpenEntryRequest: (entryRequest) => openModal('add-repo', { entryRequest })
    })
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-surface">
      <header className="flex min-h-11 items-center gap-3 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {running ? (
            <LoadingSpinner className="size-4 text-muted-foreground" />
          ) : (
            <Sparkles className="size-4 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-foreground">
              {arabic ? 'مساحة العمل المؤقتة' : 'Scratch workspace'}
            </p>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {conversation.workspacePath}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {followAgent
            ? arabic
              ? 'متابعة الوكيل مفعّلة'
              : 'Following agent'
            : arabic
              ? 'متابعة الوكيل متوقفة'
              : 'Follow agent off'}
        </span>
        <Button size="xs" variant="outline" onClick={openProject}>
          <FolderOpen className="size-3" />
          {arabic ? 'فتح مشروع' : 'Open project'}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="scrollbar-sleek w-52 shrink-0 overflow-y-auto border-r border-border py-2">
          <p className="px-3 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {arabic ? 'ملفات الوكيل' : 'Agent files'}
          </p>
          {changes.length > 0 ? (
            changes.map((change) => (
              <button
                key={change.id}
                type="button"
                data-current={change.relativePath === selected?.relativePath}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[current=true]:bg-accent data-[current=true]:text-foreground"
                onClick={() => setSelectedPath(change.relativePath)}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="truncate">{change.relativePath}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
              {arabic
                ? 'ستظهر الملفات هنا فور بدء كتابتها.'
                : 'Files appear here as soon as writing begins.'}
            </p>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
                <span className="truncate font-mono text-xs text-foreground">
                  {selected.relativePath}
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {selected.chunksApplied}/{selected.totalChunks} {arabic ? 'أجزاء' : 'chunks'}
                </span>
              </div>
              <div className="scrollbar-editor min-h-0 flex-1 overflow-auto" dir="ltr">
                <pre className="min-w-max py-2 font-mono text-xs leading-5 text-foreground">
                  {lines.map((line, index) => (
                    <div
                      key={`${index}:${line}`}
                      className={cn(
                        'grid grid-cols-[3.25rem_minmax(0,1fr)] px-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150',
                        index >= Math.max(0, lines.length - 3) && running && 'bg-accent/35'
                      )}
                    >
                      <span className="select-none pr-3 text-right text-muted-foreground/60">
                        {index + 1}
                      </span>
                      <code className="whitespace-pre pr-6">{line || ' '}</code>
                    </div>
                  ))}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                {running ? (
                  <LoadingSpinner className="mx-auto size-5 text-muted-foreground" />
                ) : (
                  <FileCode2 className="mx-auto size-5 text-muted-foreground" />
                )}
                <p className="mt-3 text-sm font-medium text-foreground">
                  {arabic ? 'جارٍ تجهيز أول ملف' : 'Preparing the first file'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {arabic
                    ? 'سيظهر المحتوى هنا أثناء تنفيذ الخطة بدل بقاء مساحة المحرر فارغة.'
                    : 'Live output appears here while the plan runs, so the editor never feels empty.'}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
