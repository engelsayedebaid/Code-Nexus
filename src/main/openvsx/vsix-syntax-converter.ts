import {
  PLUGIN_SYNTAX_GRAMMAR_MAX_BYTES,
  isPluginSyntaxMetadata,
  parsePluginGrammarArtifact,
  parsePluginLanguageConfiguration,
  parsePluginSyntaxPayload,
  validatePluginGrammarIncludes,
  type PluginGrammarArtifact,
  type PluginLanguageConfiguration,
  type PluginSyntaxMetadata,
  type PluginSyntaxPayload
} from '../../shared/plugins/artifacts/plugin-syntax-artifact'
import {
  WELL_KNOWN_LANGUAGE_EXTENSIONS,
  computeRevisionHash,
  extractStringList,
  parseJsoncObject,
  readBoundedText,
  resolveContainedExtensionPath,
  resolveNlsString,
  slugifyContribId
} from './vsix-package-manifest'
import { parseXmlPlist } from './vsix-plist-grammar-parser'

const MAX_GRAMMARS_PER_SYNTAX = 16
const SCOPE_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+$/

export type AdaptedOpenVsxSyntaxEntry = {
  metadata: PluginSyntaxMetadata
  payload: PluginSyntaxPayload
}

type VsCodeLanguageContribution = {
  id?: unknown
  aliases?: unknown
  extensions?: unknown
  filenames?: unknown
  configuration?: unknown
}

type VsCodeGrammarContribution = {
  language?: unknown
  scopeName?: unknown
  path?: unknown
  injectTo?: unknown
}

async function loadGrammarArtifact(
  extensionRootDir: string,
  relPath: string,
  expectedScopeName?: string
): Promise<PluginGrammarArtifact | null> {
  const fullPath = resolveContainedExtensionPath(extensionRootDir, relPath)
  if (!fullPath) {
    return null
  }
  const rawContent = await readBoundedText(fullPath, PLUGIN_SYNTAX_GRAMMAR_MAX_BYTES)
  if (!rawContent) {
    return null
  }

  let jsonObject = rawContent.trimStart().startsWith('<')
    ? parseXmlPlist(rawContent)
    : parseJsoncObject(rawContent)
  if (!jsonObject) {
    return null
  }

  const rawScope =
    (typeof jsonObject.scopeName === 'string' && jsonObject.scopeName.trim()) ||
    expectedScopeName?.trim() ||
    ''
  if (!SCOPE_NAME_REGEX.test(rawScope)) {
    return null
  }

  if (!Array.isArray(jsonObject.patterns)) {
    jsonObject = { ...jsonObject, patterns: [] }
  }
  jsonObject = { ...jsonObject, scopeName: rawScope }

  const serialized = JSON.stringify(jsonObject)
  if (Buffer.byteLength(serialized, 'utf8') > PLUGIN_SYNTAX_GRAMMAR_MAX_BYTES) {
    return null
  }

  return parsePluginGrammarArtifact(serialized, rawScope)
}

function normalizePairArray(raw: unknown): unknown {
  if (!Array.isArray(raw)) {
    return raw
  }
  return raw
    .map((entry) =>
      Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string'
        ? { open: entry[0], close: entry[1] }
        : entry
    )
    .filter((entry) => entry && typeof entry === 'object')
}

async function loadLanguageConfiguration(
  extensionRootDir: string,
  relPath: unknown
): Promise<PluginLanguageConfiguration> {
  const emptyConfig = parsePluginLanguageConfiguration('{}')
  if (typeof relPath !== 'string' || !relPath.trim()) {
    return emptyConfig
  }
  const fullPath = resolveContainedExtensionPath(extensionRootDir, relPath)
  if (!fullPath) {
    return emptyConfig
  }
  const rawContent = await readBoundedText(fullPath, 256 * 1024)
  if (!rawContent) {
    return emptyConfig
  }
  const parsed = parseJsoncObject(rawContent)
  if (!parsed) {
    return emptyConfig
  }

  const normalized: Record<string, unknown> = {
    ...parsed,
    ...(Array.isArray(parsed.autoClosingPairs)
      ? { autoClosingPairs: normalizePairArray(parsed.autoClosingPairs) }
      : {}),
    ...(Array.isArray(parsed.surroundingPairs)
      ? { surroundingPairs: normalizePairArray(parsed.surroundingPairs) }
      : {})
  }
  if (parsed.wordPattern && typeof parsed.wordPattern !== 'string') {
    delete normalized.wordPattern
  }

  try {
    return parsePluginLanguageConfiguration(JSON.stringify(normalized))
  } catch {
    return emptyConfig
  }
}

export async function extractVsixSyntaxes(
  extensionRootDir: string,
  pluginKey: string,
  version: string,
  rawLanguages: unknown,
  rawGrammars: unknown,
  nls: Record<string, string> | null,
  warnings: string[]
): Promise<{
  syntaxes: AdaptedOpenVsxSyntaxEntry[]
  languageExtensionsMap: Map<string, { extensions: string[]; filenames: string[] }>
}> {
  const languages = Array.isArray(rawLanguages)
    ? (rawLanguages as VsCodeLanguageContribution[])
    : []
  const grammars = Array.isArray(rawGrammars)
    ? (rawGrammars as VsCodeGrammarContribution[])
    : []

  const languageById = new Map<
    string,
    {
      id: string
      label: string
      extensions: string[]
      filenames: string[]
      configurationPath?: string
    }
  >()
  const languageExtensionsMap = new Map<string, { extensions: string[]; filenames: string[] }>()

  for (const lang of languages) {
    if (!lang || typeof lang !== 'object' || typeof lang.id !== 'string' || !lang.id.trim()) {
      continue
    }
    const id = lang.id.trim().toLowerCase()
    const aliases = extractStringList(lang.aliases).map((item) => resolveNlsString(item, nls))
    const extensions = extractStringList(lang.extensions).map((ext) =>
      ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    )
    const filenames = extractStringList(lang.filenames)
    const existing = languageById.get(id)
    if (existing) {
      existing.extensions = Array.from(new Set([...existing.extensions, ...extensions]))
      existing.filenames = Array.from(new Set([...existing.filenames, ...filenames]))
      if (!existing.configurationPath && typeof lang.configuration === 'string') {
        existing.configurationPath = lang.configuration
      }
    } else {
      languageById.set(id, {
        id,
        label: aliases[0] || id,
        extensions: Array.from(new Set(extensions)),
        filenames: Array.from(new Set(filenames)),
        configurationPath: typeof lang.configuration === 'string' ? lang.configuration : undefined
      })
    }
    languageExtensionsMap.set(id, {
      extensions: languageById.get(id)!.extensions,
      filenames: languageById.get(id)!.filenames
    })
  }

  const loadedGrammars: {
    contribution: VsCodeGrammarContribution
    artifact: PluginGrammarArtifact
  }[] = []

  for (const contrib of grammars) {
    if (!contrib || typeof contrib !== 'object' || typeof contrib.path !== 'string') {
      continue
    }
    if (
      Array.isArray(contrib.injectTo) &&
      contrib.injectTo.length > 0 &&
      typeof contrib.language !== 'string'
    ) {
      continue
    }
    const expectedScope = typeof contrib.scopeName === 'string' ? contrib.scopeName : undefined
    try {
      const artifact = await loadGrammarArtifact(extensionRootDir, contrib.path, expectedScope)
      if (artifact) {
        loadedGrammars.push({ contribution: contrib, artifact })
      }
    } catch (error) {
      warnings.push(
        `Skipped grammar "${contrib.path}": ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const syntaxes: AdaptedOpenVsxSyntaxEntry[] = []
  const seenSyntaxIds = new Set<string>()

  for (const primary of loadedGrammars) {
    const rawLangId =
      typeof primary.contribution.language === 'string'
        ? primary.contribution.language.trim().toLowerCase()
        : ''
    if (!rawLangId) {
      continue
    }

    const langInfo = languageById.get(rawLangId)
    const fallbackExts = WELL_KNOWN_LANGUAGE_EXTENSIONS[rawLangId] ?? []
    const extensions = langInfo?.extensions.length ? langInfo.extensions : [...fallbackExts]
    const filenames = langInfo?.filenames ?? []
    if (extensions.length === 0 && filenames.length === 0) {
      continue
    }

    const slug = slugifyContribId(`syntax-${rawLangId}`, `syntax-${syntaxes.length}`)
    const id: `plugin:${string}` = `plugin:${pluginKey}/${slug}`
    if (seenSyntaxIds.has(id)) {
      continue
    }
    seenSyntaxIds.add(id)

    const siblingGrammars: PluginGrammarArtifact[] = [primary.artifact]
    const seenScopes = new Set<string>([primary.artifact.scopeName])
    for (const candidate of loadedGrammars) {
      if (siblingGrammars.length >= MAX_GRAMMARS_PER_SYNTAX) {
        break
      }
      if (!seenScopes.has(candidate.artifact.scopeName)) {
        seenScopes.add(candidate.artifact.scopeName)
        siblingGrammars.push(candidate.artifact)
      }
    }

    let finalGrammars = siblingGrammars
    try {
      validatePluginGrammarIncludes(finalGrammars)
    } catch {
      try {
        validatePluginGrammarIncludes([primary.artifact])
        finalGrammars = [primary.artifact]
      } catch (innerError) {
        warnings.push(
          `Skipped syntax "${rawLangId}": ${innerError instanceof Error ? innerError.message : String(innerError)}`
        )
        continue
      }
    }

    const configuration = await loadLanguageConfiguration(
      extensionRootDir,
      langInfo?.configurationPath
    )
    const revision = computeRevisionHash(
      `${version}:${id}:${primary.artifact.scopeName}:${extensions.join(',')}`
    )
    const metadataCandidate: PluginSyntaxMetadata = {
      id,
      pluginKey,
      label: langInfo?.label || rawLangId,
      extensions,
      filenames,
      revision
    }
    const payloadCandidate = parsePluginSyntaxPayload({
      id,
      revision,
      scopeName: primary.artifact.scopeName,
      grammars: finalGrammars,
      configuration
    })

    if (isPluginSyntaxMetadata(metadataCandidate) && payloadCandidate) {
      syntaxes.push({ metadata: metadataCandidate, payload: payloadCandidate })
    }
  }

  return { syntaxes, languageExtensionsMap }
}
