import { createHash } from 'node:crypto'
import type { IdeContextBudgetSummary } from '../../shared/ide-agent/ide-agent-events'

export class IdeContextBudgetTracker {
  private readonly loadedHashes = new Map<string, string>()
  private usedChars = 0
  private deduplicatedReads = 0
  private readonly budgetChars: number
  private readonly budgetTokens: number
  private readonly stackLabels: string[]

  constructor(options?: { budgetTokens?: number; stackLabels?: string[] }) {
    this.budgetTokens = Math.max(4_000, options?.budgetTokens ?? 28_000)
    // Reserve ~35% for system prompts, tool schema, and model output.
    this.budgetChars = Math.floor(this.budgetTokens * 0.65 * 4)
    this.stackLabels = options?.stackLabels ?? []
  }

  canFit(extraChars: number): boolean {
    return this.usedChars + extraChars <= this.budgetChars
  }

  remainingChars(): number {
    return Math.max(0, this.budgetChars - this.usedChars)
  }

  recordText(
    label: string,
    text: string
  ): { included: boolean; deduplicated: boolean; text: string } {
    const hash = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
    const prevHash = this.loadedHashes.get(label)
    if (prevHash === hash) {
      this.deduplicatedReads += 1
      return {
        included: false,
        deduplicated: true,
        text: `[Unchanged since earlier read in this session (${label}, hash ${hash})]`
      }
    }
    const isExplicitRange = label.startsWith('range:')
    const available = isExplicitRange
      ? Math.max(this.remainingChars(), 4_000)
      : this.remainingChars()
    if (available <= 200) {
      return {
        included: false,
        deduplicated: false,
        text: `[Context budget reached (${this.usedChars}/${this.budgetChars} chars); use read_file_range for ${label}]`
      }
    }
    const truncated = text.length > available
    const clipped = truncated
      ? `${text.slice(0, available)}\n... [truncated to fit context budget]`
      : text
    if (!truncated) {
      this.loadedHashes.set(label, hash)
    }
    this.usedChars += clipped.length
    return { included: true, deduplicated: false, text: clipped }
  }

  summary(): IdeContextBudgetSummary {
    return {
      usedChars: this.usedChars,
      estimatedTokens: Math.ceil(this.usedChars / 4),
      budgetTokens: this.budgetTokens,
      isEstimate: true,
      loadedFiles: this.loadedHashes.size,
      deduplicatedReads: this.deduplicatedReads,
      ...(this.stackLabels.length > 0 ? { stackLabels: this.stackLabels } : {})
    }
  }
}
