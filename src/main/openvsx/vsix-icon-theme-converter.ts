import path from 'node:path'
import {
  PLUGIN_ICON_SVG_MAX_BYTES,
  PLUGIN_ICON_THEME_MAX_SVGS,
  isPlausiblePluginIconSvg,
  isPluginIconThemeRegistration,
  type PluginIconThemeMetadata,
  type PluginIconThemeRegistration
} from '../../shared/plugins/artifacts/plugin-icon-theme-artifact'
import {
  PRIORITY_EXT_SET,
  PRIORITY_FILE_SET,
  PRIORITY_FOLDER_SET,
  VSCODE_LANGUAGE_ID_EXTENSIONS,
  VSCODE_LANGUAGE_ID_FILENAMES,
  inlineSimpleSvgClassStyles,
  isPlainIconRecord,
  prioritizeIconEntries
} from './vsix-icon-theme-data'
import {
  computeRevisionHash,
  parseJsoncObject,
  readBoundedText,
  resolveContainedExtensionPath,
  resolveNlsString,
  slugifyContribId
} from './vsix-package-manifest'

export type AdaptedOpenVsxIconThemeEntry = {
  metadata: PluginIconThemeMetadata
  registration: PluginIconThemeRegistration
}

function setSafeIndex(target: Record<string, number>, key: string, value: number): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

async function convertSingleIconTheme(
  extensionRootDir: string,
  pluginKey: string,
  version: string,
  entry: unknown,
  index: number,
  nls: Record<string, string> | null,
  usedSlugs: Set<string>,
  warnings: string[]
): Promise<AdaptedOpenVsxIconThemeEntry | null> {
  if (!isPlainIconRecord(entry) || typeof entry.path !== 'string') {
    return null
  }
  const themeFilePath = resolveContainedExtensionPath(extensionRootDir, entry.path)
  if (!themeFilePath) {
    return null
  }
  const rawThemeContent = await readBoundedText(themeFilePath, 4 * 1024 * 1024)
  if (!rawThemeContent) {
    return null
  }
  const parsedTheme = parseJsoncObject(rawThemeContent)
  if (!parsedTheme) {
    warnings.push(`Could not parse icon theme "${entry.path}"`)
    return null
  }

  const iconDefs = isPlainIconRecord(parsedTheme.iconDefinitions)
    ? parsedTheme.iconDefinitions
    : null
  if (!iconDefs) {
    return null
  }

  const label = resolveNlsString(entry.label, nls) || `Icons ${index + 1}`
  const slug = slugifyContribId(
    typeof entry.id === 'string' && entry.id.trim() ? entry.id : label,
    `icons-${index}`,
    usedSlugs
  )
  const id: `plugin:${string}` = `plugin:${pluginKey}/${slug}`
  const themeBaseDir = path.dirname(themeFilePath)

  const svgs: string[] = []
  const defIdToSvgIndex = new Map<string, number>()

  const resolveIconIndex = async (defId: unknown): Promise<number | undefined> => {
    if (typeof defId !== 'string' || !Object.hasOwn(iconDefs, defId)) {
      return undefined
    }
    const existingIndex = defIdToSvgIndex.get(defId)
    if (existingIndex !== undefined) {
      return existingIndex
    }
    if (svgs.length >= PLUGIN_ICON_THEME_MAX_SVGS) {
      return undefined
    }
    const def = iconDefs[defId]
    if (!isPlainIconRecord(def) || typeof def.iconPath !== 'string') {
      return undefined
    }
    const iconRelToRoot = path.relative(extensionRootDir, path.resolve(themeBaseDir, def.iconPath))
    const resolvedIcon = resolveContainedExtensionPath(extensionRootDir, iconRelToRoot)
    if (!resolvedIcon || path.extname(resolvedIcon).toLowerCase() !== '.svg') {
      return undefined
    }
    const rawSvg = await readBoundedText(resolvedIcon, PLUGIN_ICON_SVG_MAX_BYTES)
    if (!rawSvg) {
      return undefined
    }
    const svgContent = inlineSimpleSvgClassStyles(rawSvg)
    if (!isPlausiblePluginIconSvg(svgContent) || svgContent.length > PLUGIN_ICON_SVG_MAX_BYTES) {
      return undefined
    }
    const nextIndex = svgs.length
    svgs.push(svgContent)
    defIdToSvgIndex.set(defId, nextIndex)
    return nextIndex
  }

  const applyPairs = async (
    target: Record<string, number>,
    pairs: readonly [string, unknown][],
    overwrite = true
  ): Promise<void> => {
    for (const [key, defId] of pairs) {
      if (!overwrite && Object.hasOwn(target, key)) {
        continue
      }
      const idx = await resolveIconIndex(defId)
      if (idx !== undefined) {
        setSafeIndex(target, key, idx)
      }
    }
  }

  const icons: Partial<Record<'file' | 'folder' | 'folder-open', number>> = {}
  for (const [slot, rawRef] of [
    ['file', parsedTheme.file],
    ['folder', parsedTheme.folder],
    ['folder-open', parsedTheme.folderExpanded]
  ] as const) {
    const idx = await resolveIconIndex(rawRef)
    if (idx !== undefined) {
      icons[slot] = idx
    }
  }

  const fileExtensions: Record<string, number> = {}
  const fileNames: Record<string, number> = {}
  const folderNames: Record<string, number> = {}
  const folderNamesExpanded: Record<string, number> = {}

  const extPairs = prioritizeIconEntries(
    parsedTheme.fileExtensions,
    (k) => k.trim().replace(/^\.+/, '').toLowerCase(),
    PRIORITY_EXT_SET,
    true
  )
  const filePairs = prioritizeIconEntries(
    parsedTheme.fileNames,
    (k) => k.trim().toLowerCase(),
    PRIORITY_FILE_SET
  )
  const folderPairs = prioritizeIconEntries(
    parsedTheme.folderNames,
    (k) => k.trim().toLowerCase(),
    PRIORITY_FOLDER_SET
  )
  const folderOpenPairs = prioritizeIconEntries(
    parsedTheme.folderNamesExpanded,
    (k) => k.trim().toLowerCase(),
    PRIORITY_FOLDER_SET
  )

  // Tier 1: High-priority everyday extensions, filenames, folders, and VS Code languageIds first.
  await applyPairs(
    fileExtensions,
    extPairs.filter(([k]) => PRIORITY_EXT_SET.has(k))
  )
  await applyPairs(
    fileNames,
    filePairs.filter(([k]) => PRIORITY_FILE_SET.has(k))
  )
  await applyPairs(
    folderNames,
    folderPairs.filter(([k]) => PRIORITY_FOLDER_SET.has(k))
  )
  await applyPairs(
    folderNamesExpanded,
    folderOpenPairs.filter(([k]) => PRIORITY_FOLDER_SET.has(k))
  )

  if (isPlainIconRecord(parsedTheme.languageIds)) {
    for (const [rawLangId, defId] of Object.entries(parsedTheme.languageIds)) {
      const langId = rawLangId.trim().toLowerCase()
      const mappedExts = VSCODE_LANGUAGE_ID_EXTENSIONS[langId]
      const mappedNames = VSCODE_LANGUAGE_ID_FILENAMES[langId]
      if (!mappedExts && !mappedNames) {
        continue
      }
      const idx = await resolveIconIndex(defId)
      if (idx === undefined) {
        continue
      }
      for (const ext of mappedExts ?? []) {
        if (!Object.hasOwn(fileExtensions, ext)) {
          setSafeIndex(fileExtensions, ext, idx)
        }
      }
      for (const fname of mappedNames ?? []) {
        if (!Object.hasOwn(fileNames, fname)) {
          setSafeIndex(fileNames, fname, idx)
        }
      }
    }
  }

  // Tier 2: Remaining filenames, folders, and extensions fill the rest of the 512 SVG budget.
  await applyPairs(
    fileNames,
    filePairs.filter(([k]) => !PRIORITY_FILE_SET.has(k))
  )
  await applyPairs(
    folderNames,
    folderPairs.filter(([k]) => !PRIORITY_FOLDER_SET.has(k))
  )
  await applyPairs(
    folderNamesExpanded,
    folderOpenPairs.filter(([k]) => !PRIORITY_FOLDER_SET.has(k))
  )
  await applyPairs(
    fileExtensions,
    extPairs.filter(([k]) => !PRIORITY_EXT_SET.has(k))
  )

  if (svgs.length === 0) {
    warnings.push(
      `Icon theme "${label}" uses glyph fonts or non-SVG icons, which are not supported in Orca.`
    )
    return null
  }

  const metadata: PluginIconThemeMetadata = {
    id,
    pluginKey,
    label,
    revision: computeRevisionHash(`v3:${version}:${id}:${svgs.length}`)
  }
  const registration: PluginIconThemeRegistration = {
    ...metadata,
    svgs,
    icons,
    fileNames,
    fileExtensions,
    folderNames,
    folderNamesExpanded
  }
  if (isPluginIconThemeRegistration(registration)) {
    return { metadata, registration }
  }
  warnings.push(`Icon theme "${label}" did not satisfy Orca SVG validation limits`)
  return null
}

export async function extractVsixIconThemes(
  extensionRootDir: string,
  pluginKey: string,
  version: string,
  rawIconThemes: unknown,
  nls: Record<string, string> | null,
  warnings: string[]
): Promise<AdaptedOpenVsxIconThemeEntry[]> {
  if (!Array.isArray(rawIconThemes)) {
    return []
  }
  const results: AdaptedOpenVsxIconThemeEntry[] = []
  const usedSlugs = new Set<string>()
  for (let index = 0; index < rawIconThemes.length; index += 1) {
    const converted = await convertSingleIconTheme(
      extensionRootDir,
      pluginKey,
      version,
      rawIconThemes[index],
      index,
      nls,
      usedSlugs,
      warnings
    )
    if (converted) {
      results.push(converted)
    }
  }
  return results
}
