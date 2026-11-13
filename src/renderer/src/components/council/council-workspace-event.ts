export const OPEN_COUNCIL_WORKSPACE_EVENT = 'code-nexus:open-council-workspace'

export type CouncilWorkspaceTarget = {
  workspaceId: string
  groupId: string
}

export function openCouncilWorkspace(target: CouncilWorkspaceTarget): void {
  window.dispatchEvent(
    new CustomEvent<CouncilWorkspaceTarget>(OPEN_COUNCIL_WORKSPACE_EVENT, { detail: target })
  )
}
