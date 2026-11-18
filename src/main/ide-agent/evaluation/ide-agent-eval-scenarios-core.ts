import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  makeEvalPlanJson,
  type EvalScenarioContext,
  type EvalScenarioDefinition,
  type EvalTurnRunner
} from './ide-agent-eval-types'

export {
  makeEvalPlanJson,
  type EvalScenarioContext,
  type EvalScenarioDefinition,
  type EvalTurnRunner
}

export const CORE_EVAL_SCENARIOS: readonly EvalScenarioDefinition[] = [
  {
    id: 'single-file-bug-fix',
    title: 'Single-file bug fix with minor indentation drift in patch',
    targetContextPaths: ['src/math/discount.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src/math'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/math/discount.ts'),
        'export function applyDiscount(price: number, pct: number): number {\n    const factor = 1 + pct / 100\n    return Math.round(price * factor)\n}\n',
        'utf8'
      )
      ctx.setAiResponder((req, turn) => {
        if (turn === 1 && req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: makeEvalPlanJson({
              objective: 'Fix discount subtraction bug',
              files: [{ path: 'src/math/discount.ts', action: 'modify' }],
              steps: [{ title: 'Fix factor formula', targetFiles: ['src/math/discount.ts'] }]
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Fixed discount formula',
            operations: [
              {
                path: 'src/math/discount.ts',
                action: 'patch',
                patches: [
                  {
                    search: '  const factor = 1 + pct / 100\n  return Math.round(price * factor)',
                    replace:
                      '    const factor = 1 - pct / 100\n    return Math.round(price * factor)'
                  }
                ]
              }
            ],
            verificationCommands: []
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        text: 'Fix the bug in src/math/discount.ts where discount adds instead of subtracts.',
        activeFilePath: 'src/math/discount.ts'
      })
      const disk = await readFile(join(ctx.dir, 'src/math/discount.ts'), 'utf8')
      const fixed = disk.includes('1 - pct / 100')
      return {
        passed: out.status === 'completed' && fixed,
        failureReason: fixed
          ? undefined
          : `Patch failed (status=${out.status}, err=${out.error ?? 'none'})`,
        incorrectModification: out.status === 'completed' && !fixed
      }
    }
  },
  {
    id: 'multi-file-feature',
    title: 'Multi-file feature implementation across types and service',
    targetContextPaths: ['src/AuditTypes.ts', 'src/AuditLogger.ts'],
    verificationApplicable: true,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/AuditTypes.ts'),
        'export type AuditLevel = "info"\n',
        'utf8'
      )
      ctx.setShellResponder(async () => ({
        exitCode: 0,
        stdout: '1 passed\n',
        stderr: '',
        canceled: false,
        timedOut: false,
        durationMs: 10
      }))
      ctx.setAiResponder((req) => {
        if (req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: makeEvalPlanJson({
              objective: 'Add warn level and AuditLogger service',
              files: [
                { path: 'src/AuditTypes.ts', action: 'modify' },
                { path: 'src/AuditLogger.ts', action: 'create' }
              ],
              steps: [
                {
                  title: 'Update types and create logger',
                  targetFiles: ['src/AuditTypes.ts', 'src/AuditLogger.ts']
                }
              ],
              checks: ['pnpm test src/AuditLogger.test.ts']
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Implemented AuditTypes and AuditLogger',
            operations: [
              {
                path: 'src/AuditTypes.ts',
                action: 'modify',
                content: 'export type AuditLevel = "info" | "warn"\n'
              },
              {
                path: 'src/AuditLogger.ts',
                action: 'create',
                content:
                  'import type { AuditLevel } from "./AuditTypes"\nexport const formatAudit = (lvl: AuditLevel, msg: string) => `[${lvl}] ${msg}`\n'
              }
            ],
            verificationCommands: ['pnpm test src/AuditLogger.test.ts']
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        text: 'Extend src/AuditTypes.ts with warn and create src/AuditLogger.ts'
      })
      const loggerDisk = await readFile(join(ctx.dir, 'src/AuditLogger.ts'), 'utf8').catch(() => '')
      return {
        passed: out.status === 'completed' && loggerDisk.includes('formatAudit'),
        failureReason: out.error
      }
    }
  },
  {
    id: 'project-wide-refactor',
    title: 'Project-wide module rename and consumer import update',
    targetContextPaths: ['src/legacyName.ts', 'src/consumer.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src'), { recursive: true })
      await writeFile(join(ctx.dir, 'src/legacyName.ts'), 'export const VERSION = "2.0"\n', 'utf8')
      await writeFile(
        join(ctx.dir, 'src/consumer.ts'),
        'import { VERSION } from "./legacyName"\nexport const banner = () => VERSION\n',
        'utf8'
      )
      ctx.setAiResponder((req) => {
        if (req.prompt.includes('Mode: PLAN ONLY')) {
          return {
            ok: true,
            text: makeEvalPlanJson({
              objective: 'Rename legacyName.ts to versionInfo.ts and update consumer',
              files: [
                { path: 'src/versionInfo.ts', fromPath: 'src/legacyName.ts', action: 'rename' },
                { path: 'src/consumer.ts', action: 'modify' }
              ],
              steps: [
                {
                  title: 'Rename module and update import',
                  targetFiles: ['src/legacyName.ts', 'src/versionInfo.ts', 'src/consumer.ts']
                }
              ]
            })
          }
        }
        return {
          ok: true,
          text: JSON.stringify({
            summary: 'Renamed module and updated consumer import',
            operations: [
              { path: 'src/versionInfo.ts', fromPath: 'src/legacyName.ts', action: 'rename' },
              {
                path: 'src/consumer.ts',
                action: 'patch',
                patches: [{ search: './legacyName', replace: './versionInfo' }]
              }
            ],
            verificationCommands: []
          })
        }
      })
      const out = await runTurn({
        mode: 'agent',
        text: 'Rename src/legacyName.ts to src/versionInfo.ts and update src/consumer.ts'
      })
      const consumer = await readFile(join(ctx.dir, 'src/consumer.ts'), 'utf8')
      const moved = await readFile(join(ctx.dir, 'src/versionInfo.ts'), 'utf8').catch(() => '')
      return {
        passed:
          out.status === 'completed' && consumer.includes('./versionInfo') && moved.includes('2.0'),
        failureReason: out.error
      }
    }
  },
  {
    id: 'cross-file-dependency',
    title: 'Cross-file dependency & reverse-import investigation',
    targetContextPaths: ['src/core/sessionToken.ts', 'src/api/authMiddleware.ts'],
    verificationApplicable: false,
    recoveryApplicable: false,
    execute: async (ctx, runTurn) => {
      await mkdir(join(ctx.dir, 'src/core'), { recursive: true })
      await mkdir(join(ctx.dir, 'src/api'), { recursive: true })
      await writeFile(
        join(ctx.dir, 'src/core/sessionToken.ts'),
        'export function verifySessionToken(raw: string): boolean { return raw.startsWith("tok_") }\n',
        'utf8'
      )
      await writeFile(
        join(ctx.dir, 'src/api/authMiddleware.ts'),
        'import { verifySessionToken } from "../core/sessionToken"\nexport const checkReq = (h: string) => verifySessionToken(h)\n',
        'utf8'
      )
      ctx.setAiResponder((req, turn) => {
        if (turn === 1 && !req.prompt.includes('authMiddleware.ts')) {
          return {
            ok: true,
            text: JSON.stringify({
              toolCalls: [{ tool: 'get_imports', args: { path: 'src/core/sessionToken.ts' } }]
            })
          }
        }
        const sawReverseImport = req.prompt.includes('src/api/authMiddleware.ts')
        return {
          ok: true,
          text: sawReverseImport
            ? '`src/core/sessionToken.ts` is imported by `src/api/authMiddleware.ts`.'
            : 'No dependents found.'
        }
      })
      const out = await runTurn({
        mode: 'ask',
        text: 'Which files depend on src/core/sessionToken.ts?',
        activeFilePath: 'src/core/sessionToken.ts'
      })
      const found = out.lastText.includes('src/api/authMiddleware.ts')
      return {
        passed: out.status === 'completed' && found,
        failureReason: found ? undefined : `Did not resolve dependent: ${out.lastText}`
      }
    }
  }
]
