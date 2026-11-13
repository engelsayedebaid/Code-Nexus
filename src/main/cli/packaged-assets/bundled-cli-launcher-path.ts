import { join } from 'node:path'
import { APP_BRAND } from '../../../shared/app-brand'

// Why `orca-ide` on Linux: GNOME Orca ships /usr/bin/orca, so the CLI never claims that name.
export const LINUX_CLI_COMMAND_NAME = 'orca-ide'

// Keep path-only callers independent of cli-installer's Electron dependency.
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'orca')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_CLI_COMMAND_NAME)
  }
  if (platform === 'win32') {
    // Forks ship a distinct command name so both apps' resources\bin can sit on PATH.
    return join(resourcesPath, 'bin', `${APP_BRAND.cliCommandName}.exe`)
  }
  return null
}
