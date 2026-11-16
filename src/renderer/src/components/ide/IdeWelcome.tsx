import { useMemo, useState } from 'react'
import { FolderOpen, GitBranch, Server } from 'lucide-react'
import logo from '../../../../../resources/logo.svg'
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
    <main className="scrollbar-editor flex min-h-0 flex-1 items-center justify-center overflow-auto bg-editor-surface px-6 py-16">
      <section className="w-full max-w-[520px]" aria-label={t('ide.welcome', 'IDE welcome')}>
        <div className="mb-7 flex items-center gap-3">
          <img src={logo} alt="" aria-hidden className="size-9 opacity-90" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              {t('ide.codeNexus', 'Code Nexus')}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('ide.integratedEnvironment', 'Integrated development environment')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {actions.map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              className="group flex min-h-20 flex-col items-start justify-between rounded-lg border border-border bg-card p-3 text-left text-xs text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={run}
            >
              <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="mt-8">
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('ide.recentProjects', 'Recent projects')}
          </h2>
          {recent.length > 0 ? (
            <div className="space-y-0.5">
              {recent.map(({ repo, worktree }) => (
                <button
                  key={`${repo.id}:${worktree.id}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                  onClick={() =>
                    void activateWorktreeFromSidebar(worktree.id, repo.executionHostId ?? undefined)
                  }
                >
                  <span className="truncate text-foreground">{repo.displayName}</span>
                  <span className="truncate font-mono text-2xs text-muted-foreground">
                    {repo.path}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('ide.noRecentProjects', 'Open a project to begin.')}
            </p>
          )}
        </div>
      </section>
      <AddRemoteHostDialog mode={remoteHostMode} onOpenChange={setRemoteHostMode} />
    </main>
  )
}
