import { useMemo, useState } from 'react'
import { ChevronRight, FolderOpen, GitBranch, Server } from 'lucide-react'
import logo from '../../../../../resources/carver-logo.png'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { launchAddProjectMenuAction } from '@/components/sidebar/project-admission/menu/launch-add-project-menu-action'
import {
  AddRemoteHostDialog,
  type AddRemoteHostMode
} from '@/components/sidebar/host-admission/ssh/AddRemoteHostDialog'
import { activateWorktreeFromSidebar } from '@/lib/workspace/activation/sidebar-worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { IdeScratchWorkspacePreview } from './IdeScratchWorkspacePreview'

export default function IdeWelcome(): React.JSX.Element {
  const t = useTranslate()
  const openModal = useAppStore((state) => state.openModal)
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const [remoteHostMode, setRemoteHostMode] = useState<AddRemoteHostMode | null>(null)
  const scratchConversationActive = useIdeAgentStore(
    (state) => state.activeConversation?.workspaceKey.startsWith('ide-scratch:') === true
  )
  const recent = useMemo(
    () =>
      [...repos]
        .filter((repo) => !repo.isNoRepo)
        .sort((a, b) => b.addedAt - a.addedAt)
        .flatMap((repo) => {
          const worktree = worktreesByRepo[repo.id]?.[0]
          return worktree ? [{ repo, worktree }] : []
        })
        .slice(0, 5),
    [repos, worktreesByRepo]
  )
  const launchProjectAction = (action: 'browse' | 'clone'): void => {
    void launchAddProjectMenuAction({
      action,
      hostId: LOCAL_EXECUTION_HOST_ID,
      onOpenEntryRequest: (entryRequest) => openModal('add-repo', { entryRequest })
    })
  }
  const actions = [
    {
      label: t('ide.openProject', 'Open project'),
      icon: FolderOpen,
      run: () => launchProjectAction('browse')
    },
    {
      label: t('ide.cloneRepository', 'Clone repository'),
      icon: GitBranch,
      run: () => launchProjectAction('clone')
    },
    {
      label: t('ide.connectSsh', 'Connect via SSH'),
      icon: Server,
      run: () => setRemoteHostMode('ssh')
    }
  ]

  if (scratchConversationActive) {
    return <IdeScratchWorkspacePreview />
  }

  return (
    <main className="scrollbar-editor flex min-h-0 flex-1 items-center justify-center overflow-auto bg-editor-surface px-6 py-12">
      <section className="w-full max-w-[560px]" aria-label={t('ide.welcome', 'IDE welcome')}>
        <div className="mb-10 flex flex-col items-center text-center">
          <img src={logo} alt="" aria-hidden className="size-20 object-contain" />
          <h1 className="mt-4 text-base font-medium text-foreground/70">
            {t('ide.carver', 'Carver')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t('ide.integratedEnvironment', 'Integrated development environment')}
          </p>
        </div>

        <div className="mx-auto grid max-w-[440px] grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ide.start', 'Start')}
            </h2>
            <div className="space-y-0.5">
              {actions.map(({ label, icon: Icon, run }) => (
                <button
                  key={label}
                  type="button"
                  className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={run}
                >
                  <Icon className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span className="flex-1 truncate">{label}</span>
                  <ChevronRight className="size-3 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-2 px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ide.recentProjects', 'Recent projects')}
            </h2>
            {recent.length > 0 ? (
              <div className="space-y-0.5">
                {recent.map(({ repo, worktree }) => (
                  <button
                    key={`${repo.id}:${worktree.id}`}
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      void activateWorktreeFromSidebar(
                        worktree.id,
                        repo.executionHostId ?? undefined
                      )
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{repo.displayName}</span>
                      <span className="block truncate font-mono text-3xs text-muted-foreground">
                        {repo.path}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                {t('ide.noRecentProjects', 'Open a project to begin.')}
              </p>
            )}
          </div>
        </div>
      </section>
      <AddRemoteHostDialog mode={remoteHostMode} onOpenChange={setRemoteHostMode} />
    </main>
  )
}
