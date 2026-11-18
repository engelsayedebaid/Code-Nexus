import { describe, expect, it } from 'vitest'
import { buildIdeFileRunCommand, getIdeFileRunnerSpec } from './ide-file-runner'

describe('ide-file-runner', () => {
  it('builds shell-appropriate HTML launch commands across PowerShell, cmd, and POSIX', () => {
    expect(buildIdeFileRunCommand('C:\\proj\\index.html', 'html', 'powershell')).toBe(
      "Start-Process -FilePath 'C:\\proj\\index.html'"
    )
    expect(buildIdeFileRunCommand('C:\\proj\\index.html', 'html', 'cmd')).toBe(
      'start "" "C:\\proj\\index.html"'
    )
    expect(buildIdeFileRunCommand('/workspace/index.html', 'html', 'posix')).toBe(
      "(command -v open >/dev/null 2>&1 && open '/workspace/index.html' || xdg-open '/workspace/index.html')"
    )
  })

  it('supports direct TypeScript runners and npx --yes tsx fallback', () => {
    const spec = getIdeFileRunnerSpec('C:\\proj\\script.ts', 'typescript', 'powershell')
    expect(spec?.candidates).toEqual(['tsx', 'bun', 'npx'])
    expect(spec?.buildCommand('tsx')).toBe("tsx 'C:\\proj\\script.ts'")
    expect(spec?.buildCommand('npx')).toBe("npx '--yes' 'tsx' 'C:\\proj\\script.ts'")
  })

  it('supports JavaScript and Python file execution', () => {
    expect(buildIdeFileRunCommand('/app/main.js', 'javascript', 'posix')).toBe(
      "node '/app/main.js'"
    )
    expect(buildIdeFileRunCommand('C:\\app\\main.py', 'python', 'powershell')).toBe(
      "python 'C:\\app\\main.py'"
    )
  })
})
