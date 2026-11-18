import type { IdeAiCompletionRequest, IdeAiCompletionResponse } from '../ide-ai-client'
import type { WorkspaceCommandRunResult } from '../ide-workspace-gateway'

export type IdeAgentEvalScenarioId =
  | 'single-file-bug-fix'
  | 'multi-file-feature'
  | 'project-wide-refactor'
  | 'cross-file-dependency'
  | 'ts-compile-error-fix'
  | 'react-component-edit'
  | 'deep-repo-search-gitignore'
  | 'precise-user-instructions'
  | 'failed-tool-and-patch-recovery'
  | 'large-conversation-memory'
  | 'windows-paths-and-crlf'
  | 'active-execution-cancellation'
  | 'project-rules-and-injection-safety'

export type IdeAgentEvalScenarioMetrics = {
  scenarioId: IdeAgentEvalScenarioId
  title: string
  passed: boolean
  failureReason?: string
  verificationApplicable: boolean
  verificationPassed: boolean
  incorrectModification: boolean
  llmRequests: number
  toolInvocations: number
  unnecessaryToolCalls: number
  contextRelevantTargets: number
  contextTotalTargets: number
  contextRelevanceRatio: number
  promptChars: number
  completionChars: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  totalEstimatedTokens: number
  latencyMs: number
  failedEdits: number
  recoveryApplicable: boolean
  recoverySucceeded: boolean
}

export type IdeAgentEvalSuiteReport = {
  label: string
  executedAtIso: string
  totalScenarios: number
  passedScenarios: number
  taskSuccessRate: number
  verificationPassRate: number | null
  incorrectModificationRate: number
  totalToolInvocations: number
  unnecessaryToolCalls: number
  averageContextRelevance: number
  totalEstimatedTokens: number
  averageTokensPerTask: number
  totalLatencyMs: number
  averageLatencyMs: number
  totalFailedEdits: number
  errorRecoverySuccessRate: number | null
  unavailableMetrics: string[]
  scenarios: IdeAgentEvalScenarioMetrics[]
}

export type EvalScenarioContext = {
  dir: string
  requests: IdeAiCompletionRequest[]
  setAiResponder: (
    fn: (
      req: IdeAiCompletionRequest,
      turn: number
    ) => Promise<IdeAiCompletionResponse> | IdeAiCompletionResponse
  ) => void
  setShellResponder: (
    fn: (cmd: string) => Promise<WorkspaceCommandRunResult> | WorkspaceCommandRunResult
  ) => void
}

export type EvalTurnRunner = (input: {
  mode: 'ask' | 'plan' | 'agent' | 'review'
  text: string
  agentId?: string
  modelId?: string
  activeFilePath?: string
  priorMessages?: { role: 'user' | 'assistant'; text: string }[]
  cancelOnFirstRequest?: boolean
}) => Promise<{
  status: string
  lastText: string
  error?: string
  toolCallsCount: number
  unnecessaryToolsCount: number
  failedEditsCount: number
  verificationPassed: boolean
}>

export type EvalScenarioDefinition = {
  id: IdeAgentEvalScenarioId
  title: string
  targetContextPaths: string[]
  verificationApplicable: boolean
  recoveryApplicable: boolean
  execute: (
    ctx: EvalScenarioContext,
    runEngineTurn: EvalTurnRunner
  ) => Promise<{
    passed: boolean
    failureReason?: string
    incorrectModification?: boolean
    recoverySucceeded?: boolean
  }>
}

export function makeEvalPlanJson(params: {
  objective: string
  files: { path: string; action: 'create' | 'modify' | 'rename'; fromPath?: string }[]
  steps: { title: string; targetFiles: string[] }[]
  checks?: string[]
}): string {
  return JSON.stringify({
    intro: params.objective,
    objective: params.objective,
    affectedFiles: params.files.map((f) => ({ ...f, summary: f.action })),
    steps: params.steps.map((s) => ({
      title: s.title,
      detail: s.title,
      targetFiles: s.targetFiles
    })),
    risks: [],
    testsAndVerification: params.checks ?? [],
    estimatedComplexity: params.files.length > 2 ? 'medium' : 'low',
    requiresApproval: false
  })
}
