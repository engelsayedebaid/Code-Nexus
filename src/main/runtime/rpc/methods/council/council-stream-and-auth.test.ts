import { describe, expect, it } from 'vitest'
import { emptyResultFailure } from '../../../../text-generation/source-control-agent-failure'
import {
  clearCouncilAuthCache,
  extraCliDirectoriesForAgent,
  withExtraAgentDirectoriesOnPath
} from './council-auth-status'
import { parsePartialCouncilOutput, supportsCouncilStreaming } from './council-stream-parser'

describe('council streaming parser and auth path helpers', () => {
  it('parses completed NDJSON antigravity deltas and ignores incomplete trailing lines', () => {
    const partialStdout = [
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Hello ' }
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'world' }
      }),
      '{"event":"step_update","truncated":'
    ].join('\n')

    expect(
      parsePartialCouncilOutput('antigravity', '{"event":"step_update","truncated":')
    ).toBeNull()
    expect(parsePartialCouncilOutput('antigravity', partialStdout)).toBe('Hello world')

    const withResult = [
      partialStdout.split('\n')[0],
      JSON.stringify({
        event: 'result',
        result: { response: 'Final complete answer' }
      }),
      ''
    ].join('\n')
    expect(parsePartialCouncilOutput('antigravity', withResult)).toBe('Final complete answer')
  })

  it('parses completed opencode JSON lines and reports streaming capability per agent', () => {
    const line1 = `${JSON.stringify({ type: 'text', part: { text: 'First chunk ' } })}\n`
    const line2 = JSON.stringify({ type: 'text', part: { text: 'second chunk' } })
    expect(parsePartialCouncilOutput('opencode', `${line1}${line2}`)).toBe('First chunk ')
    expect(parsePartialCouncilOutput('opencode', `${line1}${line2}\n`)).toBe(
      'First chunk \nsecond chunk'
    )
    expect(parsePartialCouncilOutput('codex', line1)).toBeNull()

    expect(supportsCouncilStreaming('antigravity')).toBe(true)
    expect(supportsCouncilStreaming('opencode')).toBe(true)
    expect(supportsCouncilStreaming('opencode2')).toBe(true)
    expect(supportsCouncilStreaming('codex')).toBe(false)
  })

  it('formats council empty-result errors without crashing', () => {
    expect(emptyResultFailure('council', 'Antigravity')).toEqual({
      error: 'Antigravity returned an empty response.'
    })
    expect(emptyResultFailure('council', 'Antigravity', 'stderr detail')).toEqual({
      error: 'Antigravity returned an empty response. CLI output: stderr detail'
    })
  })

  it('prepends discovered agent CLI directories onto PATH without mutating base env', () => {
    const baseEnv: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' }
    const enriched = withExtraAgentDirectoriesOnPath('antigravity', baseEnv)
    const dirs = extraCliDirectoriesForAgent('antigravity', baseEnv)
    expect(baseEnv.PATH).toBe('C:\\Windows\\System32')
    if (dirs.length > 0) {
      for (const dir of dirs) {
        expect(enriched.PATH).toContain(dir)
      }
      const deduped = withExtraAgentDirectoriesOnPath('antigravity', enriched)
      expect(deduped.PATH).toBe(enriched.PATH)
    }
    expect(() => clearCouncilAuthCache()).not.toThrow()
  })
})
