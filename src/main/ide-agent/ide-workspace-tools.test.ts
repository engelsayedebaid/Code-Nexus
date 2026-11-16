import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { LocalIdeWorkspaceGateway, sha256Text } from './ide-workspace-gateway'

const createdDirs: string[] = []

async function makeTempWorkspace(): Promise<{ dir: string; gateway: LocalIdeWorkspaceGateway }> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-ide-ws-tools-'))
  createdDirs.push(dir)
  const gateway = new LocalIdeWorkspaceGateway({
    worktreeId: 'wt-tools-test',
    workspacePath: dir,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  })
  return { dir, gateway }
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('LocalIdeWorkspaceGateway full filesystem & intel control', () => {
  it('creates nested directories, writes atomically, patches, renames, and deletes folders', async () => {
    const { dir, gateway } = await makeTempWorkspace()

    const blockedReadonly = await gateway.createDirectory('src/features/auth', { mode: 'plan' })
    expect(blockedReadonly.ok).toBe(false)

    const mkdirRes = await gateway.createDirectory('src/features/auth', { mode: 'agent' })
    expect(mkdirRes).toEqual({ ok: true, relativePath: 'src/features/auth', created: true })

    const writeRes = await gateway.writeTextChunk(
      'src/features/auth/login.ts',
      'export function loginUser(name: string) {\n  return name.trim()\n}\n',
      { mode: 'agent', expectedBeforeSha: null }
    )
    expect(writeRes.ok).toBe(true)
    if (!writeRes.ok) {
      return
    }

    const patchRes = await gateway.applyFilePatches(
      'src/features/auth/login.ts',
      [{ search: 'return name.trim()', replace: 'return name.trim().toLowerCase()' }],
      { mode: 'agent', expectedBeforeSha: writeRes.sha256 }
    )
    expect(patchRes.ok).toBe(true)
    expect(await readFile(join(dir, 'src/features/auth/login.ts'), 'utf8')).toContain(
      'toLowerCase()'
    )

    const renameRes = await gateway.renamePath(
      'src/features/auth/login.ts',
      'src/features/auth/signIn.ts',
      { mode: 'agent' }
    )
    expect(renameRes).toEqual({
      ok: true,
      fromRelativePath: 'src/features/auth/login.ts',
      toRelativePath: 'src/features/auth/signIn.ts',
      isDirectory: false
    })

    const rmDirRes = await gateway.deleteDirectory('src/features/auth', {
      mode: 'agent',
      recursive: true
    })
    expect(rmDirRes).toEqual({ ok: true, relativePath: 'src/features/auth' })
  })

  it('prevents SHA-256 disk conflicts, dirty editor overwrites, traversal, and unapproved secret reads', async () => {
    const { dir, gateway } = await makeTempWorkspace()
    await writeFile(join(dir, 'app.ts'), 'const v = 1\n', 'utf8')
    await writeFile(join(dir, '.env.local'), 'SECRET=topsecret\n', 'utf8')

    const dirtyBlocked = await gateway.writeTextChunk('app.ts', 'const v = 2\n', {
      mode: 'agent',
      expectedBeforeSha: sha256Text('const v = 1\n'),
      dirtyRelativePaths: new Set(['app.ts'])
    })
    expect(dirtyBlocked.ok).toBe(false)
    if (!dirtyBlocked.ok) {
      expect(dirtyBlocked.reason).toBe('dirty_conflict')
    }

    await writeFile(join(dir, 'app.ts'), 'const v = 999\n', 'utf8')
    const conflictRes = await gateway.writeTextChunk('app.ts', 'const v = 2\n', {
      mode: 'agent',
      expectedBeforeSha: sha256Text('const v = 1\n')
    })
    expect(conflictRes.ok).toBe(false)
    if (!conflictRes.ok) {
      expect(conflictRes.reason).toBe('disk_conflict')
    }

    const traversal = await gateway.readTextFile('../outside.txt')
    expect(traversal.ok).toBe(false)
    if (!traversal.ok) {
      expect(traversal.reason).toBe('unsafe_path')
    }

    const secretRead = await gateway.readTextFile('.env.local')
    expect(secretRead.ok).toBe(false)
    if (!secretRead.ok) {
      expect(secretRead.reason).toBe('secret_blocked')
    }
  })

  it('indexes symbols, resolves imports/reverse imports, searches files and code, and reads line ranges', async () => {
    const { dir, gateway } = await makeTempWorkspace()
    await gateway.createDirectory('src/auth', { mode: 'agent' })
    await writeFile(
      join(dir, 'src/auth/validator.ts'),
      'export function validateEmail(email: string): boolean {\n  return email.includes("@")\n}\n',
      'utf8'
    )
    await writeFile(
      join(dir, 'src/auth/LoginForm.ts'),
      "import { validateEmail } from './validator'\nexport const LoginForm = () => validateEmail('a@b.com')\n",
      'utf8'
    )

    const files = await gateway.searchFiles('login')
    expect(files).toEqual(['src/auth/LoginForm.ts'])

    const codeHits = await gateway.searchCode('validateEmail')
    expect(codeHits.length).toBeGreaterThanOrEqual(2)

    const symbols = await gateway.findSymbols('validateEmail')
    expect(
      symbols.some((s) => s.name === 'validateEmail' && s.relativePath === 'src/auth/validator.ts')
    ).toBe(true)

    const imports = await gateway.getImports('src/auth/LoginForm.ts')
    expect(imports.imports).toContain('./validator')

    const reverseImports = await gateway.getImports('src/auth/validator.ts')
    expect(reverseImports.importedBy).toContain('src/auth/LoginForm.ts')

    const range = await gateway.readTextFileRange('src/auth/validator.ts', 1, 2)
    expect(range.ok).toBe(true)
    if (range.ok) {
      expect(range.totalLines).toBe(4)
      expect(range.content).toContain('1: export function validateEmail')
    }
  })
})
