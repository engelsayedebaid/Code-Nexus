import { createContext, useContext } from 'react'
import type { MultiModelChatController } from './use-multi-model-chat'

/**
 * Owns the inline multi-model conversation of one chat tab. Present only in the
 * normal chat surface; the Council workspace and structured hosts keep their own paths.
 */
export const MultiModelChatContext = createContext<MultiModelChatController | null>(null)

export function useMultiModelChatContext(): MultiModelChatController | null {
  return useContext(MultiModelChatContext)
}
