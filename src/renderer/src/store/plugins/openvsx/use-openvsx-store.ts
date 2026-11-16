import { create } from 'zustand'
import type {
  OpenVsxInstallOptions,
  OpenVsxInstallOutcome,
  OpenVsxInstalledExtension,
  OpenVsxSnippetItem
} from '../../../../../shared/openvsx/openvsx-types'

type BusyState = 'installing' | 'uninstalling' | 'toggling'

type OpenVsxStoreState = {
  installed: OpenVsxInstalledExtension[]
  snippets: OpenVsxSnippetItem[]
  loaded: boolean
  loadingInstalled: boolean
  busyById: Record<string, BusyState>
  error: string | null
  loadInstalled: () => Promise<void>
  installExtension: (options: OpenVsxInstallOptions) => Promise<OpenVsxInstallOutcome | null>
  uninstallExtension: (extensionId: string) => Promise<boolean>
  setExtensionEnabled: (extensionId: string, enabled: boolean) => Promise<void>
  clearError: () => void
}

let listenerRegistered = false

export function ensureOpenVsxStoreSubscribed(): void {
  if (listenerRegistered) {
    return
  }
  const api = window.api?.openVsx
  if (!api) {
    return
  }
  listenerRegistered = true
  api.onChanged(() => {
    void useOpenVsxStore.getState().loadInstalled()
  })
}

export const useOpenVsxStore = create<OpenVsxStoreState>((set, get) => ({
  installed: [],
  snippets: [],
  loaded: false,
  loadingInstalled: false,
  busyById: {},
  error: null,

  clearError: () => set({ error: null }),

  loadInstalled: async () => {
    ensureOpenVsxStoreSubscribed()
    const api = window.api?.openVsx
    if (!api) {
      set({ loaded: true, loadingInstalled: false })
      return
    }
    set({ loadingInstalled: true })
    try {
      const [installed, snippets] = await Promise.all([api.listInstalled(), api.listSnippets()])
      set({
        installed,
        snippets,
        loaded: true,
        loadingInstalled: false
      })
    } catch (error) {
      set({
        loaded: true,
        loadingInstalled: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },

  installExtension: async (options) => {
    ensureOpenVsxStoreSubscribed()
    const api = window.api?.openVsx
    if (!api) {
      set({ error: 'Open VSX is only available in the desktop app.' })
      return null
    }
    const key = options.extensionId.toLowerCase()
    set((state) => ({
      error: null,
      busyById: { ...state.busyById, [key]: 'installing' }
    }))
    try {
      const outcome = await api.install(options)
      await get().loadInstalled()
      return outcome
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    } finally {
      set((state) => {
        const nextBusy = { ...state.busyById }
        delete nextBusy[key]
        return { busyById: nextBusy }
      })
    }
  },

  uninstallExtension: async (extensionId) => {
    ensureOpenVsxStoreSubscribed()
    const api = window.api?.openVsx
    if (!api) {
      return false
    }
    const key = extensionId.toLowerCase()
    set((state) => ({
      error: null,
      busyById: { ...state.busyById, [key]: 'uninstalling' }
    }))
    try {
      const removed = await api.uninstall(extensionId)
      await get().loadInstalled()
      return removed
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      set((state) => {
        const nextBusy = { ...state.busyById }
        delete nextBusy[key]
        return { busyById: nextBusy }
      })
    }
  },

  setExtensionEnabled: async (extensionId, enabled) => {
    ensureOpenVsxStoreSubscribed()
    const api = window.api?.openVsx
    if (!api) {
      return
    }
    const key = extensionId.toLowerCase()
    set((state) => ({
      error: null,
      busyById: { ...state.busyById, [key]: 'toggling' }
    }))
    try {
      await api.setEnabled(extensionId, enabled)
      await get().loadInstalled()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      set((state) => {
        const nextBusy = { ...state.busyById }
        delete nextBusy[key]
        return { busyById: nextBusy }
      })
    }
  }
}))
