import { useMemo, useState } from 'react'
import { ChevronRight, FolderOpen, GitBranch, Server } from 'lucide-react'
import logo from '../../../../../resources/carver-logo.png'
import { useAppStore } from '@/store'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { launchAddProjectMenuAction } from '@/components/sidebar/project-admission/menu/launch-add-project-menu-action'
import {
  AddRemoteHostDialog,
  type AddRemoteHostMode
} from '@/components/sidebar/host-admission/ssh/AddRemoteHostDialog'
import { activateWorktreeFromSidebar } from '@/lib/workspace/activation/sidebar-worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  getFolderWorkspaceWorktree,
  getFolderWorkspaceWorktreeHostId
} from '../../../../shared/folder-workspaces/folder-workspace-worktree'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { IdeScratchWorkspacePreview } from './IdeScratchWorkspacePreview'

const ACTIVE_SCRATCH_STATUSES = new Set(['analyzing', 'planning', 'executing', 'verifying'])

export default function IdeWelcome(): React.JSX.Element {
  const openModal = useAppStore((state) => state.openModal)
  const repos = useAppStore((state) => state.repos)
  const worktreesByRepo = useAppStore(selectWorktreesByRepo)
  const folderWorkspaces = useAppStore(selectFolderWorkspaces)
  const [remoteHostMode, setRemoteHostMode] = useState<AddRemoteHostMode | null>(null)
  const scratchConversationActive = useIdeAgentStore((state) => {
    const conv = state.activeConversation
    if (!conv?.workspaceKey.startsWith('ide-scratch:')) {
      return false
    }
    return (
      conv.fileChanges.length > 0 ||
      conv.messages.some((m) => m.role === 'user') ||
      ACTIVE_SCRATCH_STATUSES.has(conv.status)
    )
  })
  const recent = useMemo(() => {
    const repoEntries = [...repos]
      .filter((repo) => !repo.isNoRepo)
      .flatMap((repo) => {
        const worktree = worktreesByRepo[repo.id]?.[0]
        return worktree
          ? [
              {
                key: `${repo.id}:${worktree.id}`,
                displayName: repo.displayName,
                path: repo.path,
                worktreeId: worktree.id,
                hostId: repo.executionHostId ?? undefined,
                sortTime: repo.addedAt
              }
            ]
          : []
      })
    const folderEntries = [...(folderWorkspaces ?? [])]
      .filter((fw) => !fw.isArchived)
      .map((fw) => {
        const wt = getFolderWorkspaceWorktree(fw)
        return {
          key: `folder:${fw.id}`,
          displayName: fw.name,
          path: fw.folderPath,
          worktreeId: wt.id,
          hostId: getFolderWorkspaceWorktreeHostId(fw),
          sortTime: fw.lastActivityAt || fw.createdAt
        }
      })
    return [...repoEntries, ...folderEntries].sort((a, b) => b.sortTime - a.sortTime).slice(0, 5)
  }, [folderWorkspaces, repos, worktreesByRepo])
  const launchProjectAction = (action: 'browse' | 'clone'): void => {
    void launchAddProjectMenuAction({
      action,
      hostId: LOCAL_EXECUTION_HOST_ID,
      onOpenEntryRequest: (entryRequest) => openModal('add-repo', { entryRequest })
    })
  }
  const actions = [
    {
      label: 'Open project',
      icon: FolderOpen,
      run: () => launchProjectAction('browse')
    },
    {
      label: 'Clone repository',
      icon: GitBranch,
      run: () => launchProjectAction('clone')
    },
    {
      label: 'Connect via SSH',
      icon: Server,
      run: () => setRemoteHostMode('ssh')
    }
  ]

  if (scratchConversationActive) {
    return <IdeScratchWorkspacePreview />
  }

  return (
    <main
      dir="ltr"
      className="scrollbar-editor flex min-h-0 flex-1 items-center justify-center overflow-auto bg-editor-surface px-6 py-12 text-left"
    >
      <section className="w-full max-w-[560px]" aria-label="IDE welcome">
        <div className="mb-10 flex flex-col items-center text-center">
          <img src={logo} alt="" aria-hidden className="size-20 object-contain" />
          <h1 className="mt-4 text-base font-medium text-foreground/70">Carver</h1>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Integrated development environment
          </p>
        </div>

        <div className="mx-auto grid max-w-[440px] grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Start
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
              Recent projects
            </h2>
            {recent.length > 0 ? (
              <div className="space-y-0.5">
                {recent.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => void activateWorktreeFromSidebar(item.worktreeId, item.hostId)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{item.displayName}</span>
                      <span className="block truncate font-mono text-3xs text-muted-foreground">
                        {item.path}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                Open a project to begin.
              </p>
            )}
          </div>
        </div>
      </section>
      <AddRemoteHostDialog mode={remoteHostMode} onOpenChange={setRemoteHostMode} />
    </main>
  )
}
