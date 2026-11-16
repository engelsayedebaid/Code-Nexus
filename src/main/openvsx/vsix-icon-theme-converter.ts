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

type VsCodeIconThemeContribution = {
  id?: unknown
  label?: unknown
  path?: unknown
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
  entry: VsCodeIconThemeContribution,
  index: number,
  nls: Record<string, string> | null,
  warnings: string[]
): Promise<AdaptedOpenVsxIconThemeEntry | null> {
  if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
    return null
  }
  const themeFilePath = resolveContainedExtensionPath(extensionRootDir, entry.path)
  if (!themeFilePath) {
    return null
  }
  const rawThemeContent = await readBoundedText(themeFilePath, 2 * 1024 * 1024)
  if (!rawThemeContent) {
    return null
  }
  const parsedTheme = parseJsoncObject(rawThemeContent)
  if (!parsedTheme) {
    warnings.push(`Could not parse icon theme "${entry.path}"`)
    return null
  }

  const iconDefs =
    parsedTheme.iconDefinitions && typeof parsedTheme.iconDefinitions === 'object'
      ? (parsedTheme.iconDefinitions as Record<string, { iconPath?: unknown }>)
      : null
  if (!iconDefs) {
    return null
  }

  const label = resolveNlsString(entry.label, nls) || `Icons ${index + 1}`
  const slug = slugifyContribId(
    typeof entry.id === 'string' && entry.id.trim() ? entry.id : label,
    `icons-${index}`
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
    if (!def || typeof def.iconPath !== 'string') {
      return undefined
    }
    const iconRelToRoot = path.relative(extensionRootDir, path.resolve(themeBaseDir, def.iconPath))
    const resolvedIcon = resolveContainedExtensionPath(extensionRootDir, iconRelToRoot)
    if (!resolvedIcon || path.extname(resolvedIcon).toLowerCase() !== '.svg') {
      return undefined
    }
    const svgContent = await readBoundedText(resolvedIcon, PLUGIN_ICON_SVG_MAX_BYTES)
    if (!svgContent || !isPlausiblePluginIconSvg(svgContent)) {
      return undefined
    }
    const nextIndex = svgs.length
    svgs.push(svgContent)
    defIdToSvgIndex.set(defId, nextIndex)
    return nextIndex
  }

  const icons: Partial<Record<'file' | 'folder' | 'folder-open', number>> = {}
  const fileIdx = await resolveIconIndex(parsedTheme.file)
  if (fileIdx !== undefined) {
    icons.file = fileIdx
  }
  const folderIdx = await resolveIconIndex(parsedTheme.folder)
  if (folderIdx !== undefined) {
    icons.folder = folderIdx
  }
  const folderOpenIdx = await resolveIconIndex(parsedTheme.folderExpanded)
  if (folderOpenIdx !== undefined) {
    icons['folder-open'] = folderOpenIdx
  }

  const mapIconRecord = async (
    source: unknown,
    normalizeKey: (key: string) => string
  ): Promise<Record<string, number>> => {
    const target: Record<string, number> = {}
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return target
    }
    for (const [rawKey, defId] of Object.entries(source as Record<string, unknown>)) {
      const idx = await resolveIconIndex(defId)
      if (idx === undefined) {
        continue
      }
      const key = normalizeKey(rawKey)
      if (key) {
        setSafeIndex(target, key, idx)
      }
    }
    return target
  }

  const fileNames = await mapIconRecord(parsedTheme.fileNames, (k) => k.trim())
  const fileExtensions = await mapIconRecord(parsedTheme.fileExtensions, (k) =>
    k.trim().replace(/^\.+/, '').toLowerCase()
  )
  const folderNames = await mapIconRecord(parsedTheme.folderNames, (k) => k.trim())
  const folderNamesExpanded = await mapIconRecord(parsedTheme.folderNamesExpanded, (k) => k.trim())

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
    revision: computeRevisionHash(`${version}:${id}:${svgs.length}`)
  }
  const registrationCandidate: PluginIconThemeRegistration = {
    ...metadata,
    svgs,
    icons,
    fileNames,
    fileExtensions,
    folderNames,
    folderNamesExpanded
  }

  if (isPluginIconThemeRegistration(registrationCandidate)) {
    return { metadata, registration: registrationCandidate }
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
  for (let index = 0; index < rawIconThemes.length; index += 1) {
    const converted = await convertSingleIconTheme(
      extensionRootDir,
      pluginKey,
      version,
      rawIconThemes[index] as VsCodeIconThemeContribution,
      index,
      nls,
      warnings
    )
    if (converted) {
      results.push(converted)
    }
  }
  return results
}
