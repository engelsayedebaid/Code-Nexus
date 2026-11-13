import type { TextGenerationOperation } from './source-control-text-generation-types'

export const SOURCE_CONTROL_GENERATION_TIMEOUT_MS = 60_000
export const COUNCIL_GENERATION_TIMEOUT_MS = 300_000
export const MAX_SOURCE_CONTROL_AGENT_OUTPUT_BYTES = 4 * 1024 * 1024

export function textGenerationTimeoutMs(
  operation: TextGenerationOperation,
  overrideMs?: number
): number {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs) && overrideMs > 0) {
    return overrideMs
  }
  return operation === 'council'
    ? COUNCIL_GENERATION_TIMEOUT_MS
    : SOURCE_CONTROL_GENERATION_TIMEOUT_MS
}
