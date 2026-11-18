import { normalizeWorkspaceRelativePath } from '../../shared/ide-agent/ide-plan-policy'
import type { IdeConversation, IdeExecutionMode } from '../../shared/ide-agent/ide-agent-types'
import {
  executeWorkspaceSearchOrSymbolTool,
  type ExecutedToolObservation
} from './ide-agent-search-tools'
import {
  describeAttachmentToolPalette,
  executeAttachmentReadTool,
  isAttachmentReadToolName
} from './ide-attachment-tools'
import type { IdeAttachmentStore } from './ide-attachment-store'
import type { IdeContextBudgetTracker } from './ide-context-budget'
import type { IdeWorkspaceGateway } from './ide-workspace-gateway'
import type { RawAgentToolCall } from './ide-agent-prompt-parsers'
import { redactSensitiveSecrets } from './harness/prompt-security-guard'
import { readDiscoveredWorkspaceSkill } from './harness/workspace-instructions-loader'

export type { ExecutedToolObservation } from './ide-agent-search-tools'

const READ_ONLY_TOOLS = new Set([
  'get_workspace_tree',
  'read_file',
  'read_file_range',
  'search_files',
  'search_code',
  'find_symbol',
  'find_references',
  'get_imports',
  'get_diagnostics',
  'git_status_diff',
  'read_skill',
  'list_message_attachments',
  'read_attachment',
  'read_attachment_range',
  'search_attachment_content'
])

export function isReadOnlyToolName(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool) || isAttachmentReadToolName(tool)
}

export function describeReadOnlyToolPalette(): string {
  return [
    'Optional read-only inspection tools (if you need more codebase context before finalizing, output ONLY ```json { "toolCalls": [{ "tool": "...", "args": { ... } }] } ```):',
    '- get_workspace_tree: { "query"?: string }',
    '- read_file: { "path": "relative/path.ts" }',
    '- read_file_range: { "path": "relative/path.ts", "startLine": 1, "endLine": 120 }',
    '- search_files: { "query": "partialName" }',
    '- search_code: { "query": "text", "pathPrefix"?: "src/" }',
    '- find_symbol: { "query": "SymbolName" }',
    '- find_references: { "symbol": "SymbolName" }',
    '- get_imports: { "path": "relative/path.ts" }',
    '- get_diagnostics: {}',
    '- git_status_diff: {}',
    '- read_skill: { "name": "skillName" }',
    ...describeAttachmentToolPalette()
  ].join('\n')
}

export async function executeAgentReadOnlyTool(params: {
  call: RawAgentToolCall
  mode: IdeExecutionMode
  gateway: IdeWorkspaceGateway
  budget: IdeContextBudgetTracker
  conv?: IdeConversation
  attachmentStore?: IdeAttachmentStore | null
  signal?: AbortSignal
}): Promise<ExecutedToolObservation> {
  const { call, gateway, budget, signal } = params
  if (!isReadOnlyToolName(call.tool)) {
    return {
      tool: call.tool,
      ok: false,
      summary: `Blocked tool "${call.tool}" in ${params.mode} inspection phase`,
      output: `Tool "${call.tool}" is prohibited outside approved Agent execution.`,
      activityType: 'analysis.file_read'
    }
  }

  if (call.tool === 'read_file') {
    const rawPath = typeof call.args.path === 'string' ? call.args.path : ''
    if (!rawPath.trim()) {
      return {
        tool: call.tool,
        ok: false,
        summary: 'read_file missing path',
        output: 'Argument "path" is required.',
        activityType: 'analysis.file_read'
      }
    }
    const rel = normalizeWorkspaceRelativePath(rawPath)
    const res = await gateway.readTextFile(rel)
    if (!res.ok) {
      return {
        tool: call.tool,
        ok: false,
        summary: `Blocked reading ${rel}`,
        output: res.message,
        activityType: 'analysis.file_read',
        relativePath: rel
      }
    }
    if (res.content === null) {
      return {
        tool: call.tool,
        ok: false,
        summary: `File not found: ${rel}`,
        output: `File "${rel}" does not exist.`,
        activityType: 'analysis.file_read',
        relativePath: rel
      }
    }
    const recorded = budget.recordText(`file:${rel}`, redactSensitiveSecrets(res.content).text)
    return {
      tool: call.tool,
      ok: true,
      summary: recorded.deduplicated ? `Reused cached ${rel}` : `Read ${rel}`,
      output: `File ${rel} (sha256: ${res.sha256}):\n${recorded.text}`,
      activityType: 'analysis.file_read',
      relativePath: rel
    }
  }

  if (call.tool === 'read_skill') {
    const skillName = typeof call.args.name === 'string' ? call.args.name : ''
    const skillRes = await readDiscoveredWorkspaceSkill(
      gateway.target.workspacePath,
      skillName,
      signal
    )
    if (!skillRes.ok) {
      return {
        tool: call.tool,
        ok: false,
        summary: `Skill unavailable: ${skillName || 'unnamed'}`,
        output: skillRes.message,
        activityType: 'analysis.file_read'
      }
    }
    const recorded = budget.recordText(`skill:${skillRes.name}`, skillRes.content)
    return {
      tool: call.tool,
      ok: true,
      summary: `Loaded skill ${skillRes.name}`,
      output: `Skill "${skillRes.name}":\n${recorded.text}`,
      activityType: 'analysis.file_read'
    }
  }

  if (call.tool === 'read_file_range') {
    const rawPath = typeof call.args.path === 'string' ? call.args.path : ''
    if (!rawPath.trim()) {
      return {
        tool: call.tool,
        ok: false,
        summary: 'read_file_range missing path',
        output: 'Argument "path" is required.',
        activityType: 'analysis.file_read'
      }
    }
    const rel = normalizeWorkspaceRelativePath(rawPath)
    const startLine = typeof call.args.startLine === 'number' ? Math.max(1, call.args.startLine) : 1
    const endLine =
      typeof call.args.endLine === 'number'
        ? Math.max(startLine, call.args.endLine)
        : startLine + 120
    const res = gateway.readTextFileRange
      ? await gateway.readTextFileRange(rel, startLine, endLine)
      : await gateway.readTextFile(rel).then((full) =>
          !full.ok
            ? full
            : {
                ok: true as const,
                content:
                  full.content === null
                    ? null
                    : full.content
                        .split(/\r?\n/)
                        .slice(startLine - 1, endLine)
                        .join('\n'),
                sha256: full.sha256,
                totalLines: full.content ? full.content.split(/\r?\n/).length : 0
              }
        )
    if (!res.ok) {
      return {
        tool: call.tool,
        ok: false,
        summary: `Failed reading range in ${rel}`,
        output: res.message,
        activityType: 'analysis.file_read',
        relativePath: rel
      }
    }
    if (res.content === null) {
      return {
        tool: call.tool,
        ok: false,
        summary: `File not found: ${rel}`,
        output: `File "${rel}" does not exist.`,
        activityType: 'analysis.file_read',
        relativePath: rel
      }
    }
    const recorded = budget.recordText(`range:${rel}:${startLine}-${endLine}`, res.content)
    return {
      tool: call.tool,
      ok: true,
      summary: `Read ${rel}:${startLine}-${endLine}`,
      output: `Range ${rel}:${startLine}-${endLine} (of ${res.totalLines} lines, sha256: ${res.sha256}):\n${recorded.text}`,
      activityType: 'analysis.file_read',
      relativePath: rel
    }
  }

  const attachmentResult = await executeAttachmentReadTool({
    call,
    conv: params.conv,
    attachmentStore: params.attachmentStore,
    budget
  })
  if (attachmentResult) {
    return attachmentResult
  }

  const searchResult = await executeWorkspaceSearchOrSymbolTool({ call, gateway, budget, signal })
  if (searchResult) {
    return searchResult
  }

  return {
    tool: call.tool,
    ok: false,
    summary: `Unknown tool "${call.tool}"`,
    output: `Unknown tool "${call.tool}".`,
    activityType: 'tool.search'
  }
}
