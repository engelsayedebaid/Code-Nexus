import type { OpenVsxSnippetItem } from '../../shared/openvsx/openvsx-types'
import {
  WELL_KNOWN_LANGUAGE_EXTENSIONS,
  extractStringList,
  parseJsoncObject,
  readBoundedText,
  resolveContainedExtensionPath
} from './vsix-package-manifest'

const MAX_SNIPPETS_PER_EXTENSION = 2_500

type VsCodeSnippetContribution = {
  language?: unknown
  path?: unknown
}

export async function extractVsixSnippets(
  extensionRootDir: string,
  extensionId: string,
  rawSnippets: unknown,
  languageExtensionsMap: Map<string, { extensions: string[]; filenames: string[] }>,
  warnings: string[]
): Promise<OpenVsxSnippetItem[]> {
  if (!Array.isArray(rawSnippets)) {
    return []
  }

  const items: OpenVsxSnippetItem[] = []
  for (const entry of rawSnippets as VsCodeSnippetContribution[]) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
      continue
    }
    const fullPath = resolveContainedExtensionPath(extensionRootDir, entry.path)
    if (!fullPath) {
      continue
    }
    const rawContent = await readBoundedText(fullPath, 2 * 1024 * 1024)
    if (!rawContent) {
      continue
    }
    const parsed = parseJsoncObject(rawContent)
    if (!parsed) {
      warnings.push(`Could not parse snippet file "${entry.path}"`)
      continue
    }

    const language =
      typeof entry.language === 'string' && entry.language.trim()
        ? entry.language.trim().toLowerCase()
        : 'plaintext'
    const langAssoc = languageExtensionsMap.get(language)
    const fallbackExts = WELL_KNOWN_LANGUAGE_EXTENSIONS[language] ?? []
    const extensions = langAssoc?.extensions.length ? langAssoc.extensions : [...fallbackExts]
    const filenames = langAssoc?.filenames ?? []

    for (const [snippetName, rawSnippet] of Object.entries(parsed)) {
      if (items.length >= MAX_SNIPPETS_PER_EXTENSION) {
        break
      }
      if (!rawSnippet || typeof rawSnippet !== 'object') {
        continue
      }
      const snippetObj = rawSnippet as {
        prefix?: unknown
        body?: unknown
        description?: unknown
      }
      const prefixes =
        typeof snippetObj.prefix === 'string'
          ? [snippetObj.prefix.trim()]
          : extractStringList(snippetObj.prefix)
      const validPrefixes = prefixes.filter((prefix) => prefix.length > 0)
      if (validPrefixes.length === 0) {
        continue
      }

      let body = ''
      if (typeof snippetObj.body === 'string') {
        body = snippetObj.body
      } else if (Array.isArray(snippetObj.body)) {
        body = snippetObj.body.filter((line): line is string => typeof line === 'string').join('\n')
      }
      if (!body) {
        continue
      }

      items.push({
        extensionId,
        language,
        extensions,
        filenames,
        name: snippetName,
        prefixes: validPrefixes,
        body,
        description:
          typeof snippetObj.description === 'string' ? snippetObj.description.trim() : snippetName
      })
    }
  }

  return items
}
