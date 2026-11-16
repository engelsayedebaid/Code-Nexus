import { useSyncExternalStore } from 'react'

export type IdeRunDestination = 'bottom' | 'external'

export type IdeRunPreference = {
  destination: IdeRunDestination
  shell: string
}

const STORAGE_KEY = 'orca:ide-run-preference'
const DEFAULT_PREFERENCE: IdeRunPreference = { destination: 'bottom', shell: 'default' }
const listeners = new Set<() => void>()

function readStoredPreference(): IdeRunPreference {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_PREFERENCE
    }
    const parsed = JSON.parse(raw) as Partial<IdeRunPreference>
    const destination: IdeRunDestination = parsed.destination === 'external' ? 'external' : 'bottom'
    const shell = typeof parsed.shell === 'string' && parsed.shell.trim() ? parsed.shell : 'default'
    return { destination, shell }
  } catch {
    return DEFAULT_PREFERENCE
  }
}

let currentPreference: IdeRunPreference = readStoredPreference()

function persistAndNotify(next: IdeRunPreference): void {
  if (
    next.destination === currentPreference.destination &&
    next.shell === currentPreference.shell
  ) {
    return
  }
  currentPreference = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore restricted storage; keep in-memory selection synced across open headers.
  }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): IdeRunPreference {
  return currentPreference
}

export function setIdeRunDestination(destination: IdeRunDestination): void {
  persistAndNotify({ ...currentPreference, destination })
}

export function setIdeRunShell(shell: string): void {
  persistAndNotify({ ...currentPreference, shell })
}

/** Reactive handle for the persisted IDE run destination and shell choice. */
export function useIdeRunPreference(): IdeRunPreference {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCE)
}
