import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalScenarioDefinition } from './ide-agent-eval-scenarios-core'

export const RESILIENCE_EVAL_SCENARIOS: readonly EvalScenarioDefinition[] = [
  {
    id: 'precise-user-instructions',
    title: 'Following Arabic user language & exact instruction constraints',
    targetContextPaths: ['src/greeting.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(join(ctx.dir, 'src/greeting.ts'), 'export const msg = "hi"\n', 'utf8')
      ctx.setAiResponder((req) => {
        const promptForcesEnglish = req.prompt.includes(
          'Write every human-readable response field in clear, natural English'
        )
        return {
          ok: true,
          text: promptForcesEnglish
            ? 'This file exports msg in English only.'
            : 'هذا الملف يصدر المتغير `msg` بقيمة نصية قصيرة.'
        }
      })
      const out = await runTurn({
        mode: 'ask',
        text: 'اشرح لي محتوى ملف src/greeting.ts باختصار',
        activeFilePath: 'src/greeting.ts'
      })
      const isArabicReply = /[\u0600-\u06ff]/.test(out.lastText)
      return {
        passed: out.status === 'completed' && isArabicReply,
        failureReason: isArabicReply
          ? undefined
          : `Prompt forced English despite Arabic user request: "${out.lastText}"`
      }
    }
  },
  {
    id: 'failed-tool-and-patch-recovery',
    title: 'Recovering from a failed patch search block without aborting the run',
    targetContextPaths: ['src/counter.ts'],
    verificationApplicable: false,
    recoveryApplicable: true,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/counter.ts'),
        'export function nextCount(n: number): number {\n  return n + 1\n}\n',
        'utf8'
      )
      let stepAttempt = 0
      ctx.setAiResponder((req) => {
        if (req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: JSON.stringify({
              objective: 'Increment by step=2',
              affectedFiles: [{ path: 'src/counter.ts', action: 'modify', summary: 'step 2' }],
              steps: [
                { title: 'Patch nextCount', detail: 'Add 2', targetFiles: ['src/counter.ts'] }
              ],
              risks: [],
              testsAndVerification: [],
              estimatedComplexity: 'low',
              requiresApproval: false
            })
          }
        }
        stepAttempt += 1
        if (stepAttempt === 1) {
          return {
            ok: true,
            text: JSON.stringify({
              summary: 'Attempt 1 stale patch',
              operations: [
                {
                  path: 'src/counter.ts',
                  action: 'patch',
                  patches: [{ search: 'return n + 10', replace: 'return n + 2' }]
                }
              ],
              verificationCommands: []
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Recovered patch cleanly',
            operations: [
              {
                path: 'src/counter.ts',
                action: 'patch',
                patches: [{ search: 'return n + 1', replace: 'return n + 2' }]
              }
            ],
            verificationCommands: []
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        text: 'Change nextCount in src/counter.ts to add 2 instead of 1'
      })
      const content = await readFile(join(ctx.dir, 'src/counter.ts'), 'utf8')
      const recovered = out.status === 'completed' && content.includes('return n + 2')
      return {
        passed: recovered,
        failureReason: recovered
          ? undefined
          : `Aborted instead of recovering failed patch (${out.error ?? out.status})`,
        recoverySucceeded: recovered
      }
    }
  },
  {
    id: 'large-conversation-memory',
    title: 'Preserving early constraints across 12-turn session & respecting argv provider limits',
    targetContextPaths: ['src/config.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/config.ts'),
        `export const PAD = "${'x'.repeat(28_000)}"\n`,
        'utf8'
      )
      const priorMessages: { role: 'user' | 'assistant'; text: string }[] = [
        {
          role: 'user',
          text: 'CRITICAL ARCHITECTURE CONSTRAINT: Always use `Result<T, AppError>` and never throw raw strings; keep timeout default at 4500ms.'
        },
        {
          role: 'assistant',
          text: 'Understood: I will preserve `Result<T, AppError>` and `4500ms` timeout across all turns.'
        }
      ]
      for (let i = 1; i <= 10; i += 1) {
        priorMessages.push(
          { role: 'user', text: `Follow-up check #${i}: inspect status module ${i}.` },
          { role: 'assistant', text: `Checked module ${i}; everything looks healthy.` }
        )
      }
      let promptRetainedConstraint = false
      let promptWithinArgvLimit = false
      ctx.setAiResponder((req) => {
        promptRetainedConstraint =
          req.prompt.includes('Result<T, AppError>') && req.prompt.includes('4500ms')
        promptWithinArgvLimit = req.prompt.length <= 28_000
        return {
          ok: true,
          text: `Constraint retained=${promptRetainedConstraint}, argvSafe=${promptWithinArgvLimit}`
        }
      })
      const out = await runTurn({
        mode: 'ask',
        agentId: 'cursor',
        modelId: 'auto',
        text: 'Summarize our active architecture constraint and timeout setting.',
        activeFilePath: 'src/config.ts',
        priorMessages
      })
      const ok = out.status === 'completed' && promptRetainedConstraint && promptWithinArgvLimit
      return {
        passed: ok,
        failureReason: !promptRetainedConstraint
          ? 'Early constraint lost after 6-message slice without compaction'
          : !promptWithinArgvLimit
            ? `Prompt length (${ctx.requests[0]?.prompt.length}) exceeded argv-safe budget for cursor CLI`
            : undefined
      }
    }
  }
]
