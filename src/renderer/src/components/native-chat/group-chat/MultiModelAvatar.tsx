import { cn } from '@/lib/class-names'
import { AgentIcon } from '../../agent/icons/AgentIcon'
import { isTuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent-config'
import type { TerminalAgent } from '../../../../../shared/agent-status/identity/terminal-agent'

/** A provider id the icon catalog can name; unknown ids fall back to a neutral glyph. */
function terminalAgent(agent: string | null | undefined): TerminalAgent | null {
  if (!agent) {
    return null
  }
  if (agent === 'dsb') {
    return agent
  }
  return isTuiAgent(agent) ? agent : null
}

/** A provider's real icon in a circle, matching the transcript's avatar size. */
export function MultiModelAvatar({
  agent,
  size = 32,
  className
}: {
  agent: string | null | undefined
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <span
      title={agent ?? undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted',
        className
      )}
      style={{ width: size, height: size }}
    >
      <AgentIcon agent={terminalAgent(agent)} size={Math.round(size * 0.58)} />
    </span>
  )
}

/** Overlapping provider icons for a composer pill, capped so the label keeps its room. */
export function MultiModelAvatarStack({
  agents,
  size = 16,
  max = 3
}: {
  agents: readonly string[]
  size?: number
  max?: number
}): React.JSX.Element {
  const counts = new Map<string, number>()
  const entries = agents.slice(0, max).map((agent) => {
    const count = (counts.get(agent) ?? 0) + 1
    counts.set(agent, count)
    return { key: `${agent}:${count}`, agent }
  })
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {entries.map((entry) => (
        <MultiModelAvatar
          key={entry.key}
          agent={entry.agent}
          size={size}
          className="border-background"
        />
      ))}
    </span>
  )
}
