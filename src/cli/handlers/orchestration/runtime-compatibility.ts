import { RuntimeClientError } from '../../runtime-client'
import { APP_BRAND } from '../../../shared/app-brand'

const COMPATIBILITY_CLI_COMMANDS = ['orca', 'orca-ide', 'orca-dev', APP_BRAND.cliCommandName]

export function resolveCompatibilityCliCommand(): string {
  const configured = process.env.ORCA_CLI_COMMAND
  if (configured && COMPATIBILITY_CLI_COMMANDS.includes(configured)) {
    return configured
  }
  if (process.platform === 'linux') {
    return 'orca-ide'
  }
  return process.platform === 'win32' ? APP_BRAND.cliCommandName : 'orca'
}

export function resolvePackagedWindowsCompatibilityCommand(): string | undefined {
  if (process.env.ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.ORCA_CLI_COMMAND
  if (command && COMPATIBILITY_CLI_COMMANDS.includes(command)) {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Orca launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.ORCA_DEV_CLI_INVOCATION === '1' ||
    (process.env.ORCA_USER_DATA_PATH?.includes('orca-dev') ?? false)
  )
}
