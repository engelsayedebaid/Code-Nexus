import { readFile, stat } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { classifySensitiveFilePath } from '../../shared/ide-agent/ide-plan-policy'
import { listWorkspaceRelativeFiles, type SafePathResolver } from './ide-workspace-tools-fs'

export type IndexedSymbolEntry = {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'component' | 'method'
  relativePath: string
  line: number
  exported: boolean
}

export type ProjectArchitectureProfile = {
  stackLabels: string[]
  packageManager: string | null
  scripts: Record<string, string>
  entryPoints: string[]
  conventions: string[]
}

const CODE_FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|java|cs|rb|php|vue|svelte)$/i
const MAX_INDEXED_FILES = 350

type CachedFileMeta = {
  mtimeMs: number
  symbols: IndexedSymbolEntry[]
  imports: string[]
}

export class WorkspaceCodeIndex {
  private readonly cache = new Map<string, CachedFileMeta>()

  constructor(
    private readonly workspacePath: string,
    private readonly resolveSafePath: SafePathResolver
  ) {}

  private extractSymbolsAndImports(
    relativePath: string,
    content: string
  ): { symbols: IndexedSymbolEntry[]; imports: string[] } {
    const symbols: IndexedSymbolEntry[] = []
    const imports: string[] = []
    const lines = content.split(/\r?\n/)

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const lineNum = i + 1

      const importMatch = line.match(
        /^\s*(?:import\b[^'"]*from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|from\s+([A-Za-z0-9_.]+)\s+import\b|require\(\s*['"]([^'"]+)['"]\s*\))/
      )
      const importSpec =
        importMatch?.[1] ?? importMatch?.[2] ?? importMatch?.[3] ?? importMatch?.[4]
      if (importSpec) {
        imports.push(importSpec)
      }

      const exported = /^\s*export\b/.test(line)
      const tsDecl = line.match(
        /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(function|class|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/
      )
      if (tsDecl) {
        const kind = tsDecl[1] as 'function' | 'class' | 'interface' | 'type'
        symbols.push({ name: tsDecl[2], kind, relativePath, line: lineNum, exported })
        continue
      }

      const constDecl = line.match(
        /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\(|React\.memo|forwardRef)/
      )
      if (constDecl) {
        const isComponent = /^[A-Z]/.test(constDecl[1])
        symbols.push({
          name: constDecl[1],
          kind: isComponent ? 'component' : 'function',
          relativePath,
          line: lineNum,
          exported
        })
        continue
      }

      const pyRustGo = line.match(
        /^\s*(?:async\s+)?(?:def|pub\s+fn|fn|pub\s+struct|struct|func)\s+([A-Za-z_][A-Za-z0-9_]*)/
      )
      if (pyRustGo) {
        symbols.push({
          name: pyRustGo[1],
          kind: line.includes('struct') ? 'class' : 'function',
          relativePath,
          line: lineNum,
          exported: line.includes('pub ') || /^[A-Z]/.test(pyRustGo[1])
        })
      }
    }
    return { symbols, imports }
  }

  private async indexFile(relativePath: string): Promise<CachedFileMeta | null> {
    if (!CODE_FILE_EXT.test(relativePath)) {
      return null
    }
    if (classifySensitiveFilePath(relativePath, 'read-context') === 'send_secret_context') {
      return null
    }
    try {
      const fullPath = await this.resolveSafePath(relativePath)
      const info = await stat(fullPath)
      if (!info.isFile() || info.size > 200 * 1024) {
        return null
      }
      const cached = this.cache.get(relativePath)
      if (cached && cached.mtimeMs === info.mtimeMs) {
        return cached
      }
      const content = await readFile(fullPath, 'utf8')
      const parsed = this.extractSymbolsAndImports(relativePath, content)
      const entry: CachedFileMeta = { mtimeMs: info.mtimeMs, ...parsed }
      this.cache.set(relativePath, entry)
      return entry
    } catch {
      return null
    }
  }

  async findSymbols(query: string, maxResults = 30): Promise<IndexedSymbolEntry[]> {
    const q = query.trim().toLowerCase()
    const { files } = await listWorkspaceRelativeFiles(this.workspacePath, {
      maxFiles: MAX_INDEXED_FILES
    })
    const results: IndexedSymbolEntry[] = []
    for (const relPath of files) {
      const meta = await this.indexFile(relPath)
      if (!meta) {
        continue
      }
      for (const sym of meta.symbols) {
        if (!q || sym.name.toLowerCase().includes(q)) {
          results.push(sym)
          if (results.length >= maxResults) {
            return results
          }
        }
      }
    }
    return results
  }

  async getImports(relativePath: string): Promise<{ imports: string[]; importedBy: string[] }> {
    const targetMeta = await this.indexFile(relativePath)
    const directImports = targetMeta?.imports ?? []
    const targetBase = relativePath.replace(/\.[^.]+$/, '')
    const importedBy: string[] = []
    const { files } = await listWorkspaceRelativeFiles(this.workspacePath, {
      maxFiles: MAX_INDEXED_FILES
    })
    for (const candidate of files) {
      if (candidate === relativePath) {
        continue
      }
      const meta = await this.indexFile(candidate)
      if (!meta) {
        continue
      }
      const candDir = dirname(candidate)
      const referencesTarget = meta.imports.some((spec) => {
        if (spec.startsWith('.')) {
          const joined = normalize(join(candDir, spec)).replaceAll('\\', '/')
          return (
            joined === targetBase || joined === relativePath || `${joined}/index` === targetBase
          )
        }
        return spec.endsWith(`/${targetBase.split('/').pop()}`)
      })
      if (referencesTarget) {
        importedBy.push(candidate)
        if (importedBy.length >= 25) {
          break
        }
      }
    }
    return { imports: directImports, importedBy }
  }
}

export async function detectProjectArchitecture(
  workspacePath: string,
  fileList: readonly string[],
  readTextFile: (
    relativePath: string
  ) => Promise<{ ok: true; content: string | null } | { ok: false }>
): Promise<ProjectArchitectureProfile> {
  const stackLabels = new Set<string>()
  const scripts: Record<string, string> = {}
  const conventions: string[] = []
  let packageManager: string | null = null

  if (fileList.includes('pnpm-lock.yaml')) {
    packageManager = 'pnpm'
  } else if (fileList.includes('bun.lockb') || fileList.includes('bun.lock')) {
    packageManager = 'bun'
  } else if (fileList.includes('yarn.lock')) {
    packageManager = 'yarn'
  } else if (fileList.includes('package-lock.json')) {
    packageManager = 'npm'
  }

  if (fileList.includes('tsconfig.json')) {
    stackLabels.add('TypeScript')
  }
  if (fileList.includes('Cargo.toml')) {
    stackLabels.add('Rust')
  }
  if (fileList.includes('pyproject.toml') || fileList.includes('requirements.txt')) {
    stackLabels.add('Python')
  }
  if (fileList.includes('go.mod')) {
    stackLabels.add('Go')
  }

  const pkgRes = fileList.includes('package.json') ? await readTextFile('package.json') : null
  if (pkgRes && pkgRes.ok && pkgRes.content) {
    try {
      const pkg = JSON.parse(pkgRes.content) as {
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
        if (typeof v === 'string') {
          scripts[k] = v
        }
      }
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if ('react' in deps) {
        stackLabels.add('React')
      }
      if ('next' in deps) {
        stackLabels.add('Next.js')
      }
      if ('electron' in deps) {
        stackLabels.add('Electron')
      }
      if ('vite' in deps) {
        stackLabels.add('Vite')
      }
      if ('vitest' in deps) {
        stackLabels.add('Vitest')
      }
      if ('jest' in deps) {
        stackLabels.add('Jest')
      }
      if ('tailwindcss' in deps) {
        stackLabels.add('Tailwind CSS')
      }
      if ('express' in deps || 'fastify' in deps) {
        stackLabels.add('Node API')
      }
    } catch {
      // Ignore malformed package.json.
    }
  }

  const entryCandidates = [
    'src/main.tsx',
    'src/main.ts',
    'src/index.tsx',
    'src/index.ts',
    'src/App.tsx',
    'src/app/page.tsx',
    'app/page.tsx',
    'index.html',
    'main.py',
    'src/main.rs',
    'main.go'
  ]
  const entryPoints = entryCandidates.filter((p) => fileList.includes(p))

  const hasFeaturesDir = fileList.some((f) => f.startsWith('src/features/'))
  const hasComponentsDir = fileList.some((f) => f.startsWith('src/components/'))
  if (hasFeaturesDir) {
    conventions.push('Feature-based structure under src/features/')
  }
  if (hasComponentsDir) {
    conventions.push('Shared UI components under src/components/')
  }
  if (fileList.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f))) {
    conventions.push('Colocated or dedicated unit tests (*.test.* / *.spec.*)')
  }
  if (!packageManager && Object.keys(scripts).length > 0) {
    packageManager = 'npm'
  }
  void relative(workspacePath, workspacePath)

  return {
    stackLabels: [...stackLabels],
    packageManager,
    scripts,
    entryPoints,
    conventions
  }
}
