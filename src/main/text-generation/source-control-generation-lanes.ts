import type { TextGenerationOperation } from './source-control-text-generation-types'

export type LocalGenerationStdoutListener = (stdout: string) => void

const cancelTokensByLane = new Map<string, () => void>()
const stdoutListenersByLane = new Map<string, LocalGenerationStdoutListener>()

export function localGenerationLaneKey(
  operation: TextGenerationOperation,
  cwd: string,
  laneId?: string
): string {
  return `${operation}:local:${cwd}${laneId ? `:${laneId}` : ''}`
}

export function cancelLocalGeneration(
  operation: TextGenerationOperation,
  cwd: string,
  laneId?: string
): void {
  cancelTokensByLane.get(localGenerationLaneKey(operation, cwd, laneId))?.()
}

export function setLocalGenerationCancelToken(laneKey: string, cancel: () => void): void {
  cancelTokensByLane.set(laneKey, cancel)
}

export function clearLocalGenerationCancelToken(laneKey: string, cancel: () => void): void {
  if (cancelTokensByLane.get(laneKey) === cancel) {
    cancelTokensByLane.delete(laneKey)
  }
}

export function setLocalGenerationStdoutListener(
  laneKey: string,
  listener: LocalGenerationStdoutListener
): void {
  stdoutListenersByLane.set(laneKey, listener)
}

export function clearLocalGenerationStdoutListener(
  laneKey: string,
  listener: LocalGenerationStdoutListener
): void {
  if (stdoutListenersByLane.get(laneKey) === listener) {
    stdoutListenersByLane.delete(laneKey)
  }
}

export function notifyLocalGenerationStdout(laneKey: string, stdout: string): void {
  stdoutListenersByLane.get(laneKey)?.(stdout)
}
