const PROVIDER_FILTER_KEY = 'orca.ide-model-picker.provider.v1'
const SORT_KEY = 'orca.ide-model-picker.sort.v1'
const RECENT_KEY = 'orca.ide-model-picker.recent.v1'
const MAX_RECENT = 8

export type IdeModelPickerSort = 'provider' | 'name' | 'recent'

const SORTS: readonly IdeModelPickerSort[] = ['provider', 'name', 'recent']

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable; picker still works for the session.
  }
}

export function readModelPickerProviderFilter(): string {
  const value = readStorage(PROVIDER_FILTER_KEY)
  return value && value !== 'all' ? value : 'all'
}

export function writeModelPickerProviderFilter(providerId: string): void {
  writeStorage(PROVIDER_FILTER_KEY, providerId)
}

export function readModelPickerSort(): IdeModelPickerSort {
  const value = readStorage(SORT_KEY)
  return SORTS.includes(value as IdeModelPickerSort) ? (value as IdeModelPickerSort) : 'provider'
}

export function writeModelPickerSort(sort: IdeModelPickerSort): void {
  writeStorage(SORT_KEY, sort)
}

export function readModelPickerRecents(): readonly string[] {
  try {
    const saved: unknown = JSON.parse(readStorage(RECENT_KEY) ?? '[]')
    if (!Array.isArray(saved)) {
      return []
    }
    return saved.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function recordModelPickerRecent(value: string): void {
  const next = [value, ...readModelPickerRecents().filter((v) => v !== value)].slice(0, MAX_RECENT)
  writeStorage(RECENT_KEY, JSON.stringify(next))
}
