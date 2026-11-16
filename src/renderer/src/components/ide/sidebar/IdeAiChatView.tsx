import { useEffect, useMemo, useRef } from 'react'
import { AppIcon, type AppIconName } from '@/components/icons/app-icon'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeChatComposer } from './IdeChatComposer'
import { IdeChatMessageItem } from './IdeChatMessageItem'
import { IdePermissionPromptCard } from './IdePermissionPromptCard'
import { IdeRunProgressCard } from './IdeRunProgressCard'

const EMPTY_STATE_SUGGESTIONS: { label: string; prompt: string; icon: AppIconName }[] = [
  {
    label: 'Analyze the current file',
    prompt: 'Analyze the file I have open and explain what it does.',
    icon: 'findInFiles'
  },
  {
    label: 'Plan a feature',
    prompt: 'Help me plan the implementation of a new feature.',
    icon: 'taskPlan'
  },
  {
    label: 'Review my changes',
    prompt: 'Review the changes in this workspace and point out issues.',
    icon: 'workspace'
  },
  {
    label: 'Explain this error',
    prompt: 'Explain the error I am seeing and suggest a fix.',
    icon: 'messages'
  }
]

export function IdeAiChatView({
  conversation,
  providers,
  workspaceKey,
  workspacePath,
  worktreeSelector,
  worktreeId,
  isScratchWorkspace = false
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
  workspaceKey: string | null
  workspacePath: string | null
  worktreeSelector: string | null
  worktreeId: string | null
  isScratchWorkspace?: boolean
}) {
  const lastError = useIdeAgentStore((s) => s.lastError)
  const clearError = useIdeAgentStore((s) => s.clearError)
  const createNewConversation = useIdeAgentStore((s) => s.createNewConversation)
  const setDraft = useIdeAgentStore((s) => s.setDraft)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const messages = conversation?.messages ?? []
  const lastMessageLength = messages.at(-1)?.text.length ?? 0
  const latestActivitySeq = conversation?.activity.at(-1)?.seq ?? 0
  const plansById = useMemo(
    () => new Map((conversation?.plans ?? []).map((p) => [p.id, p])),
    [conversation?.plans]
  )
  const commandsById = useMemo(
    () => new Map((conversation?.commandExecutions ?? []).map((c) => [c.id, c])),
    [conversation?.commandExecutions]
  )
  const pendingPermissions = (conversation?.pendingPermissions ?? []).filter(
    (p) => p.status === 'pending'
  )

  const isRunning =
    conversation !== null &&
    (conversation.status === 'analyzing' ||
      conversation.status === 'planning' ||
      conversation.status === 'executing' ||
      conversation.status === 'verifying')

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastMessageLength, pendingPermissions.length, latestActivitySeq])

  const handleSuggestion = async (prompt: string) => {
    let target = conversation
    if (!target && workspaceKey && workspacePath) {
      target = await createNewConversation({ workspaceKey, workspacePath })
    }
    if (target) {
      setDraft(target.id, prompt)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-sleek flex-1 overflow-y-auto px-4 py-4">
        {!conversation || messages.length === 0 ? (
          <div className="flex h-full min-h-52 flex-col items-center justify-center px-2 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
              <AppIcon name="sparkles" size="lg" className="size-5 text-muted-foreground" />
            </div>
            <div className="mt-3 text-sm font-semibold text-foreground">
              Code Nexus IDE Assistant
            </div>
            <p className="mt-1.5 max-w-72 text-[11.5px] leading-relaxed text-muted-foreground">
              {isScratchWorkspace ? (
                <>
                  No folder is open, so Nexus works in a private scratch folder and can create files
                  or folders when you ask.
                </>
              ) : (
                <>
                  Ask questions in <span className="font-medium text-foreground">Ask</span>, design
                  changes in <span className="font-medium text-foreground">Plan</span>, approve
                  edits in <span className="font-medium text-foreground">Agent</span>, or audit
                  diffs in <span className="font-medium text-foreground">Review</span>.
                </>
              )}
            </p>
            {isScratchWorkspace && workspacePath ? (
              <p className="mt-2 max-w-full truncate font-mono text-[10px] text-muted-foreground/70">
                {workspacePath}
              </p>
            ) : null}

            <div className="mt-5 grid w-full max-w-80 grid-cols-1 gap-1.5">
              {EMPTY_STATE_SUGGESTIONS.map((suggestion) => {
                return (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => void handleSuggestion(suggestion.prompt)}
                    className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-left text-[11.5px] text-foreground/90 transition-colors hover:border-border hover:bg-accent/50"
                  >
                    <AppIcon name={suggestion.icon} size="xs" className="text-muted-foreground" />
                    <span className="truncate">{suggestion.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            {messages.map((message) => (
              <IdeChatMessageItem
                key={message.id}
                message={message}
                conversation={conversation}
                providers={providers}
                plansById={plansById}
                commandsById={commandsById}
              />
            ))}
          </div>
        )}
        {conversation ? <IdeRunProgressCard conversation={conversation} /> : null}
        <div ref={messagesEndRef} />
      </div>

      {conversation && pendingPermissions.length > 0 ? (
        <div className="border-t border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
          <div className="scrollbar-sleek mx-auto flex max-h-56 w-full max-w-2xl flex-col gap-2 overflow-y-auto">
            {pendingPermissions.map((perm) => (
              <IdePermissionPromptCard
                key={perm.id}
                permission={perm}
                conversationId={conversation.id}
              />
            ))}
          </div>
        </div>
      ) : null}

      {lastError ? (
        <div className="border-t border-destructive/40 bg-destructive/10 px-4 py-1.5">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 text-[11px] text-destructive">
            <span className="truncate" title={lastError}>
              {lastError}
            </span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 hover:opacity-80"
              aria-label="Dismiss error"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
        </div>
      ) : null}

      <IdeChatComposer
        conversation={conversation}
        workspacePath={workspacePath}
        worktreeSelector={worktreeSelector}
        worktreeId={worktreeId}
        isRunning={isRunning}
      />
    </div>
  )
}
