/** Maps VS Code languageIds to common file extensions so icon themes using `languageIds` (like Material Icon Theme) apply accurately. */
export const VSCODE_LANGUAGE_ID_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  scss: ['scss'],
  sass: ['sass'],
  less: ['less'],
  postcss: ['pcss', 'postcss'],
  javascript: ['js', 'mjs', 'cjs'],
  javascriptreact: ['jsx'],
  typescript: ['ts', 'mts', 'cts'],
  typescriptreact: ['tsx'],
  json: ['json'],
  jsonc: ['jsonc'],
  json5: ['json5'],
  markdown: ['md', 'mdx', 'markdown'],
  mdx: ['mdx'],
  python: ['py', 'pyi', 'pyw'],
  rust: ['rs'],
  go: ['go'],
  java: ['java'],
  kotlin: ['kt', 'kts'],
  scala: ['scala'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
  csharp: ['cs'],
  fsharp: ['fs', 'fsx'],
  php: ['php'],
  ruby: ['rb', 'erb'],
  perl: ['pl', 'pm'],
  lua: ['lua'],
  r: ['r', 'rmd'],
  julia: ['jl'],
  dart: ['dart'],
  swift: ['swift'],
  objectivec: ['m', 'mm'],
  shellscript: ['sh', 'bash', 'zsh'],
  powershell: ['ps1', 'psm1', 'psd1'],
  bat: ['bat', 'cmd'],
  yaml: ['yml', 'yaml'],
  toml: ['toml'],
  ini: ['ini', 'cfg', 'conf'],
  properties: ['properties', 'env'],
  xml: ['xml', 'csproj', 'fsproj', 'vbproj', 'props', 'targets', 'plist'],
  svg: ['svg'],
  sql: ['sql'],
  graphql: ['graphql', 'gql'],
  prisma: ['prisma'],
  proto3: ['proto'],
  vue: ['vue'],
  svelte: ['svelte'],
  astro: ['astro'],
  handlebars: ['hbs', 'handlebars'],
  pug: ['pug', 'jade'],
  ejs: ['ejs'],
  twig: ['twig'],
  liquid: ['liquid'],
  elixir: ['ex', 'exs'],
  erlang: ['erl', 'hrl'],
  clojure: ['clj', 'cljs', 'cljc'],
  haskell: ['hs'],
  zig: ['zig'],
  nim: ['nim'],
  solidity: ['sol'],
  terraform: ['tf', 'tfvars'],
  tex: ['tex'],
  latex: ['tex', 'sty'],
  jupyter: ['ipynb'],
  diff: ['diff', 'patch']
}

export const VSCODE_LANGUAGE_ID_FILENAMES: Readonly<Record<string, readonly string[]>> = {
  dockerfile: ['dockerfile', 'containerfile'],
  makefile: ['makefile', 'gnumakefile'],
  cmake: ['cmakelists.txt'],
  ignore: ['.gitignore', '.dockerignore', '.npmignore']
}

export const PRIORITY_EXT_SET: ReadonlySet<string> = new Set(
  [
    'ts tsx js jsx mjs cjs mts cts d.ts json jsonc json5 html htm css scss sass less',
    'md mdx py go rs java kt kts c cpp cc h hpp cs php rb swift dart vue svelte astro',
    'yaml yml toml xml svg png jpg jpeg gif webp ico sql graphql gql prisma proto',
    'sh bash zsh ps1 bat cmd dockerfile lock log env txt csv pdf zip wasm lua r scala',
    'ex exs clj zig sol tf hcl ini conf ttf otf woff woff2'
  ]
    .join(' ')
    .split(/\s+/)
)

export const PRIORITY_FOLDER_SET: ReadonlySet<string> = new Set(
  [
    'src source app apps packages components ui pages views screens layouts routes router',
    'api server backend client frontend web renderer main preload shared common core',
    'lib libs utils helpers hooks store state context services controllers models schemas',
    'types interfaces styles css sass assets images img icons fonts media public static',
    'resources docs doc design scripts tools bin config configs settings test tests __tests__',
    'spec specs e2e fixtures mocks dist build out target coverage node_modules vendor',
    '.git .github .vscode prisma migrations database db supabase docker i18n locales lang',
    'plugins extensions middleware auth security features modules widgets'
  ]
    .join(' ')
    .split(/\s+/)
)

export const PRIORITY_FILE_SET: ReadonlySet<string> = new Set(
  [
    'manifest.json package.json package-lock.json pnpm-lock.yaml pnpm-workspace.yaml yarn.lock',
    'bun.lockb bun.lock tsconfig.json tsconfig.base.json jsconfig.json vite.config.ts vite.config.js',
    'electron.vite.config.ts vitest.config.ts next.config.js next.config.mjs next.config.ts',
    'tailwind.config.js tailwind.config.ts postcss.config.js postcss.config.mjs eslint.config.js',
    'eslint.config.mjs .eslintrc.json .oxlintrc.json .prettierrc .gitignore .gitattributes',
    '.dockerignore .editorconfig .nvmrc .env .env.local .env.development .env.production .env.example',
    'dockerfile docker-compose.yml docker-compose.yaml makefile readme.md changelog.md contributing.md',
    'agents.md claude.md license license.md cargo.toml cargo.lock go.mod go.sum pyproject.toml',
    'requirements.txt gemfile composer.json index.html styles.css main.css favicon.ico'
  ]
    .join(' ')
    .split(/\s+/)
)

export function isPlainIconRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function prioritizeIconEntries(
  source: unknown,
  normalizeKey: (key: string) => string,
  prioritySet: ReadonlySet<string>,
  preferShorterKeys = false
): [string, unknown][] {
  if (!isPlainIconRecord(source)) {
    return []
  }
  const normalized: [string, unknown][] = []
  for (const [rawKey, defId] of Object.entries(source)) {
    const key = normalizeKey(rawKey)
    if (key) {
      normalized.push([key, defId])
    }
  }
  return normalized.sort(([a], [b]) => {
    const prioDiff = (prioritySet.has(a) ? 0 : 1) - (prioritySet.has(b) ? 0 : 1)
    if (prioDiff !== 0) {
      return prioDiff
    }
    return preferShorterKeys ? a.length - b.length : 0
  })
}

/** Inlines simple `<style>.cls{fill:#...}</style>` rules onto matching `class="..."` elements so strict SVG sanitizers retain icon fills. */
export function inlineSimpleSvgClassStyles(rawSvg: string): string {
  const styleMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(rawSvg)
  if (!styleMatch) {
    return rawSvg
  }
  const rules = new Map<string, string>()
  for (const match of styleMatch[1].matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]+)\}/g)) {
    const cls = match[1]
    const body = match[2].trim().replace(/;+\s*$/, '')
    if (cls && body && !/[<>]/.test(body)) {
      rules.set(cls, body)
    }
  }
  const withoutStyle = rawSvg.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  if (rules.size === 0) {
    return withoutStyle
  }
  return withoutStyle.replace(/\bclass=(["'])([^"']+)\1/g, (_full, _q, classList: string) => {
    const declarations = classList
      .trim()
      .split(/\s+/)
      .map((name) => rules.get(name))
      .filter((decl): decl is string => Boolean(decl))
    return declarations.length > 0 ? `style="${declarations.join(';')}"` : ''
  })
}
