import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeActivityEventType } from '../../shared/ide-agent/ide-agent-types'
import type { IdeContextBudgetTracker } from './ide-context-budget'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import type { RawAgentToolCall } from './ide-agent-prompt-parsers'

export type ExecutedToolObservation = {
  tool: string
  ok: boolean
  summary: string
  output: string
  activityType: IdeActivityEventType
  relativePath?: string
}

export async function executeWorkspaceSearchOrSymbolTool(params: {
  call: RawAgentToolCall
  gateway: IdeWorkspaceGateway
  budget: IdeContextBudgetTracker
  signal?: AbortSignal
}): Promise<ExecutedToolObservation | null> {
  const { call, gateway, budget, signal } = params

  switch (call.tool) {
    case 'get_workspace_tree': {
      const q = typeof call.args.query === 'string' ? call.args.query : ''
      const files = gateway.searchFiles
        ? await gateway.searchFiles(q, 120, signal)
        : (await gateway.inspectWorkspace(q ? [q] : [], signal)).fileList.slice(0, 120)
      const recorded = budget.recordText(`tree:${q}`, files.join('\n') || '(no files matched)')
      return {
        tool: call.tool,
        ok: true,
        summary: `Listed ${files.length} workspace file(s)`,
        output: recorded.text,
        activityType: 'tool.search'
      }
    }

    case 'search_files': {
      const q = typeof call.args.query === 'string' ? call.args.query : ''
      const hits = gateway.searchFiles ? await gateway.searchFiles(q, 50, signal) : []
      return {
        tool: call.tool,
        ok: true,
        summary: `Searched files for "${q}" (${hits.length} match(es))`,
        output: hits.join('\n') || 'No matching files found.',
        activityType: 'tool.search'
      }
    }

    case 'search_code':
    case 'find_references': {
      const query =
        typeof call.args.query === 'string'
          ? call.args.query
          : typeof call.args.symbol === 'string'
            ? call.args.symbol
            : ''
      if (!query.trim()) {
        return {
          tool: call.tool,
          ok: false,
          summary: `${call.tool} missing query`,
          output: 'A non-empty search query is required.',
          activityType: 'tool.search'
        }
      }
      const pathPrefix = typeof call.args.pathPrefix === 'string' ? call.args.pathPrefix : undefined
      const hits = gateway.searchCode
        ? await gateway.searchCode(query, { pathPrefix, maxResults: 35, signal })
        : []
      const text =
        hits.map((h) => `${h.relativePath}:${h.line}: ${h.preview}`).join('\n') ||
        `No matches found for "${query}".`
      return {
        tool: call.tool,
        ok: true,
        summary: `Found ${hits.length} match(es) for "${query}"`,
        output: budget.recordText(`search:${call.tool}:${query}`, text).text,
        activityType: 'tool.search'
      }
    }

    case 'find_symbol': {
      const query = typeof call.args.query === 'string' ? call.args.query : ''
      const syms = gateway.findSymbols ? await gateway.findSymbols(query, 30) : []
      const text =
        syms
          .map(
            (s) =>
              `${s.kind} ${s.name}${s.exported ? ' [exported]' : ''} — ${s.relativePath}:${s.line}`
          )
          .join('\n') || `No symbols matched "${query}".`
      return {
        tool: call.tool,
        ok: true,
        summary: `Symbol lookup "${query}" (${syms.length} hit(s))`,
        output: budget.recordText(`sym:${query}`, text).text,
        activityType: 'tool.symbol_lookup'
      }
    }

    case 'get_imports': {
      const rawPath = typeof call.args.path === 'string' ? call.args.path : ''
      const rel = normalizeWorkspaceRelativePath(rawPath)
      if (!rel || !gateway.getImports) {
        return {
          tool: call.tool,
          ok: false,
          summary: 'get_imports unavailable',
          output: 'Valid relative path is required.',
          activityType: 'tool.symbol_lookup'
        }
      }
      const graph = await gateway.getImports(rel)
      return {
        tool: call.tool,
        ok: true,
        summary: `Inspected imports for ${rel}`,
        output: `Imports (${graph.imports.length}): ${graph.imports.join(', ') || 'none'}\nImported by (${graph.importedBy.length}): ${graph.importedBy.join(', ') || 'none'}`,
        activityType: 'tool.symbol_lookup',
        relativePath: rel
      }
    }

    case 'get_diagnostics': {
      if (!gateway.getDiagnostics) {
        return {
          tool: call.tool,
          ok: true,
          summary: 'Diagnostics unavailable for workspace',
          output: 'No diagnostic runner available.',
          activityType: 'diagnostics.checked'
        }
      }
      const diag = await gateway.getDiagnostics(signal)
      return {
        tool: call.tool,
        ok: diag.passed,
        summary: diag.summary,
        output: diag.details ? `${diag.summary}\n${diag.details}` : diag.summary,
        activityType: 'diagnostics.checked'
      }
    }

    case 'git_status_diff': {
      const diff = await gateway.getGitDiffSummary()
      return {
        tool: call.tool,
        ok: true,
        summary: diff ? 'Inspected Git status & diff' : 'No pending Git changes',
        output: diff
          ? budget.recordText('git:diff', diff).text
          : 'Working tree is clean or not a Git repo.',
        activityType: 'tool.search'
      }
    }

    default:
      return null
  }
}
