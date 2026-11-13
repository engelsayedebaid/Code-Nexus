import type {
  CouncilGenerationResult,
  CouncilParticipant
} from '../../../../shared/council/council-contract'
import { runCouncilGenerateRpc } from './council-session-execution'

export type CouncilGenerationArgs = {
  workspaceId: string
  operationId: string
  participant: CouncilParticipant
  prompt: string
  onDelta?: (text: string) => void
}

/** Runs one provider turn while keeping its operation id cancelable. */
export async function runTrackedCouncilGeneration(
  args: CouncilGenerationArgs,
  operationIds: Set<string>
): Promise<CouncilGenerationResult> {
  operationIds.add(args.operationId)
  try {
    return await runCouncilGenerateRpc(args)
  } finally {
    operationIds.delete(args.operationId)
  }
}
