import {
  Check,
  ChevronDown,
  Home,
  Layers3,
  Lightbulb,
  Paperclip,
  Plus,
  SendHorizontal,
  X
} from 'lucide-react'
import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../../shared/execution-host'
import { AgentLaunchPicker } from '@/components/agent/AgentLaunchPicker'
import { useLandingChatComposer } from '@/components/landing/use-landing-chat-composer'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'

export default function Landing(): React.JSX.Element {
  const t = useTranslate()
  const {
    prompt,
    setPrompt,
    attachmentPaths,
    removeAttachment,
    selectableRepos,
    selectedRepo,
    hostOptions,
    effectiveHostId,
    activeHostLabel,
    submitting,
    textareaRef,
    observation,
    quickAgent,
    pickerDraft,
    launchSelection,
    setAgentMenuOpen,
    handleQuickAgentPick,
    handleSelectBlankTerminal,
    handleSelectNoRepo,
    handleSelectRepo,
    isHostSelectable,
    handleSelectHost,
    handleAddFiles,
    applyStarterPrompt,
    handleSend,
    openTaskPage
  } = useLandingChatComposer()

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden select-none bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <section className="w-full max-w-[680px]" aria-label={t('landing.newChat', 'New chat')}>
          <div className="mb-2 flex items-center gap-1 pl-2 text-xs text-muted-foreground">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={submitting}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="max-w-52 truncate">
                    {selectedRepo?.displayName ?? t('landing.composer.noRepo', 'No Repo')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-72">
                <DropdownMenuItem onSelect={handleSelectNoRepo}>
                  <Check className={cn('size-3.5', selectedRepo !== null && 'opacity-0')} />
                  <Home className="size-3.5 text-muted-foreground" />
                  <span>{t('landing.composer.noRepo', 'No Repo')}</span>
                </DropdownMenuItem>
                {selectableRepos.map((repo) => (
                  <DropdownMenuItem
                    key={`${repo.id}:${getRepoExecutionHostId(repo)}`}
                    onSelect={() => handleSelectRepo(repo)}
                  >
                    <Check
                      className={cn('size-3.5', selectedRepo?.id !== repo.id && 'opacity-0')}
                    />
                    <RepoIconGlyph
                      repoIcon={repo.repoIcon}
                      className="size-3.5 shrink-0 text-muted-foreground"
                      iconClassName="size-3.5"
                    />
                    <span className="truncate">{repo.displayName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={submitting}
                  className="flex h-7 items-center gap-1 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  aria-label={t('landing.composer.environment', 'Execution environment')}
                >
                  <span className="max-w-44 truncate">{activeHostLabel}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-64">
                {hostOptions.map((host) => (
                  <DropdownMenuItem
                    key={host.id}
                    disabled={!isHostSelectable(host.id)}
                    onSelect={() => handleSelectHost(host.id)}
                  >
                    <Check className={cn('size-3.5', effectiveHostId !== host.id && 'opacity-0')} />
                    <span className="truncate">{host.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/50">
            <textarea
              ref={textareaRef}
              dir="auto"
              value={prompt}
              disabled={submitting}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              placeholder={t(
                'landing.composer.placeholder',
                'Plan, Build, / for skills, @ for context'
              )}
              rows={2}
              className="min-h-[64px] max-h-56 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
              aria-label={t('landing.composer.prompt', 'Describe what you want to build')}
            />
            {attachmentPaths.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {attachmentPaths.map((filePath) => {
                  const fileName = filePath.split(/[\\/]/).pop() || filePath
                  return (
                    <span
                      key={filePath}
                      title={filePath}
                      className="inline-flex max-w-56 items-center gap-1 rounded-full bg-accent/70 px-2.5 py-1 text-xs text-foreground"
                    >
                      <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{fileName}</span>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => removeAttachment(filePath)}
                        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
                        aria-label={t('landing.composer.removeAttachment', 'Remove attachment')}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            ) : null}
            <div className="flex items-center gap-1 px-2.5 pb-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleAddFiles()}
                    className="flex size-8 items-center justify-center rounded-full bg-accent/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    aria-label={t('landing.composer.addContext', 'Add files or context')}
                  >
                    <Plus className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {t('landing.composer.addContext', 'Add files or context')}
                </TooltipContent>
              </Tooltip>

              <div className="ml-auto flex items-center gap-1.5">
                <AgentLaunchPicker
                  model={observation.model}
                  agent={quickAgent}
                  value={pickerDraft}
                  triggerLabel={
                    quickAgent === null
                      ? t('landing.composer.chooseAgent', 'Choose agent')
                      : undefined
                  }
                  cli={launchSelection.choice?.route === 'terminal-tui'}
                  disabled={submitting}
                  setupDisabled={
                    observation.model.state !== 'settled' ||
                    observation.model.pickerContext?.executionHostId !== LOCAL_EXECUTION_HOST_ID
                  }
                  triggerVariant="ghost"
                  triggerClassName="h-8 w-auto max-w-44 gap-1.5 rounded-md px-2 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
                  onPick={handleQuickAgentPick}
                  onSelectBlankTerminal={handleSelectBlankTerminal}
                  onOpenChange={setAgentMenuOpen}
                />
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSend()}
                className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                aria-label={t('landing.composer.send', 'Start chat')}
              >
                <SendHorizontal className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => applyStarterPrompt(t('landing.planStarter', 'Plan a new idea'))}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Lightbulb className="size-3.5" />
              {t('landing.planNewIdea', 'Plan New Idea')}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => openTaskPage()}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Layers3 className="size-3.5" />
              {t('landing.multitask', 'Multitask')}
            </button>
          </div>
        </section>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 text-2xs text-muted-foreground/70">
        <Paperclip className="size-3" />
        {t('landing.composer.hint', 'Add files, choose an agent, and press Enter to start a chat')}
      </div>
    </main>
  )
}
