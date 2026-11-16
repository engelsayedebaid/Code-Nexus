export const MAX_READ_TOOL_TURNS = 5
export const MAX_EXECUTION_TOOL_TURNS = 6
export const MAX_REWRITES_PER_FILE = 4
export const MAX_REPAIR_ATTEMPTS = 2

export class AgentLoopGuard {
  private readonly callHistory = new Map<string, number>()
  private readonly failedCalls = new Set<string>()
  private readonly fileWriteCounts = new Map<string, number>()
  private turns = 0

  constructor(private readonly maxTurns: number) {}

  nextTurn(): { allowed: true; turn: number } | { allowed: false; reason: string } {
    this.turns += 1
    if (this.turns > this.maxTurns) {
      return {
        allowed: false,
        reason: `Stopped tool loop after reaching the ${this.maxTurns}-turn safety limit.`
      }
    }
    return { allowed: true, turn: this.turns }
  }

  checkToolCall(
    tool: string,
    args: unknown
  ): { allowed: true } | { allowed: false; reason: string } {
    const signature = `${tool}:${JSON.stringify(args ?? {})}`
    if (this.failedCalls.has(signature)) {
      return {
        allowed: false,
        reason: `Blocked repeating previously failed tool call "${tool}". Try a different approach.`
      }
    }
    const count = (this.callHistory.get(signature) ?? 0) + 1
    this.callHistory.set(signature, count)
    if (count > 2) {
      return {
        allowed: false,
        reason: `Blocked redundant repeated call to "${tool}" with identical arguments.`
      }
    }
    return { allowed: true }
  }

  recordFailure(tool: string, args: unknown): void {
    const signature = `${tool}:${JSON.stringify(args ?? {})}`
    this.failedCalls.add(signature)
  }

  checkFileRewrite(relativePath: string): { allowed: true } | { allowed: false; reason: string } {
    const key = relativePath.toLowerCase()
    const nextCount = (this.fileWriteCounts.get(key) ?? 0) + 1
    this.fileWriteCounts.set(key, nextCount)
    if (nextCount > MAX_REWRITES_PER_FILE) {
      return {
        allowed: false,
        reason: `Stopped modifying "${relativePath}" after ${MAX_REWRITES_PER_FILE} writes in one run.`
      }
    }
    return { allowed: true }
  }
}
