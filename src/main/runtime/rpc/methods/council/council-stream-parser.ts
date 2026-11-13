import { parseOpenCodeGenerationOutput } from '../../../../../shared/opencode-generation-output'

function parseCompleteLines(stdoutSnapshot: string): string[] {
  const endedWithNewline = stdoutSnapshot.endsWith('\n')
  const lines = stdoutSnapshot.split(/\r?\n/)
  if (!endedWithNewline) {
    lines.pop()
  }
  return lines
}

function parseAntigravityPartialOutput(stdoutSnapshot: string): string | null {
  const chunks: string[] = []
  let finalResponse: string | null = null
  for (const line of parseCompleteLines(stdoutSnapshot)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') {
      continue
    }
    const record = parsed as Record<string, unknown>
    if (
      record.event === 'step_update' &&
      record.step_update &&
      typeof record.step_update === 'object'
    ) {
      const update = record.step_update as Record<string, unknown>
      if (update.step_type === 'agent_response' && typeof update.text_delta === 'string') {
        chunks.push(update.text_delta)
      }
    } else if (record.event === 'result' && record.result && typeof record.result === 'object') {
      const result = record.result as Record<string, unknown>
      if (typeof result.response === 'string') {
        finalResponse = result.response
      }
    }
  }
  const combined = finalResponse ?? chunks.join('')
  return combined.trim() ? combined : null
}

function parseOpenCodePartialOutput(stdoutSnapshot: string): string | null {
  const lines = parseCompleteLines(stdoutSnapshot)
  if (lines.length === 0) {
    return null
  }
  const parsed = parseOpenCodeGenerationOutput(lines.join('\n'))
  return parsed.ok && parsed.text.trim() ? parsed.text : null
}

/** Extracts clean user-visible incremental output for agents that emit structured streams. */
export function parsePartialCouncilOutput(agentId: string, stdoutSnapshot: string): string | null {
  if (agentId === 'antigravity') {
    return parseAntigravityPartialOutput(stdoutSnapshot)
  }
  if (agentId === 'opencode' || agentId === 'opencode2') {
    return parseOpenCodePartialOutput(stdoutSnapshot)
  }
  return null
}

export function supportsCouncilStreaming(agentId: string): boolean {
  return agentId === 'antigravity' || agentId === 'opencode' || agentId === 'opencode2'
}
