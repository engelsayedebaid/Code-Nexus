import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = useRef(true)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)

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
    isNearBottomRef.current = true
    setShowJumpToLatest(false)
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [conversation?.id])

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
      setShowJumpToLatest(false)
      return
    }
    if (messages.length > 0) {
      setShowJumpToLatest(true)
    }
  }, [messages.length, lastMessageLength, pendingPermissions.length, latestActivitySeq])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) {
      return
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 72
    isNearBottomRef.current = nearBottom
    if (nearBottom) {
      setShowJumpToLatest(false)
    }
  }, [])

  const handleJumpToLatest = useCallback(() => {
    isNearBottomRef.current = true
    setShowJumpToLatest(false)
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [])

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
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="scrollbar-sleek flex-1 overflow-y-auto px-3 py-3"
        >
          {!conversation || messages.length === 0 ? (
            <div className="flex h-full min-h-52 flex-col items-center justify-center px-3 text-center">
              <AppIcon name="sparkles" size="lg" className="size-6 text-muted-foreground/40" />
              <div className="mt-3 text-sm font-medium text-foreground">Start a conversation</div>
              <p className="mt-1.5 max-w-72 text-xs leading-relaxed text-muted-foreground">
                {isScratchWorkspace ? (
                  <>No folder is open. Carver will work in a private scratch folder.</>
                ) : (
                  <>Ask about the codebase, plan a change, or let the agent build it.</>
                )}
              </p>
              {isScratchWorkspace && workspacePath ? (
                <p className="mt-2 max-w-full truncate font-mono text-3xs text-muted-foreground/70">
                  {workspacePath}
                </p>
              ) : null}

              <div className="mt-5 grid w-full max-w-80 grid-cols-2 gap-1">
                {EMPTY_STATE_SUGGESTIONS.map((suggestion) => {
                  return (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={() => void handleSuggestion(suggestion.prompt)}
                      className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        {showJumpToLatest ? (
          <button
            type="button"
            onClick={handleJumpToLatest}
            data-testid="ide-chat-jump-to-latest"
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2.5 py-1 text-2xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent"
          >
            <ArrowDown className="size-3" />
            <span>Jump to latest</span>
          </button>
        ) : null}
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
