import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeEvalPlanJson, type EvalScenarioDefinition } from './ide-agent-eval-scenarios-core'

export const ADVANCED_EVAL_SCENARIOS: readonly EvalScenarioDefinition[] = [
  {
    id: 'ts-compile-error-fix',
    title: 'TypeScript compilation error resolution via auto-verification & repair',
    targetContextPaths: ['src/billing.ts'],
    verificationApplicable: true,
    recoveryApplicable: true,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { typecheck: 'tsc --noEmit' } }),
        'utf8'
      )
      await writeFile(join(ctx.dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')
      await writeFile(
        join(ctx.dir, 'src/billing.ts'),
        'export function centsToDollars(cents: number): string {\n  return (cents / 100).toFixed(2)\n}\n',
        'utf8'
      )
      ctx.setShellResponder(async () => {
        const content = await readFile(join(ctx.dir, 'src/billing.ts'), 'utf8')
        const broken = content.includes('const tax: number = "bad"')
        return {
          exitCode: broken ? 1 : 0,
          stdout: '',
          stderr: broken
            ? 'src/billing.ts(2,9): error TS2322: Type string is not assignable to number.'
            : '',
          canceled: false,
          timedOut: false,
          durationMs: 15
        }
      })
      ctx.setAiResponder((req) => {
        if (req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: makeEvalPlanJson({
              objective: 'Add tax calculation to billing.ts',
              files: [{ path: 'src/billing.ts', action: 'modify' }],
              steps: [{ title: 'Update centsToDollars', targetFiles: ['src/billing.ts'] }],
              checks: []
            })
          }
        }
        if (req.prompt.includes('Test Fixer')) {
          return {
            ok: true,
            text: JSON.stringify({
              summary: 'Fixed TS2322 type mismatch',
              operations: [
                {
                  path: 'src/billing.ts',
                  action: 'modify',
                  content:
                    'export function centsToDollars(cents: number): string {\n  const tax: number = 0.1\n  return ((cents * (1 + tax)) / 100).toFixed(2)\n}\n'
                }
              ],
              verificationCommands: []
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Added tax variable (with initial TS bug)',
            operations: [
              {
                path: 'src/billing.ts',
                action: 'modify',
                content:
                  'export function centsToDollars(cents: number): string {\n  const tax: number = "bad"\n  return (cents / 100).toFixed(2)\n}\n'
              }
            ],
            verificationCommands: []
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        text: 'Add a 10% tax calculation in src/billing.ts'
      })
      const finalDisk = await readFile(join(ctx.dir, 'src/billing.ts'), 'utf8')
      const clean = finalDisk.includes('const tax: number = 0.1') && !finalDisk.includes('"bad"')
      return {
        passed: out.status === 'completed' && clean,
        failureReason: clean
          ? undefined
          : 'Auto-verification did not catch TS error when plan checks were empty',
        incorrectModification: out.status === 'completed' && !clean,
        recoverySucceeded: clean
      }
    }
  },
  {
    id: 'react-component-edit',
    title: 'React component modification using unified diff patch',
    targetContextPaths: ['src/components/StatusPill.tsx'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src/components'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/components/StatusPill.tsx'),
        'export function StatusPill({ online }: { online: boolean }) {\n  return <span data-state={online ? "up" : "down"}>{online ? "Online" : "Offline"}</span>\n}\n',
        'utf8'
      )
      ctx.setAiResponder((req) => {
        if (req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: makeEvalPlanJson({
              objective: 'Add aria-live polite to StatusPill',
              files: [{ path: 'src/components/StatusPill.tsx', action: 'modify' }],
              steps: [{ title: 'Update JSX span', targetFiles: ['src/components/StatusPill.tsx'] }]
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Added aria-live attribute via unified diff',
            operations: [
              {
                path: 'src/components/StatusPill.tsx',
                action: 'patch',
                unifiedDiff: [
                  '--- a/src/components/StatusPill.tsx',
                  '+++ b/src/components/StatusPill.tsx',
                  '@@ -1,3 +1,3 @@',
                  ' export function StatusPill({ online }: { online: boolean }) {',
                  '-  return <span data-state={online ? "up" : "down"}>{online ? "Online" : "Offline"}</span>',
                  '+  return <span aria-live="polite" data-state={online ? "up" : "down"}>{online ? "Online" : "Offline"}</span>',
                  ' }'
                ].join('\n')
              }
            ],
            verificationCommands: []
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        agentId: 'codex',
        modelId: 'gpt-5.4',
        text: 'Add aria-live="polite" to StatusPill in src/components/StatusPill.tsx',
        activeFilePath: 'src/components/StatusPill.tsx'
      })
      const jsx = await readFile(join(ctx.dir, 'src/components/StatusPill.tsx'), 'utf8')
      const ok = jsx.includes('aria-live="polite"')
      return {
        passed: out.status === 'completed' && ok,
        failureReason: ok
          ? undefined
          : `Unified diff patch failed (status=${out.status}, err=${out.error ?? 'none'})`
      }
    }
  },
  {
    id: 'deep-repo-search-gitignore',
    title: 'Deep repository search (>850 files) respecting .gitignore and secret exclusions',
    targetContextPaths: ['src/zzz-deep/domain/needleTarget.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await writeFile(join(ctx.dir, '.gitignore'), 'ignored-cache/\n', 'utf8')
      await mkdir(join(ctx.dir, 'ignored-cache'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'ignored-cache/fake.ts'),
        'export const DEEP_NEEDLE_991 = "IGNORED_WRONG"\n',
        'utf8'
      )
      await writeFile(join(ctx.dir, '.env'), 'DEEP_NEEDLE_991=TOP_SECRET_VALUE\n', 'utf8')
      await mkdir(join(ctx.dir, 'src/aaa-bulk'), { recursive: true })
      const writes: Promise<void>[] = []
      for (let i = 0; i < 860; i += 1) {
        const name = `file_${String(i).padStart(4, '0')}.ts`
        writes.push(
          writeFile(join(ctx.dir, 'src/aaa-bulk', name), `export const N_${i} = ${i}\n`, 'utf8')
        )
      }
      await Promise.all(writes)
      await mkdir(join(ctx.dir, 'src/zzz-deep/domain'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/zzz-deep/domain/needleTarget.ts'),
        'export const DEEP_NEEDLE_991 = "FOUND_REAL_TARGET"\n',
        'utf8'
      )
      ctx.setAiResponder((req, turn) => {
        if (turn === 1) {
          return {
            ok: true,
            text: JSON.stringify({
              toolCalls: [{ tool: 'search_code', args: { query: 'DEEP_NEEDLE_991' } }]
            })
          }
        }
        const leakedSecret = req.prompt.includes('TOP_SECRET_VALUE')
        const leakedGitignore = req.prompt.includes('IGNORED_WRONG')
        const foundReal = req.prompt.includes('FOUND_REAL_TARGET')
        return {
          ok: true,
          text: JSON.stringify({ leakedSecret, leakedGitignore, foundReal })
        }
      })
      const out = await runTurn({
        mode: 'ask',
        text: 'Where is DEEP_NEEDLE_991 defined?'
      })
      const foundReal = out.lastText.includes('"foundReal":true')
      const leakedIgnores = out.lastText.includes('"leakedGitignore":true')
      const leakedSecret = out.lastText.includes('"leakedSecret":true')
      return {
        passed: out.status === 'completed' && foundReal && !leakedIgnores && !leakedSecret,
        failureReason: !foundReal
          ? 'Search missed file past 800-file cap'
          : leakedIgnores
            ? 'Search violated .gitignore'
            : leakedSecret
              ? 'Search leaked .env secret'
              : undefined
      }
    }
  }
]
