import { useMemo, useState } from 'react'
import { AppIcon } from '@/components/icons/app-icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PluginPanel from '@/components/right-sidebar/plugin-panels/PluginPanel'
import { usePluginPanels } from '@/store/plugins/catalog/plugin-contribution-catalog'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import { cn } from '@/lib/class-names'
import type { IdeConversation, IdeTodoItem } from '../../../../../shared/ide-agent/ide-agent-types'

export function IdeSimpleTodoPanel({
  workspaceKey,
  conversation
}: {
  workspaceKey: string | null
  conversation: IdeConversation | null
}) {
  const pluginPanels = usePluginPanels()
  const todoPlugin = useMemo(
    () =>
      pluginPanels.find(
        (panel) =>
          panel.id === 'todos' ||
          panel.id === 'simple-todo' ||
          /simple\s*todo/i.test(panel.title) ||
          /todo/i.test(panel.pluginName)
      ) ?? null,
    [pluginPanels]
  )

  const [sourceMode, setSourceMode] = useState<'plugin' | 'workspace'>('plugin')
  const [newText, setNewText] = useState('')
  const todosByWorkspace = useIdeAgentStore((s) => s.todosByWorkspace)
  const saveTodos = useIdeAgentStore((s) => s.saveTodos)

  const todos: IdeTodoItem[] = workspaceKey ? (todosByWorkspace[workspaceKey] ?? []) : []
  const activePlan = conversation?.plans.find((p) => p.id === conversation.activePlanId) ?? null
  const showPlugin = Boolean(todoPlugin) && sourceMode === 'plugin'

  const persist = (next: IdeTodoItem[]) => {
    if (!workspaceKey) {
      return
    }
    void saveTodos(workspaceKey, next)
  }

  const handleAdd = () => {
    const trimmed = newText.trim()
    if (!trimmed || !workspaceKey) {
      return
    }
    const now = Date.now()
    const item: IdeTodoItem = {
      id: `todo-${now}-${Math.random().toString(36).slice(2, 7)}`,
      workspaceKey,
      text: trimmed,
      done: false,
      createdAt: now,
      updatedAt: now
    }
    setNewText('')
    persist([...todos, item])
  }

  const handleToggle = (id: string) => {
    const now = Date.now()
    persist(todos.map((t) => (t.id === id ? { ...t, done: !t.done, updatedAt: now } : t)))
  }

  const handleDelete = (id: string) => {
    persist(todos.filter((t) => t.id !== id))
  }

  const handleClearCompleted = () => {
    persist(todos.filter((t) => !t.done))
  }

  const handleImportPlanSteps = () => {
    if (!workspaceKey || !activePlan) {
      return
    }
    const now = Date.now()
    const existingStepIds = new Set(todos.map((t) => t.linkedStepId).filter(Boolean))
    const imported: IdeTodoItem[] = activePlan.steps
      .filter((s) => !existingStepIds.has(s.id))
      .map((step) => ({
        id: `todo-${step.id}-${now}`,
        workspaceKey,
        text: `${step.index}. ${step.title}`,
        done: step.status === 'completed',
        linkedPlanId: activePlan.id,
        linkedStepId: step.id,
        createdAt: now,
        updatedAt: now
      }))
    if (imported.length > 0) {
      persist([...todos, ...imported])
      setSourceMode('workspace')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {todoPlugin ? (
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2.5 py-1.5 text-[11px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSourceMode('plugin')}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                showPlugin
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {todoPlugin.title || 'Simple Todo Plugin'}
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('workspace')}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors',
                !showPlugin
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              Task Checklist ({todos.length})
            </button>
          </div>
          {activePlan ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 px-1.5 text-[10px]"
              onClick={handleImportPlanSteps}
              title="Import active plan steps"
            >
              <AppIcon name="addTask" className="mr-1 size-3" />
              Import Plan
            </Button>
          ) : null}
        </div>
      ) : null}

      {showPlugin && todoPlugin ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PluginPanel key={todoPlugin.tabKey} tabKey={todoPlugin.tabKey} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-border/70 p-2.5">
            <Input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              placeholder={workspaceKey ? 'Add a todo item...' : 'Open a workspace first...'}
              disabled={!workspaceKey}
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!workspaceKey || !newText.trim()}
              onClick={handleAdd}
              aria-label="Add todo"
            >
              <AppIcon name="add" size="xs" />
            </Button>
            {!todoPlugin && activePlan ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={handleImportPlanSteps}
                title="Import steps from active implementation plan"
              >
                <AppIcon name="addTask" size="xs" />
              </Button>
            ) : null}
          </div>

          <div className="scrollbar-sleek flex-1 space-y-1.5 overflow-y-auto p-2.5">
            {todos.length === 0 ? (
              <div className="flex h-36 flex-col items-center justify-center text-center text-xs text-muted-foreground">
                <AppIcon name="todo" size="lg" className="mb-2 size-5 opacity-50" />
                <span>No todo items for this workspace.</span>
              </div>
            ) : (
              todos.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 bg-card/60 px-2.5 py-1.5 text-xs"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => handleToggle(item.id)}
                      className="size-3.5 rounded border-border accent-primary"
                    />
                    <span
                      className={cn(
                        'truncate',
                        item.done ? 'line-through text-muted-foreground' : 'text-foreground'
                      )}
                    >
                      {item.text}
                    </span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Delete ${item.text}`}
                    onClick={() => handleDelete(item.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <AppIcon name="delete" className="size-3" />
                  </button>
                </div>
              ))
            )}
          </div>

          {todos.some((t) => t.done) ? (
            <div className="flex items-center justify-between border-t border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <span>
                {todos.filter((t) => t.done).length}/{todos.length} done
              </span>
              <button
                type="button"
                className="text-foreground hover:underline"
                onClick={handleClearCompleted}
              >
                Clear completed
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
