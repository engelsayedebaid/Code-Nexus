import type { App } from 'electron'
import { APP_BRAND_PROTOCOL_SCHEME } from '../../shared/app-brand'

/**
 * Registers the app's link scheme with Windows, which NSIS installs leave unregistered; macOS reads
 * it from Info.plist and Linux packages from the desktop entry. Only packaged desktop launches
 * register, so dev, test and serve runs never take over the machine's handler.
 */
export function registerOrcaProtocolClient(
  app: Pick<App, 'isPackaged' | 'isDefaultProtocolClient' | 'setAsDefaultProtocolClient'>,
  options: { platform: NodeJS.Platform; desktopLaunch: boolean }
): boolean {
  if (options.platform !== 'win32' || !app.isPackaged || !options.desktopLaunch) {
    return false
  }
  if (app.isDefaultProtocolClient(APP_BRAND_PROTOCOL_SCHEME)) {
    return false
  }
  try {
    return app.setAsDefaultProtocolClient(APP_BRAND_PROTOCOL_SCHEME)
  } catch (error) {
    console.warn(`[protocol] Failed to register ${APP_BRAND_PROTOCOL_SCHEME}:// links:`, error)
    return false
  }
}
