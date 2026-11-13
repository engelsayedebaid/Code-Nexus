import { describe, expect, it } from 'vitest'
import { textGenerationTimeoutMs } from './source-control-generation-limits'

describe('textGenerationTimeoutMs', () => {
  it('gives multi-model council runs a 300s budget while keeping other tasks at 60s', () => {
    expect(textGenerationTimeoutMs('council')).toBe(300_000)
    expect(textGenerationTimeoutMs('commit-message')).toBe(60_000)
    expect(textGenerationTimeoutMs('council', 120_000)).toBe(120_000)
  })
})

