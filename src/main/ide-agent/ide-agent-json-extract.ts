export function scanBalancedJsonObjects(source: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) {
        start = i
      }
      depth += 1
    } else if (ch === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(source.slice(start, i + 1))
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            results.push(parsed as Record<string, unknown>)
          }
        } catch {
          // Ignore non-JSON brace span.
        }
        start = -1
      }
    }
  }
  return results
}

export function extractJsonObjectFromAiOutput(raw: string): Record<string, unknown> | null {
  const fencedMatches = Array.from(raw.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi))
  for (const match of fencedMatches.toReversed()) {
    const inner = match[1]?.trim()
    if (!inner) {
      continue
    }
    const found = scanBalancedJsonObjects(inner)
    if (found.length > 0) {
      return found.at(-1)!
    }
  }
  const allObjects = scanBalancedJsonObjects(raw)
  return allObjects.at(-1) ?? null
}

export function unwrapDirectAnswerJsonIfPresent(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) {
    return raw
  }
  const parsed = extractJsonObjectFromAiOutput(trimmed)
  if (
    parsed &&
    parsed.responseType === 'answer' &&
    typeof parsed.message === 'string' &&
    parsed.message.trim()
  ) {
    return parsed.message.trim()
  }
  return raw
}
