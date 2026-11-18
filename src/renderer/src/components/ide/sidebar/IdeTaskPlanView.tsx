import { AppIcon } from '@/components/icons/app-icon'
import { SecuritySurface } from '@/components/ui/security-surface'
import type {
  IdeConversation,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdePermissionPromptCard } from './IdePermissionPromptCard'
import { IdePlanProposalCard } from './IdePlanProposalCard'

export function IdeTaskPlanView({
  conversation,
  providers
}: {
  conversation: IdeConversation | null
  providers: IdeProviderAgentOption[]
}) {
  const selectPlan = (conversation?.plans ?? []).slice().sort((a, b) => b.version - a.version)
  const pendingPermissions = (conversation?.pendingPermissions ?? []).filter(
    (p) => p.status === 'pending'
  )

  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2.5">
      {conversation && pendingPermissions.length > 0 ? (
        <div className="space-y-2">
          <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pending Permissions ({pendingPermissions.length})
          </div>
          {pendingPermissions.map((perm) => (
            <SecuritySurface key={perm.id}>
              <IdePermissionPromptCard permission={perm} conversationId={conversation.id} />
            </SecuritySurface>
          ))}
        </div>
      ) : null}

      {!conversation || selectPlan.length === 0 ? (
        <div className="flex h-44 flex-col items-center justify-center px-4 text-center text-xs text-muted-foreground">
          <AppIcon name="tasks" size="lg" className="mb-2 size-5 opacity-50" />
          <p className="font-medium text-foreground">No implementation plan yet</p>
          <p className="mt-1 text-2xs">
            Ask Carver in Plan or Agent mode to analyze your workspace and propose a plan before
            edits begin.
          </p>
        </div>
      ) : (
        selectPlan.map((plan) => (
          <SecuritySurface key={plan.id}>
            <IdePlanProposalCard
              plan={plan}
              conversationId={conversation.id}
              agentId={conversation.agentId}
              modelId={conversation.modelId}
              providers={providers}
            />
          </SecuritySurface>
        ))
      )}
    </div>
  )
}
