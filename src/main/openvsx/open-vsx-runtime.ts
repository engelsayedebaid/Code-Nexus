import { BrowserWindow, app, net } from 'electron'
import { getCanonicalUserDataPath } from '../persistence/loading-store/user-data-path'
import type { PluginService } from '../plugins/plugin-service'
import { registerOpenVsxPrimaryFetch } from './openvsx-registry-client'
import { OpenVsxService } from './openvsx-service'

let openVsxService: OpenVsxService | null = null
let registeredPluginService: PluginService | null = null
let initializationPromise: Promise<void> | null = null
let unsubscribeChanged: (() => void) | null = null

export function getOpenVsxService(): OpenVsxService | null {
  return openVsxService
}

export async function initializeMainProcessOpenVsx(
  pluginService?: PluginService | null
): Promise<OpenVsxService> {
  registerOpenVsxPrimaryFetch((url, init) =>
    app.isReady() ? net.fetch(url, init) : fetch(url, init)
  )
  if (pluginService) {
    registeredPluginService = pluginService
  }
  if (!openVsxService) {
    openVsxService = new OpenVsxService(getCanonicalUserDataPath())
  }
  unsubscribeChanged?.()
  unsubscribeChanged = openVsxService.onChanged(() => {
    registeredPluginService?.notifyAppearanceChanged()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('openvsx:changed')
      }
    }
  })

  if (!initializationPromise) {
    initializationPromise = openVsxService.initialize().catch((error) => {
      initializationPromise = null
      throw error
    })
  }
  await initializationPromise
  return openVsxService
}

export async function ensureOpenVsxService(): Promise<OpenVsxService> {
  if (openVsxService && initializationPromise) {
    await initializationPromise
    return openVsxService
  }
  return initializeMainProcessOpenVsx(registeredPluginService)
}
