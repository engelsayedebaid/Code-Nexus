import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ChevronRight } from 'lucide-react'
import { AppIcon, type AppIconName } from '@/components/icons/app-icon'
import { SecuritySurface } from '@/components/ui/security-surface'
import { motionSafeScrollBehavior } from '@/hooks/usePrefersReducedMotion'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeExecutionMode,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeChatComposer } from './IdeChatComposer'
import { IdeChatMessageItem } from './IdeChatMessageItem'
import { IdePermissionPromptCard } from './IdePermissionPromptCard'
import { IdeQueuedMessagesBar } from './IdeQueuedMessagesBar'
import { IdeRunProgressCard } from './IdeRunProgressCard'

const EMPTY_STATE_SUGGESTIONS: {
  label: string
  prompt: string
  mode: IdeExecutionMode
  icon: AppIconName
}[] = [
  {
    label: 'Explain the current file',
    prompt: 'Explain the open file, its responsibilities, and how it fits into the project.',
    mode: 'ask',
    icon: 'findInFiles'
  },
  {
    label: 'Plan a feature or refactor',
    prompt: 'Help me design an implementation plan before making edits.',
    mode: 'plan',
    icon: 'taskPlan'
  },
  {
    label: 'Build & verify changes',
    prompt: 'Implement the requested changes in the workspace and run checks.',
    mode: 'agent',
    icon: 'sparkles'
  },
  {
    label: 'Review current changes',
    prompt: 'Review the workspace changes for bugs, edge cases, and code quality.',
    mode: 'review',
    icon: 'changes'
  }
]

export function IdeAiChatView({
  conversation,
  providers,
  providersLoading = false,
  workspaceKey,
  workspacePath,
  worktreeSelector,
  worktreeId,
  isScratchWorkspace = false
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
  providersLoading?: boolean
  workspaceKey: string | null
  workspacePath: string | null
  worktreeSelector: string | null
  worktreeId: string | null
  isScratchWorkspace?: boolean
}) {
  const createNewConversation = useIdeAgentStore((s) => s.createNewConversation)
  const setDraft = useIdeAgentStore((s) => s.setDraft)
  const updateSettings = useIdeAgentStore((s) => s.updateSettings)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrollRafRef = useRef<number | null>(null)
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
  const hasActiveRun =
    isRunning || conversation?.status === 'paused' || conversation?.status === 'awaiting_permission'

  const cancelPendingScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = null
    }
  }, [])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'instant') => {
      if (behavior === 'smooth') {
        cancelPendingScroll()
        const el = scrollContainerRef.current
        if (el) {
          el.scrollTo({ top: el.scrollHeight, behavior: motionSafeScrollBehavior('smooth') })
        }
        return
      }
      if (scrollRafRef.current !== null) {
        return
      }
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null
        if (!isNearBottomRef.current) {
          return
        }
        const el = scrollContainerRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
        }
      })
    },
    [cancelPendingScroll]
  )

  useEffect(() => () => cancelPendingScroll(), [cancelPendingScroll])

  useEffect(() => {
    isNearBottomRef.current = true
    setShowJumpToLatest(false)
    scrollToBottom('instant')
  }, [conversation?.id, scrollToBottom])

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom('instant')
      setShowJumpToLatest(false)
      return
    }
    if (messages.length > 0) {
      setShowJumpToLatest(true)
    }
  }, [
    messages.length,
    lastMessageLength,
    pendingPermissions.length,
    latestActivitySeq,
    scrollToBottom
  ])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) {
      return
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 28
    isNearBottomRef.current = nearBottom
    if (nearBottom) {
      setShowJumpToLatest(false)
    } else if (messages.length > 0) {
      setShowJumpToLatest(true)
    }
  }, [messages.length])

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0) {
        isNearBottomRef.current = false
        cancelPendingScroll()
        if (messages.length > 0) {
          setShowJumpToLatest(true)
        }
      }
    },
    [cancelPendingScroll, messages.length]
  )

  const handleJumpToLatest = useCallback(() => {
    isNearBottomRef.current = true
    setShowJumpToLatest(false)
    scrollToBottom('smooth')
  }, [scrollToBottom])

  const handleSuggestion = async (prompt: string, mode: IdeExecutionMode) => {
    let target = conversation
    if (!target && workspaceKey && workspacePath) {
      target = await createNewConversation({ workspaceKey, workspacePath, mode })
    } else if (target && target.mode !== mode) {
      void updateSettings({ conversationId: target.id, mode })
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
          onWheel={handleWheel}
          className="scrollbar-sleek flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        >
          {!conversation || messages.length === 0 ? (
            <div className="mx-auto flex h-full min-h-52 w-full max-w-sm flex-col items-center justify-center px-2 text-center">
              <div className="flex size-9 items-center justify-center rounded-xl border border-border/70 bg-muted/35">
                <AppIcon name="sparkles" size="sm" className="text-muted-foreground" />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">Build with Carver</div>
              <p className="mt-1 max-w-72 text-xs leading-relaxed text-muted-foreground">
                {isScratchWorkspace
                  ? 'No folder is open yet — Carver will work in an isolated scratch workspace.'
                  : 'Ask questions, plan architecture, review diffs, or let the agent edit files.'}
              </p>

              <div className="mt-5 flex w-full flex-col gap-1">
                {EMPTY_STATE_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    onClick={() => void handleSuggestion(suggestion.prompt, suggestion.mode)}
                    className="group flex h-8 w-full items-center gap-2 rounded-lg border border-transparent px-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <AppIcon name={suggestion.icon} size="xs" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                    <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 text-3xs uppercase text-muted-foreground">
                      {suggestion.mode}
                    </span>
                    <ChevronRight className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
              {messages.map((message, idx) => (
                <IdeChatMessageItem
                  key={message.id}
                  message={message}
                  conversation={conversation}
                  providers={providers}
                  providersLoading={providersLoading}
                  worktreeSelector={worktreeSelector}
                  plansById={plansById}
                  commandsById={commandsById}
                  isLatestMessage={idx === messages.length - 1}
                />
              ))}
            </div>
          )}
          {conversation ? <IdeRunProgressCard conversation={conversation} /> : null}
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
        <div className="border-t border-border bg-muted/30 px-3 py-2.5">
          <div className="scrollbar-sleek mx-auto flex max-h-56 w-full max-w-2xl flex-col gap-2 overflow-y-auto">
            {pendingPermissions.map((perm) => (
              <SecuritySurface key={perm.id}>
                <IdePermissionPromptCard permission={perm} conversationId={conversation.id} />
              </SecuritySurface>
            ))}
          </div>
        </div>
      ) : null}

      {conversation ? (
        <IdeQueuedMessagesBar conversation={conversation} isRunning={hasActiveRun} />
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
